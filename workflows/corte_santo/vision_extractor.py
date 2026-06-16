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
import json
import mimetypes
import os
import time
from pathlib import Path
from typing import Any

try:
    import httpx
except Exception:  # pragma: no cover - dependency guard
    httpx = None  # type: ignore[assignment]


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
    if document_type == "bancarias":
        extra_rules = (
            "- La foto puede contener mas de un ticket/cierre bancario. "
            "Debes sumar todos los tickets visibles: consumo total, propina total "
            "y total general.\n"
            "- No extraigas solo el ticket mas grande si hay otro ticket visible.\n"
        )
    elif document_type == "tira":
        extra_rules = (
            "- 'cortesia_platillos' es el monto total de cortesias/descuentos en "
            "platillos/comida que aparece en la tira. Suele llamarse 'Cortesia Platillos', "
            "'Cortesias' o similar. Es un descuento en comida, no en bebidas ni efectivo.\n"
            "- Si la tira tiene 'cortesia_platillos' y 'efectivo' por separado, "
            "reporta cada uno en su campo sin sumarlos.\n"
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
    if httpx is None:
        return review("httpx_not_available")
    if _has_unconfirmed_value(cfg["model"]):
        return review("vision_model_not_configured")
    if not cfg["api_key"]:
        return review("vision_api_key_missing")

    path = Path(image_path)
    if not path.is_file():
        return review(f"image_not_found:{image_path}")

    try:
        media_type, b64 = _encode_image(path)
        prompt = _build_prompt(document_type)
        if cfg["provider"] == "anthropic":
            result = _call_anthropic(cfg, prompt, media_type, b64)
        elif cfg["provider"] == "gemini":
            result = _call_gemini(cfg, prompt, media_type, b64)
        else:
            return review(f"unsupported_vision_provider:{cfg['provider']}")
    except Exception as exc:  # network, parse, auth, etc.
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

    return {
        "document_type": document_type,
        "status": "extracted",
        "values": values,
        "confidence": confidence_f,
        "review_reason": None,
        "notes": notes,
    }


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
            time.sleep(request_delay)
        results.append(
            extract_document(
                str(item.get("document_type", "")),
                str(item.get("image_path", "")),
                config,
            )
        )

    needs_review = [r for r in results if r["status"] != "extracted"]
    return {
        "status": "requires_review" if needs_review else "extracted",
        "documents": results,
        "review_reasons": [r["review_reason"] for r in needs_review if r.get("review_reason")],
    }
