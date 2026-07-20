"""Deterministic CxC event extraction from Corte email bodies."""

from __future__ import annotations

import re
import hashlib
from typing import Any


_MOVEMENT_RE = re.compile(r"\bMOV(?:IMIENTO)?\.?\s*(\d{4,})\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")
_MOVEMENT_AMOUNT_RE = re.compile(
    r"\bMOV(?:IMIENTO)?\.?\s*(\d{4,})\b(?:(?!\bMOV(?:IMIENTO)?\.?\b|\bCXC\b).){0,80}?"
    r"\$\s*([\d,]+(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
_SETTLEMENT_RE = re.compile(
    r"\b(?:PAGO(?:\s+EN\s+EFECTIVO)?\s+(?:DE\s+)?CXC|CXC\s+(?:COBRAD[AO]|PAGAD[AO])|SE\s+COBR[OÓ])\b",
    re.IGNORECASE,
)
_PAYMENT_COMPLETION_RE = re.compile(
    r"\bPAG(?:O|ADO|ADA)(?:S)?\s+(?:POR|CON|V[IÍ]A)\s+"
    r"(?:TRANSFERENCIA|SPEI|EFECTIVO|TARJETA|TDD|TDC|VISA|MASTERCARD|BANORTE|AMEX)\b",
    re.IGNORECASE,
)

_MEDIUM_EFECTIVO_RE = re.compile(r"\bEFECTIVO\b", re.IGNORECASE)
_MEDIUM_TARJETA_RE = re.compile(r"\b(?:TARJETA|TDD|TDC|VISA|MASTERCARD|BANORTE)\b", re.IGNORECASE)
_MEDIUM_TRANSFERENCIA_RE = re.compile(r"\b(?:TRANSFERENCIA|SPEI)\b", re.IGNORECASE)
_MEDIUM_AMEX_RE = re.compile(r"\bAMEX\b", re.IGNORECASE)

def _extract_medium(text: str) -> str:
    if _MEDIUM_EFECTIVO_RE.search(text):
        return "efectivo"
    if _MEDIUM_TARJETA_RE.search(text):
        return "tarjeta"
    if _MEDIUM_TRANSFERENCIA_RE.search(text):
        return "transferencia"
    if _MEDIUM_AMEX_RE.search(text):
        return "amex"
    return "unclassified"


def parse_cxc_events(body: str | None) -> list[dict[str, Any]]:
    """Extract stable events from the authoritative CxC email wording."""
    text = " ".join(str(body or "").replace("\r", "\n").split())
    if not text:
        return []

    starts = [match.start() for match in re.finditer(r"\bCXC\b", text, re.IGNORECASE)]
    events: list[dict[str, Any]] = []
    seen: set[tuple[str, str | None, float]] = set()
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else min(len(text), start + 180)
        segment = text[start:end].strip(" ,.;")
        classification_context = text[max(0, start - 35):end]
        kind = (
            "settlement"
            if _SETTLEMENT_RE.search(classification_context)
            or _PAYMENT_COMPLETION_RE.search(classification_context)
            else "opening"
        )
        medium = _extract_medium(classification_context)
        movement_amounts = [
            (match.group(1), round(float(match.group(2).replace(",", "")), 2))
            for match in _MOVEMENT_AMOUNT_RE.finditer(segment)
        ]
        if not movement_amounts:
            amount_match = _AMOUNT_RE.search(segment)
            if not amount_match:
                continue
            amount = round(float(amount_match.group(1).replace(",", "")), 2)
            movement_match = _MOVEMENT_RE.search(segment)
            movement_amounts = [(movement_match.group(1) if movement_match else None, amount)]

        for movement_id, amount in movement_amounts:
            identity = (kind, movement_id, amount)
            if amount <= 0 or identity in seen:
                continue
            seen.add(identity)
            events.append(
                {
                    "kind": kind,
                    "movement_id": movement_id,
                    "principal": amount,
                    "payment_medium": medium,
                    "source": "email_body",
                    "description": segment[:180],
                }
            )
    return events


def receivable_key(restaurant_id: str, business_date: str, event: dict[str, Any]) -> str:
    movement_id = str(event.get("movement_id") or "").strip()
    if movement_id:
        return f"{restaurant_id}:{movement_id}"
    description = " ".join(str(event.get("description") or "").lower().split())
    digest = hashlib.sha256(description.encode("utf-8")).hexdigest()[:12]
    principal = float(event.get("principal") or 0)
    return f"{restaurant_id}:{business_date}:{principal:.2f}:{digest}"


def extract_cxc_events_with_ai(body: str | None, cxc_docs_ocr: list[str]) -> list[dict[str, Any]]:
    """Extract CXC events using Claude by analyzing both email body and OCR text from CXC photos."""
    import os
    import json
    import httpx

    text = " ".join(str(body or "").split())
    ocr_texts = "\n\n---\n\n".join(cxc_docs_ocr)
    
    prompt = f"""Eres un asistente financiero de SANTO Restaurantes. Tu tarea es extraer eventos de Cuentas por Cobrar (CXC) de la información proporcionada.

INFORMACIÓN:
Cuerpo del correo:
{text}

Texto extraído de tickets CXC (OCR):
{ocr_texts}

INSTRUCCIONES:
Extrae todos los eventos de CXC detectados (tanto ajustes/aperturas como pagos/liquidaciones).
Responde ÚNICAMENTE con un arreglo JSON con el siguiente formato exacto:
[
  {{
    "kind": "opening" | "settlement",
    "movement_id": "90484",
    "principal": 535.0,
    "payment_medium": "efectivo" | "tarjeta" | "transferencia" | "amex" | "unclassified",
    "description": "Breve motivo o descripción"
  }}
]

REGLAS:
1. Usa "settlement" si se trata de un pago o liquidación de una deuda anterior.
2. Usa "opening" si es un ajuste por error de mesero, faltante o deuda nueva.
3. El 'principal' debe ser numérico.
4. 'movement_id' puede ser null si no se menciona un número de movimiento.
5. Usa el texto y el contexto para determinar el 'payment_medium'. Si no hay evidencia clara, usa "unclassified".
6. Si no hay eventos de CXC, devuelve [].
7. NO devuelvas nada fuera del arreglo JSON (sin markdown, sin explicaciones).
"""

    api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CORTE_VISION_API_KEY")
    if not api_key:
        return []
        
    try:
        response = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=30.0,
        )
        response.raise_for_status()
        res_text = "".join(p.get("text", "") for p in response.json().get("content", []) if p.get("type") == "text").strip()
        
        start = res_text.find("[")
        end = res_text.rfind("]")
        if start == -1 or end == -1 or end <= start:
            return []
            
        parsed = json.loads(res_text[start:end+1])
        if isinstance(parsed, list):
            for event in parsed:
                event["source"] = "claude_ocr"
            return parsed
        return []
    except Exception:
        return []

