"""
AI Classifier — uses Claude API for emails that can't be classified by prefix rules.

When an email arrives with status=requires_review and reason=unclassified_email,
this module attempts to classify it using Claude, and generates Spanish summaries.

Environment variables:
    ANTHROPIC_API_KEY — API key for the Anthropic Claude API
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("ai.classifier")

# Confidence threshold: Claude must express high confidence for auto-classification
CONFIDENCE_THRESHOLD = 0.85

_CLASSIFICATION_SYSTEM_PROMPT = """\
Eres un clasificador de correos electrónicos para un sistema operativo de restaurantes (SantoOS).
Tu trabajo es determinar a qué flujo de trabajo pertenece un correo electrónico basándote en su
asunto y contenido.

Responde ÚNICAMENTE con un JSON válido con estos campos:
- "workflow_key": la clave del flujo de trabajo que mejor coincide, o null si no estás seguro
- "confidence": un número entre 0.0 y 1.0 indicando tu confianza
- "reasoning": una explicación breve en español de por qué elegiste esa clasificación
"""

_SUMMARY_SYSTEM_PROMPT = """\
Eres un asistente que genera resúmenes concisos en español de correos electrónicos
para un sistema operativo de restaurantes. Genera un resumen de 1-2 oraciones
que capture la información más importante del correo.
"""


def _get_client() -> Any:
    """Lazily import and create an Anthropic client."""
    try:
        import anthropic  # noqa: F811
    except ImportError:
        logger.error("anthropic package is not installed. Run: pip install anthropic")
        return None

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — AI classification disabled")
        return None

    return anthropic.Anthropic(api_key=api_key)


def classify_email(
    subject: str,
    body: str,
    available_workflows: dict[str, str],
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
) -> dict[str, Any]:
    """
    Attempt to classify an email using Claude AI.

    Args:
        subject: Email subject line.
        body: Email body text.
        available_workflows: Mapping of prefix → workflow_key from routing config.
        confidence_threshold: Minimum confidence to auto-classify (default 0.85).

    Returns:
        dict with keys:
            - "classified": bool — whether the email was successfully classified
            - "workflow_key": str | None — the matched workflow key
            - "classification_key": str | None — the matched prefix
            - "confidence": float — Claude's confidence score
            - "reasoning": str — explanation of classification decision
    """
    client = _get_client()
    if client is None:
        return {
            "classified": False,
            "workflow_key": None,
            "classification_key": None,
            "confidence": 0.0,
            "reasoning": "AI classification unavailable (missing API key or package)",
        }

    workflow_descriptions = "\n".join(
        f"- Prefijo: {prefix} → Flujo: {wf_key}"
        for prefix, wf_key in available_workflows.items()
    )

    user_message = (
        f"Flujos de trabajo disponibles:\n{workflow_descriptions}\n\n"
        f"Asunto del correo: {subject}\n\n"
        f"Cuerpo del correo:\n{body[:2000]}"
    )

    try:
        import json as json_mod

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=300,
            system=_CLASSIFICATION_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        response_text = response.content[0].text.strip()
        # Parse the JSON response
        result = json_mod.loads(response_text)

        workflow_key = result.get("workflow_key")
        confidence = float(result.get("confidence", 0.0))
        reasoning = result.get("reasoning", "")

        # Find the matching prefix for this workflow_key
        classification_key = None
        if workflow_key:
            for prefix, wf_key in available_workflows.items():
                if wf_key == workflow_key:
                    classification_key = prefix
                    break

        classified = (
            workflow_key is not None
            and classification_key is not None
            and confidence >= confidence_threshold
        )

        logger.info(
            "AI classification: workflow_key=%s confidence=%.2f classified=%s",
            workflow_key,
            confidence,
            classified,
        )

        return {
            "classified": classified,
            "workflow_key": workflow_key if classified else None,
            "classification_key": classification_key if classified else None,
            "confidence": confidence,
            "reasoning": reasoning,
        }

    except Exception:
        logger.exception("AI classification failed")
        return {
            "classified": False,
            "workflow_key": None,
            "classification_key": None,
            "confidence": 0.0,
            "reasoning": "AI classification failed due to an error",
        }


def summarize_email(subject: str, body: str) -> str | None:
    """
    Generate a 1-2 sentence Spanish summary of an email.

    Args:
        subject: Email subject line.
        body: Email body text.

    Returns:
        A short Spanish summary string, or None if summarization fails.
    """
    client = _get_client()
    if client is None:
        return None

    user_message = (
        f"Asunto: {subject}\n\n"
        f"Contenido:\n{body[:3000]}\n\n"
        "Genera un resumen de 1-2 oraciones en español."
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=150,
            system=_SUMMARY_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
        )

        summary = response.content[0].text.strip()
        logger.info("Generated summary: %s", summary[:80])
        return summary

    except Exception:
        logger.exception("AI summarization failed")
        return None
