"""
Send demo emails to santoos@agentmail.to for client presentation.

Shows different classification scenarios:
1. [CORTE] from allowed sender → classified correctly
2. [XML] from allowed sender → classified correctly
3. Ambiguous email from allowed sender → requires_review (no prefix)
4. Email from unknown sender → requires_review (not in allowlist)
5. [FYI] from allowed sender → ignored

Usage:
    export AGENTMAIL_API_KEY="am_us_..."
    python -m services.agent_mail.send_demo_emails
"""

from __future__ import annotations

import json
import os
import sys
import time

import httpx

API_KEY = os.environ.get("AGENTMAIL_API_KEY", "")
INBOX_ID = "santoos@agentmail.to"
BASE_URL = "https://api.agentmail.to/v0"

# We send FROM the inbox itself (simulating forwarded emails from developer@santorestaurants.com)
# In production, real emails would arrive from external senders.

DEMO_EMAILS = [
    {
        "description": "✓ Corte Santo clasificado correctamente",
        "to": INBOX_ID,
        "subject": "[CORTE] Corte Santo 2 Jun 2026 - Unidad Centro",
        "text": (
            "Buenos dias,\n\n"
            "Adjunto el corte del dia de hoy para Unidad Centro.\n"
            "Ventas totales: $45,230\n"
            "Efectivo: $12,800\n"
            "Tarjeta: $32,430\n"
            "Deposito realizado: Si\n\n"
            "Saludos,\nGerencia Unidad Centro"
        ),
    },
    {
        "description": "✓ XML SAT clasificado correctamente",
        "to": INBOX_ID,
        "subject": "[XML] Facturas Junio 2026 - Proveedor Carnes Del Norte",
        "text": (
            "Hola,\n\n"
            "Les envio las facturas del mes correspondientes a Carnes Del Norte.\n"
            "Total facturado: $28,500 + IVA\n"
            "RFC emisor: CDN920101ABC\n\n"
            "Adjunto 3 XMLs.\n\n"
            "Atte,\nCuentas por pagar"
        ),
    },
    {
        "description": "⚠ Email ambiguo - sin prefijo reconocido → requires_review",
        "to": INBOX_ID,
        "subject": "Reporte ventas semana pasada",
        "text": (
            "Hola equipo,\n\n"
            "Les paso el reporte de ventas de la semana pasada.\n"
            "No se si esto va al corte o a otro lado.\n\n"
            "Saludos"
        ),
    },
    {
        "description": "🚫 [FYI] → ignorado automaticamente",
        "to": INBOX_ID,
        "subject": "[FYI] Recordatorio: junta de equipo manana a las 9am",
        "text": (
            "Solo un recordatorio de que manana tenemos junta.\n"
            "No requiere accion del sistema.\n\n"
            "Saludos"
        ),
    },
    {
        "description": "✓ Utilidades clasificado correctamente",
        "to": INBOX_ID,
        "subject": "[UTILIDADES] Recibo CFE Mayo 2026 - Unidad Centro",
        "text": (
            "Adjunto el recibo de luz de mayo.\n"
            "Monto: $8,450\n"
            "Vencimiento: 15 Jun 2026\n"
            "Numero de servicio: 123456789\n\n"
            "Atte,\nAdministracion"
        ),
    },
]


def send_email(email: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "to": email["to"],
        "subject": email["subject"],
        "text": email["text"],
    }
    resp = httpx.post(
        f"{BASE_URL}/inboxes/{INBOX_ID}/messages/send",
        headers=headers,
        json=body,
        timeout=30.0,
    )
    resp.raise_for_status()
    return resp.json()


def main() -> int:
    if not API_KEY:
        print("ERROR: Set AGENTMAIL_API_KEY environment variable")
        return 1

    print("Enviando emails de demostración a santoos@agentmail.to...\n")

    for i, email in enumerate(DEMO_EMAILS, 1):
        print(f"  {i}. {email['description']}")
        print(f"     Subject: {email['subject']}")
        result = send_email(email)
        print(f"     → Enviado (message_id: {result['message_id'][:40]}...)")
        print()
        time.sleep(1)  # Small delay between sends

    print("=" * 60)
    print("Listo. Ahora corré el poller para ver cómo los clasifica:")
    print()
    print("  python -m services.agent_mail.poller --config services/agent_mail/config.json")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
