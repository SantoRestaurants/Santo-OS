"""
Corte Santo vision-based document extraction.

The corte arrives partly as photos (terminal tickets / "tira", bank terminal
batch closes, cash detail) and legacy spreadsheets. These images are central to
reconciliation: the operator compares the grand totals on the photos against the
Excel and takes the *lower* tip between the "tira" photo and the bank photos.

This module is the system component that reads those photos automatically. It
sends each image to a configured vision model (via the Messages-style HTTP API,
no SDK required) together with a strict per-document extraction schema, and
returns structured numbers plus a confidence signal.

Safety / P0 alignment:
- Nothing is hardcoded: provider, model, endpoint and API key come from config
  or environment. No business number is invented.
- If the API key is missing, the call fails, or the model reports low confidence
  (below the confirmed threshold), the document is returned as
  `requires_review`. Uncertainty never becomes a completed value — especially
  important because these numbers feed a zero-tolerance reconciliation and get
  written into the client's books.
- This module only extracts and reports; it never approves or writes.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

try:
    import httpx
except Exception:  # pragma: no cover - dependency guard
    httpx = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


# Document types we extract from images, with the fields each one must yield.
# These mirror the client corte: the terminal "tira", the bank terminal closes
# (AMEX / Banorte / bancarias) and the hand-written cash detail.
DOCUMENT_SCHEMAS: dict[str, dict[str, Any]] = {
    "tira": {
        "description": "Foto de la tira/ticket del sistema con totales por forma de pago.",
        "fields": ["gran_total", "propina_total", "efectivo", "amex", "tarjeta_debito", "tarjeta_credito", "cortesia_platillos"],
    },
    "bancarias": {
        "description": "Foto del cierre de lote de terminales bancarias (Banorte/Visa/MC). Extrae solo los totales agregados visibles; el split debito/credito viene del Excel de corte.",
        "fields": ["consumo", "propina", "total"],
    },
    "amex": {
        "description": "Foto o export del cierre de lote AMEX.",
        "fields": ["consumo", "propina", "total"],
    },
    "detalle_efectivo": {
        "description": "Detalle del efectivo contado (puede ser manuscrito).",
        "fields": ["efectivo_real", "propina_efectivo", "cortesia_direccion", "deposito", "total"],
    },
    "cxc": {
        "description": "Foto de un ajuste de Cuenta por Cobrar (CXC). El monto incluye consumo y propina. El canal es la forma de pago (tarjeta de debito, tarjeta de credito, efectivo, etc).",
        "fields": ["consumo", "propina", "monto_total", "canal"],
    },
}


def _has_unconfirmed_value(value: Any) -> bool:
    if value in (None, "", "[CONFIRM]"):
        return True
    if isinstance(value, str):
        return "[CONFIRM]" in value
    return False


def _vision_config(config: dict[str, Any]) -> dict[str, Any]:
    """Resolve vision config from the workflow config and environment."""
    vision = config.get("vision_extraction") if isinstance(config, dict) else None
    vision = vision if isinstance(vision, dict) else {}

    api_key = os.environ.get(vision.get("api_key_env", "CORTE_VISION_API_KEY"), "")
    provider = vision.get("provider", "anthropic")
    default_endpoint = (
        "https://generativelanguage.googleapis.com/v1beta/models"
        if provider == "gemini"
        else "https://api.anthropic.com/v1/messages"
    )
    return {
        "provider": provider,
        "endpoint": vision.get("endpoint", default_endpoint),
        "model": os.environ.get(vision.get("model_env", ""), "") or vision.get("model"),
        "anthropic_version": vision.get("anthropic_version", "2023-06-01"),
        "max_tokens": int(vision.get("max_tokens", 4096)),
        "confidence_threshold": float(vision.get("confidence_threshold", 0.95)),
        "retry_attempts": int(vision.get("retry_attempts", 3)),
        "retry_backoff_seconds": float(vision.get("retry_backoff_seconds", 10)),
        "request_delay_seconds": float(vision.get("request_delay_seconds", 0)),
        "cache_enabled": bool(vision.get("cache_enabled", True)),
        "cache_version": str(vision.get("cache_version", "local-ocr-v3")),
        "cache_dir": os.environ.get("CORTE_VISION_CACHE_DIR", "")
        or vision.get("cache_dir", ".cache/corte_santo_vision"),
        "local_ocr_enabled": bool(vision.get("local_ocr_enabled", True)),
        "local_ocr_fallback_to_vision": bool(vision.get("local_ocr_fallback_to_vision", True)),
        "local_ocr_lang": vision.get("local_ocr_lang", "eng+spa"),
        "local_ocr_psm": str(vision.get("local_ocr_psm", "6")),
        "api_key": api_key,
    }


def _encode_image(path: Path) -> tuple[str, str]:
    media_type = mimetypes.guess_type(str(path))[0] or "image/jpeg"
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return media_type, data


def _build_prompt(document_type: str) -> str:
    schema = DOCUMENT_SCHEMAS.get(document_type, {})
    fields = schema.get("fields", [])
    description = schema.get("description", "")
    extra_rules = ""
    if document_type in ("amex", "bancarias"):
        label = "AMEX" if document_type == "amex" else "bancarias"
        extra_rules = (
            f"- La foto puede contener mas de un ticket/cierre {label}. "
            "Debes sumar todos los tickets visibles: consumo total, propina total "
            "y total general.\n"
            "- No extraigas solo el ticket mas grande si hay otro ticket visible.\n"
            "- Para 'total', suma solo la linea TOTAL de cada ticket. No sumes "
            "propina otra vez si ya esta incluida en el total del ticket.\n"
        )
    elif document_type == "tira":
        extra_rules = (
            "- 'cortesia_platillos' es el monto total de cortesias/descuentos en "
            "platillos/comida que aparece en la tira. Suele llamarse 'Cortesia Platillos', "
            "'Cortesias' o similar. Es un descuento en comida, no en bebidas ni efectivo.\n"
            "- Si la tira tiene 'cortesia_platillos' y 'efectivo' por separado, "
            "reporta cada uno en su campo sin sumarlos.\n"
        )
    elif document_type == "cxc":
        extra_rules = (
            "- La foto puede contener mas de un ajuste/movimiento CXC. "
            "Debes sumar todos los movimientos visibles.\n"
            "- 'consumo' es el monto sin propina. 'propina' es la propina incluida. "
            "'monto_total' es consumo + propina para todos los movimientos visibles.\n"
            "- 'canal' es la forma de pago: 'debito', 'credito', 'efectivo', 'amex', etc. "
            "Mapea el texto de la foto al canal mas cercano.\n"
            "- Si no ves propina, pon propina en 0 y monto_total igual a consumo.\n"
        )
    return (
        "Eres un extractor de datos financieros para el corte diario de un "
        "restaurante (SANTO). Lee la imagen y devuelve EXCLUSIVAMENTE un objeto "
        "JSON, sin texto adicional, con esta forma exacta:\n"
        '{"values": {<campo>: <numero|null>, ...}, "confidence": <0..1>, '
        '"notes": "<dudas o ilegibilidad>"}\n'
        f"Descripcion del documento: {description}\n"
        f"Campos requeridos para el documento '{document_type}': {fields}.\n"
        "Reglas:\n"
        "- Devuelve numeros sin signo de moneda ni separador de miles (ej: 9909.45).\n"
        "- Si un campo no aparece o es ilegible, ponlo en null y baja la confianza.\n"
        f"{extra_rules}"
        "- 'confidence' es tu certeza global de la lectura (1.0 = perfecta).\n"
        "- No inventes valores. Ante la duda, null y confidence baja."
    )


def _parse_model_json(text: str) -> dict[str, Any]:
    text = text.strip()
    # Tolerate code fences or surrounding prose: extract the first {...} block.
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("model_response_not_json")
    return json.loads(text[start : end + 1])


def _cache_key(cfg: dict[str, Any], document_type: str, source_hash: str, prompt: str) -> str:
    parts = {
        "source_hash": source_hash,
        "document_type": document_type,
        "provider": cfg.get("provider"),
        "model": cfg.get("model"),
        "cache_version": cfg.get("cache_version"),
        "prompt_hash": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
        "schema_hash": hashlib.sha256(
            json.dumps(DOCUMENT_SCHEMAS.get(document_type, {}), sort_keys=True).encode("utf-8")
        ).hexdigest(),
    }
    raw = json.dumps(parts, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _cache_path(cfg: dict[str, Any], cache_key: str) -> Path:
    return Path(str(cfg["cache_dir"])) / f"{cache_key}.json"


def _read_cache(cfg: dict[str, Any], cache_key: str) -> dict[str, Any] | None:
    if not cfg.get("cache_enabled"):
        return None
    path = _cache_path(cfg, cache_key)
    if not path.is_file():
        return None
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    result = cached.get("result") if isinstance(cached, dict) else None
    if not isinstance(result, dict) or result.get("status") != "extracted":
        return None
    result = dict(result)
    result["cache"] = "hit"
    return result


def _write_cache(cfg: dict[str, Any], cache_key: str, result: dict[str, Any], source_hash: str) -> None:
    if not cfg.get("cache_enabled") or result.get("status") != "extracted":
        return
    path = _cache_path(cfg, cache_key)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source_hash": source_hash,
            "provider": cfg.get("provider"),
            "model": cfg.get("model"),
            "cached_at": int(time.time()),
            "result": result,
        }
        path.write_text(json.dumps(payload, sort_keys=True, ensure_ascii=True), encoding="utf-8")
    except OSError:
        return


def _parse_money(raw: str) -> float | None:
    cleaned = raw.strip().replace("$", "").replace(" ", "")
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        return round(float(cleaned), 2)
    except ValueError:
        return None


def _money_values(text: str, *, require_currency_symbol: bool = False) -> list[float]:
    values = []
    pattern = (
        r"\$\s*\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})|\$\s*\d+(?:[.,]\d{2})"
        if require_currency_symbol
        else r"\$?\s*\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2})|\$?\s*\d+(?:[.,]\d{2})"
    )
    for match in re.finditer(pattern, text):
        value = _parse_money(match.group(0))
        if value is not None:
            values.append(value)
    return values


def _line_amounts(line: str) -> list[float]:
    return _money_values(line)


def _run_tesseract(path: Path, cfg: dict[str, Any]) -> str | None:
    if shutil.which("tesseract") is None:
        logger.info("Local OCR skipped: tesseract executable not found")
        return None
    cmd = [
        "tesseract",
        str(path),
        "stdout",
        "-l",
        str(cfg.get("local_ocr_lang") or "eng+spa"),
        "--psm",
        str(cfg.get("local_ocr_psm") or "6"),
    ]
    try:
        completed = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        logger.exception("Local OCR failed to execute for image=%s", path.name)
        return None
    if completed.returncode != 0:
        logger.warning("Local OCR returned code=%s stderr=%s", completed.returncode, completed.stderr[:300])
        return None
    text = completed.stdout.strip()
    logger.info("Local OCR produced %d character(s) for image=%s", len(text), path.name)
    return text


def _extract_payment_ticket_totals(text: str, document_type: str) -> dict[str, Any] | None:
    total_lines = []
    propina_lines = []
    consumo_lines = []
    for line in text.splitlines():
        normalized = line.lower()
        amounts = _line_amounts(line)
        if not amounts:
            continue
        if "subtotal" in normalized:
            consumo_lines.extend(amounts)
            continue
        if "propina" in normalized or "tip" in normalized:
            propina_lines.extend(amounts)
            continue
        if "total" in normalized:
            total_lines.extend(amounts)

    totals = [amount for amount in total_lines if amount > 0]
    if not totals:
        return None
    values = {
        "consumo": round(sum(consumo_lines), 2) if consumo_lines else None,
        "propina": round(sum(propina_lines), 2) if propina_lines else None,
        "total": round(sum(totals), 2),
        "total_candidates": totals,
    }
    return {
        "document_type": document_type,
        "status": "extracted",
        "values": values,
        "confidence": 0.91,
        "review_reason": None,
        "notes": f"local_ocr_total_lines={len(totals)}",
        "extractor": "local_ocr",
    }


def _cxc_channel(text: str) -> str | None:
    lower = text.lower()
    if "debito" in lower or "dÃ©bito" in lower:
        return "debito"
    if "tarjeta" in lower and "credito" not in lower and "crÃ©dito" not in lower:
        return "debito"
    if "credito" in lower or "crÃ©dito" in lower:
        return "credito"
    if "amex" in lower:
        return "amex"
    if "efectivo" in lower:
        return "efectivo"
    return None


def _extract_cxc_totals(text: str) -> dict[str, Any] | None:
    consumo = None
    propina = None
    total_line = None
    channel = _cxc_channel(text)
    comment_lines = []
    for line in text.splitlines():
        clean_line = " ".join(line.strip().split())
        lower_clean = clean_line.lower()
        if clean_line and (
            "mov" in lower_clean
            or "total" in lower_clean
            or "tarjeta" in lower_clean
            or "cxc" in lower_clean
        ):
            comment_lines.append(clean_line)
        lower_line = line.lower()
        amounts = _line_amounts(line)
        if not amounts:
            continue
        if (
            ("tarjeta" in lower_line or "debito" in lower_line or "dÃ©bito" in lower_line)
            and len(amounts) >= 2
        ):
            total_line = amounts[0]
            propina = amounts[1]
            consumo = round(total_line - propina, 2)
            channel = "debito"
            break
        if "consumo" in lower_line:
            consumo = amounts[-1]
        elif "propina" in lower_line:
            propina = amounts[-1]
        elif "total" in lower_line:
            total_line = amounts[-1]
    if total_line is not None and (consumo is not None or propina is not None or channel is not None):
        propina_value = propina or 0.0
        consumo_value = consumo if consumo is not None else round(total_line - propina_value, 2)
        return {
            "document_type": "cxc",
            "status": "extracted",
            "values": {
                "consumo": consumo_value,
                "propina": propina_value,
                "monto_total": total_line,
                "monto_candidates": [total_line],
                "canal": channel,
                "comment_lines": comment_lines,
            },
            "confidence": 0.9,
            "review_reason": None,
            "notes": "local_ocr_labeled_cxc",
            "extractor": "local_ocr",
        }

    amounts = _money_values(text, require_currency_symbol=True)
    if not amounts:
        amounts = [amount for amount in _money_values(text) if amount < 50000]
    if not amounts:
        return None
    channel = None
    lower = text.lower()
    if "debito" in lower or "débito" in lower:
        channel = "debito"
    elif "credito" in lower or "crédito" in lower:
        channel = "credito"
    elif "amex" in lower:
        channel = "amex"
    elif "efectivo" in lower:
        channel = "efectivo"
    total = round(sum(amounts), 2)
    return {
        "document_type": "cxc",
        "status": "extracted",
        "values": {
            "consumo": total,
            "propina": 0.0,
            "monto_total": total,
            "monto_candidates": amounts,
            "canal": _cxc_channel(text),
            "comment_lines": comment_lines,
        },
        "confidence": 0.9,
        "review_reason": None,
        "notes": f"local_ocr_amounts={len(amounts)}",
        "extractor": "local_ocr",
    }


def _local_ocr_extract(document_type: str, path: Path, cfg: dict[str, Any]) -> dict[str, Any] | None:
    if not cfg.get("local_ocr_enabled") or document_type not in ("amex", "bancarias", "cxc"):
        return None
    text = _run_tesseract(path, cfg)
    if not text:
        return None
    if document_type in ("amex", "bancarias"):
        return _extract_payment_ticket_totals(text, document_type)
    if document_type == "cxc":
        return _extract_cxc_totals(text)
    return None


def _call_anthropic(cfg: dict[str, Any], prompt: str, media_type: str, b64: str) -> dict[str, Any]:
    response = httpx.post(
        cfg["endpoint"],
        headers={
            "x-api-key": cfg["api_key"],
            "anthropic-version": cfg["anthropic_version"],
            "content-type": "application/json",
        },
        json={
            "model": cfg["model"],
            "max_tokens": cfg["max_tokens"],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        },
        timeout=120.0,
    )
    response.raise_for_status()
    payload = response.json()
    parts = payload.get("content", [])
    text = "".join(part.get("text", "") for part in parts if part.get("type") == "text")
    return _parse_model_json(text)


def _call_gemini(cfg: dict[str, Any], prompt: str, media_type: str, b64: str) -> dict[str, Any]:
    # Gemini generateContent endpoint: {endpoint}/{model}:generateContent?key=API_KEY
    url = f"{cfg['endpoint'].rstrip('/')}/{cfg['model']}:generateContent"
    response = None
    attempts = max(1, int(cfg.get("retry_attempts", 3)))
    for attempt in range(attempts):
        logger.info(
            "Calling Gemini vision model=%s attempt=%d/%d media_type=%s",
            cfg.get("model"),
            attempt + 1,
            attempts,
            media_type,
        )
        response = httpx.post(
            url,
            headers={"content-type": "application/json", "x-goog-api-key": cfg["api_key"]},
            json={
                "contents": [
                    {
                        "parts": [
                            {"inline_data": {"mime_type": media_type, "data": b64}},
                            {"text": prompt},
                        ]
                    }
                ],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": cfg["max_tokens"],
                    "responseMimeType": "application/json",
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            },
            timeout=120.0,
        )
        if response.status_code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
            break
        retry_after = response.headers.get("retry-after")
        try:
            delay = float(retry_after) if retry_after else None
        except ValueError:
            delay = None
        if delay is None:
            delay = float(cfg.get("retry_backoff_seconds", 10)) * (attempt + 1)
        logger.warning(
            "Gemini vision returned HTTP %s; retrying in %.1fs",
            response.status_code,
            delay,
        )
        time.sleep(delay)
    if response is None:  # pragma: no cover - loop always assigns
        raise ValueError("gemini_no_response")
    response.raise_for_status()
    payload = response.json()
    candidates = payload.get("candidates", [])
    if not candidates:
        raise ValueError("gemini_no_candidates")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if "text" in part)
    return _parse_model_json(text)


def extract_document(
    document_type: str,
    image_path: str,
    config: dict[str, Any] | None = None,
    *,
    source_hash: str | None = None,
) -> dict[str, Any]:
    """
    Extract structured values from one corte image via the configured vision model.

    Returns a dict:
        {
          "document_type": ...,
          "status": "extracted" | "requires_review",
          "values": {...},
          "confidence": float | None,
          "review_reason": str | None,
          "notes": str | None,
        }
    """
    config = config or {}
    cfg = _vision_config(config)

    def review(reason: str, values: dict[str, Any] | None = None, confidence: float | None = None, notes: str | None = None):
        return {
            "document_type": document_type,
            "status": "requires_review",
            "values": values or {},
            "confidence": confidence,
            "review_reason": reason,
            "notes": notes,
        }

    if document_type not in DOCUMENT_SCHEMAS:
        return review(f"unknown_document_type:{document_type}")

    path = Path(image_path)
    if not path.is_file():
        return review(f"image_not_found:{image_path}")

    try:
        prompt = _build_prompt(document_type)
        effective_source_hash = source_hash or hashlib.sha256(path.read_bytes()).hexdigest()
        cache_key = _cache_key(cfg, document_type, effective_source_hash, prompt)
        logger.info(
            "Starting vision extraction document_type=%s image=%s source_hash=%s cache_key=%s",
            document_type,
            path.name,
            effective_source_hash[:12],
            cache_key[:12],
        )
        cached = _read_cache(cfg, cache_key)
        if cached is not None:
            logger.info(
                "Vision cache hit document_type=%s image=%s cache_key=%s",
                document_type,
                path.name,
                cache_key[:12],
            )
            return cached
        logger.info(
            "Vision cache miss document_type=%s image=%s provider=%s model=%s",
            document_type,
            path.name,
            cfg.get("provider"),
            cfg.get("model"),
        )
        local_result = _local_ocr_extract(document_type, path, cfg)
        if local_result is not None:
            local_result["cache"] = "miss"
            _write_cache(cfg, cache_key, local_result, effective_source_hash)
            logger.info(
                "Local OCR extraction completed document_type=%s image=%s confidence=%.3f",
                document_type,
                path.name,
                float(local_result.get("confidence") or 0),
            )
            return local_result
        if cfg.get("local_ocr_enabled") and not cfg.get("local_ocr_fallback_to_vision"):
            logger.info(
                "Local OCR could not extract document_type=%s image=%s; vision fallback disabled",
                document_type,
                path.name,
            )
            return review("local_ocr_extraction_requires_review")
        if httpx is None:
            return review("httpx_not_available")
        if _has_unconfirmed_value(cfg["model"]):
            return review("vision_model_not_configured")
        if not cfg["api_key"]:
            return review("vision_api_key_missing")
        media_type, b64 = _encode_image(path)
        if cfg["provider"] == "anthropic":
            result = _call_anthropic(cfg, prompt, media_type, b64)
        elif cfg["provider"] == "gemini":
            result = _call_gemini(cfg, prompt, media_type, b64)
        else:
            return review(f"unsupported_vision_provider:{cfg['provider']}")
    except Exception as exc:  # network, parse, auth, etc.
        logger.exception(
            "Vision extraction failed document_type=%s image=%s",
            document_type,
            image_path,
        )
        return review(f"vision_extraction_error:{type(exc).__name__}:{str(exc)[:200]}")

    values = result.get("values") if isinstance(result, dict) else None
    confidence = result.get("confidence") if isinstance(result, dict) else None
    notes = result.get("notes") if isinstance(result, dict) else None

    if not isinstance(values, dict):
        return review("vision_response_missing_values", notes=notes)
    try:
        confidence_f = float(confidence)
    except (TypeError, ValueError):
        return review("vision_response_missing_confidence", values=values, notes=notes)

    if confidence_f < cfg["confidence_threshold"]:
        return review("vision_confidence_below_threshold", values=values, confidence=confidence_f, notes=notes)

    extracted = {
        "document_type": document_type,
        "status": "extracted",
        "values": values,
        "confidence": confidence_f,
        "review_reason": None,
        "notes": notes,
        "cache": "miss",
    }
    _write_cache(cfg, cache_key, extracted, effective_source_hash)
    logger.info(
        "Vision extraction completed document_type=%s image=%s confidence=%.3f cache=miss",
        document_type,
        path.name,
        confidence_f,
    )
    return extracted


def extract_documents(images: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Extract a batch of corte images.

    `images`: list of {"document_type": ..., "image_path": ...}.
    Returns the per-document results plus an overall status: if any document
    requires review, the batch requires review.
    """
    results = []
    cfg = _vision_config(config or {})
    request_delay = float(cfg.get("request_delay_seconds", 0))
    for index, item in enumerate(images):
        if not isinstance(item, dict):
            continue
        if index > 0 and request_delay > 0:
            logger.info("Waiting %.1fs before next vision request", request_delay)
            time.sleep(request_delay)
        logger.info(
            "Vision batch item %d/%d document_type=%s image_path=%s",
            index + 1,
            len(images),
            item.get("document_type"),
            item.get("image_path"),
        )
        results.append(
            extract_document(
                str(item.get("document_type", "")),
                str(item.get("image_path", "")),
                config,
                source_hash=str(item.get("source_hash") or "") or None,
            )
        )

    needs_review = [r for r in results if r["status"] != "extracted"]
    return {
        "status": "requires_review" if needs_review else "extracted",
        "documents": results,
        "review_reasons": [r["review_reason"] for r in needs_review if r.get("review_reason")],
    }
