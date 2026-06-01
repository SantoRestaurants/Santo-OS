from __future__ import annotations

from services.agent_mail.intake import intake_email


BASE_EMAIL = {
    "provider": "gmail",
    "provider_message_id": "msg-corte-001",
    "internet_message_id": "<msg-corte-001@example.com>",
    "inbox_address": "santo-os@example.com",
    "from_address": "admin@example.com",
    "to_addresses": ["santo-os@example.com"],
    "subject": "[CORTE] Corte Santo 2026-05-27",
    "received_at": "2026-05-27T12:00:00Z",
    "attachments": [{"filename": "corte.xlsx"}],
}

CONFIRMED_ROUTING = {
    "confirmed": True,
    "dry_run": True,
    "default_actor_role": "agent_mail_intake",
    "subject_prefixes": {
        "[CORTE]": "corte_santo_daily_sales_reconciliation",
        "[XML]": "xml_sat_validation",
    },
    "ignored_subject_prefixes": ["[FYI]"],
}


def test_missing_routing_requires_review() -> None:
    result = intake_email(BASE_EMAIL, {})

    assert result["status"] == "requires_review"
    assert result["email_message"]["processing_status"] == "requires_review"
    assert result["command"] is None


def test_confirmed_subject_prefix_classifies_to_command() -> None:
    result = intake_email(BASE_EMAIL, CONFIRMED_ROUTING)

    assert result["status"] == "classified"
    assert result["email_message"]["processing_status"] == "classified"
    assert result["email_message"]["classification_key"] == "[CORTE]"
    assert result["command"]["command_type"] == "workflow.intake"
    assert result["command"]["workflow_key"] == "corte_santo_daily_sales_reconciliation"


def test_unclassified_subject_requires_review() -> None:
    email = {**BASE_EMAIL, "subject": "Corte sin prefijo"}
    result = intake_email(email, CONFIRMED_ROUTING)

    assert result["status"] == "requires_review"
    assert result["email_message"]["requires_review_reason"] == "unclassified_email"
    assert result["command"] is None


def test_ignored_prefix_requires_confirmed_rule() -> None:
    email = {**BASE_EMAIL, "subject": "[FYI] Newsletter"}
    result = intake_email(email, CONFIRMED_ROUTING)

    assert result["status"] == "ignored"
    assert result["email_message"]["processing_status"] == "ignored"
    assert result["command"] is None


def test_ambiguous_prefix_requires_review() -> None:
    routing = {
        **CONFIRMED_ROUTING,
        "subject_prefixes": {
            "[CORTE]": "corte_santo_daily_sales_reconciliation",
            "[CORTE] Corte": "corte_santo_daily_sales_reconciliation",
        },
    }
    result = intake_email(BASE_EMAIL, routing)

    assert result["status"] == "requires_review"
    assert result["email_message"]["requires_review_reason"] == "ambiguous_routing"


def test_email_idempotency_key_is_stable() -> None:
    first = intake_email(BASE_EMAIL, CONFIRMED_ROUTING)
    second = intake_email(BASE_EMAIL, CONFIRMED_ROUTING)

    assert (
        first["email_message"]["raw_metadata"]["idempotency_key"]
        == second["email_message"]["raw_metadata"]["idempotency_key"]
    )
