"""Deterministic CxC event extraction from Corte email bodies."""

from __future__ import annotations

import re
import hashlib
from typing import Any


_MOVEMENT_RE = re.compile(r"\bMOV(?:IMIENTO)?\.?\s*(\d{4,})\b", re.IGNORECASE)
_AMOUNT_RE = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")
_SETTLEMENT_RE = re.compile(
    r"\b(?:PAGO(?:\s+EN\s+EFECTIVO)?\s+(?:DE\s+)?CXC|CXC\s+(?:COBRAD[AO]|PAGAD[AO])|SE\s+COBR[OÓ])\b",
    re.IGNORECASE,
)


def parse_cxc_events(body: str | None) -> list[dict[str, Any]]:
    """Extract one stable event per CxC mention without interpreting images."""
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
        amount_match = _AMOUNT_RE.search(segment)
        if not amount_match:
            continue
        amount = round(float(amount_match.group(1).replace(",", "")), 2)
        movement_match = _MOVEMENT_RE.search(segment)
        movement_id = movement_match.group(1) if movement_match else None
        kind = "settlement" if _SETTLEMENT_RE.search(classification_context) else "opening"
        identity = (kind, movement_id, amount)
        if amount <= 0 or identity in seen:
            continue
        seen.add(identity)
        events.append(
            {
                "kind": kind,
                "movement_id": movement_id,
                "principal": amount,
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
