import httpx
import json

from services.agent_mail.poller import AgentMailClient
from services.agent_mail.poller import SupabaseWriter
from services.agent_mail.poller import _agentmail_to_intake_format
from services.agent_mail.poller import poll_and_classify
from services.agent_mail.intake import intake_email, message_content_fingerprint


def test_transfer_settlement_stays_pending_until_bank_and_follows_superseded_row() -> None:
    target = {
        "id": "manual-la-valisse",
        "status": "open",
        "principal": 3185.0,
        "settled_principal": 0.0,
        "evidence": {"source": "manual_outstanding_breakdown", "description": "La Valisse"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "GET" and "movement_id=eq.90359" in url:
            return httpx.Response(200, json=[{
                "id": "old-90359",
                "status": "cancelled",
                "principal": 640.0,
                "settled_principal": 0.0,
                "evidence": {"superseded_by": "manual_cxc_breakdown_2026-07-09", "description": "La Valisse"},
            }], request=request)
        if request.method == "GET" and "id=eq.manual_cxc_breakdown_2026-07-09" in url:
            return httpx.Response(200, json=[], request=request)
        if request.method == "GET" and "status=eq.open" in url:
            return httpx.Response(200, json=[target], request=request)
        if request.method == "PATCH" and "id=eq.manual-la-valisse" in url:
            target.update(json.loads(request.content))
            return httpx.Response(204, request=request)
        raise AssertionError(f"Unexpected request: {request.method} {url}")

    writer = SupabaseWriter("https://supabase.test", "service-key")
    writer.http = httpx.Client(
        base_url="https://supabase.test",
        transport=httpx.MockTransport(handler),
    )
    settlement = {
        "restaurant_id": "santo",
        "movement_id": "90359",
        "status": "settled",
        "settled_on": "2026-07-18",
        "settled_principal": 640.0,
        "source_workflow_run_id": "run-18",
        "evidence": {
            "kind": "settlement",
            "payment_medium": "transferencia",
        },
    }

    assert writer.upsert_corte_receivable(settlement) is True
    assert writer.upsert_corte_receivable(settlement) is True
    assert target["status"] == "open"
    assert target["settled_principal"] == 0.0
    assert target["evidence"]["pending_settlements"] == [{
        "movement_id": "90359",
        "amount": 640.0,
        "reported_on": "2026-07-18",
        "payment_medium": "transferencia",
        "source_workflow_run_id": "run-18",
    }]


def test_download_attachment_follows_agentmail_signed_url(monkeypatch) -> None:
    def inbox_handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).endswith("/inboxes/inbox/messages/msg/attachments/att")
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            json={"download_url": "https://cdn.agentmail.test/file"},
        )

    def signed_get(url: str, timeout: float) -> httpx.Response:
        assert url == "https://cdn.agentmail.test/file"
        assert timeout == 60.0
        return httpx.Response(200, content=b"real-attachment", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", signed_get)
    client = AgentMailClient("key", "inbox")
    client.http = httpx.Client(
        base_url="https://api.agentmail.to/v0",
        headers={"Authorization": "Bearer key"},
        transport=httpx.MockTransport(inbox_handler),
    )

    assert client.download_attachment("msg", "att") == b"real-attachment"


def test_list_messages_includes_unauthenticated_label() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"messages": []}, request=request)

    client = AgentMailClient("key", "inbox")
    client.http = httpx.Client(
        base_url="https://api.agentmail.to/v0",
        headers={"Authorization": "Bearer key"},
        transport=httpx.MockTransport(handler),
    )

    assert client.list_messages(after="2026-06-19T00:00:00Z") == []
    assert "include_unauthenticated=true" in seen["url"]
    assert "after=2026-06-19T00%3A00%3A00Z" in seen["url"]


def test_poll_hydrates_message_body_before_corte_automation(monkeypatch) -> None:
    seen: dict[str, object] = {}

    class FakeClient:
        def list_messages(self, after=None, limit=20):
            return [{
                "message_id": "msg-detail",
                "inbox_id": "santoos@agentmail.to",
                "from": "Operacion Santo <operacion@santojapones.com>",
                "to": ["santoos@agentmail.to"],
                "subject": "SANTO CORTE MARTES 14 JULIO 2026",
                "timestamp": "2026-07-15T10:00:00Z",
                "attachments": [],
            }]

        def get_message(self, message_id):
            assert message_id == "msg-detail"
            return {
                "body_text": "CXC movimiento 91678 por transferencia",
                "attachments": [{
                    "attachment_id": "att-1",
                    "filename": "attachment",
                    "content_type": "application/octet-stream",
                    "size": 10,
                }],
            }

    def fake_automation(**kwargs):
        seen["source_message"] = kwargs["source_message"]
        return {"status": "waiting_for_input"}

    monkeypatch.setattr("services.agent_mail.poller.run_corte_initial_from_message", fake_automation)
    monkeypatch.setattr("services.agent_mail.poller.summarize_email", lambda subject, body: None)

    results = poll_and_classify(
        FakeClient(),
        {
            "confirmed": True,
            "allowed_senders": ["operacion@santojapones.com"],
            "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"},
            "corte_santo_automation": {"enabled": True},
        },
    )

    assert results[0]["status"] == "classified"
    assert seen["source_message"]["body_text"] == "CXC movimiento 91678 por transferencia"
    assert _agentmail_to_intake_format(seen["source_message"])["body_text"] == "CXC movimiento 91678 por transferencia"


def test_supabase_email_upsert_uses_conflict_target() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(
            200,
            json=[{"id": "email-1"}],
            request=request,
        )

    writer = SupabaseWriter("https://supabase.test", "service-key")
    writer.http = httpx.Client(
        base_url="https://supabase.test",
        transport=httpx.MockTransport(handler),
    )

    result = writer.upsert_email_message(
        {
            "provider": "agentmail",
            "provider_message_id": "msg-1",
            "inbox_address": "inbox",
            "from_address": "from",
            "to_addresses": [],
            "cc_addresses": [],
            "processing_status": "classified",
            "raw_metadata": {},
        }
    )

    assert result == {"id": "email-1"}
    assert "on_conflict=provider%2Cprovider_message_id" in seen["url"]


def test_supabase_existing_email_lookup_filters_by_provider_message_id() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "email-1",
                    "provider": "agentmail",
                    "provider_message_id": "msg-1",
                    "processing_status": "classified",
                }
            ],
            request=request,
        )

    writer = SupabaseWriter("https://supabase.test", "service-key")
    writer.http = httpx.Client(
        base_url="https://supabase.test",
        transport=httpx.MockTransport(handler),
    )

    result = writer.get_email_message("agentmail", "msg-1")

    assert result and result["id"] == "email-1"
    assert "/rest/v1/email_messages" in seen["url"]
    assert "provider=eq.agentmail" in seen["url"]
    assert "provider_message_id=eq.msg-1" in seen["url"]


def test_message_content_fingerprint_matches_forwarded_duplicate() -> None:
    original = {
        "inbox_address": "santoos@agentmail.to",
        "subject": "SANTO CORTE JUEVES 18 JUNIO 2026",
        "attachments": [
            {"filename": "SANTO CORTE 18 JUNIO 2026.xlsx", "size": 49220},
            {"filename": "AMEX 18 JUNIO.jpeg", "size": 255000},
        ],
    }
    forwarded = {
        **original,
        "subject": "Fwd: SANTO CORTE JUEVES 18 JUNIO 2026",
        "attachments": list(reversed(original["attachments"])),
    }

    assert message_content_fingerprint(original) == message_content_fingerprint(forwarded)


def test_intake_records_message_content_fingerprint() -> None:
    result = intake_email(
        {
            "provider": "agentmail",
            "provider_message_id": "msg-1",
            "inbox_address": "santoos@agentmail.to",
            "from_address": "developer@santorestaurants.com",
            "subject": "SANTO CORTE JUEVES 18 JUNIO 2026",
            "attachments": [{"filename": "SANTO CORTE 18 JUNIO 2026.xlsx", "size": 49220}],
        },
        {
            "confirmed": True,
            "allowed_senders": ["developer@santorestaurants.com"],
            "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"},
        },
    )

    assert result["email_message"]["raw_metadata"]["message_content_fingerprint"]


def test_supabase_existing_email_lookup_filters_by_content_fingerprint() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "email-1",
                    "provider": "agentmail",
                    "provider_message_id": "msg-1",
                    "processing_status": "classified",
                }
            ],
            request=request,
        )

    writer = SupabaseWriter("https://supabase.test", "service-key")
    writer.http = httpx.Client(
        base_url="https://supabase.test",
        transport=httpx.MockTransport(handler),
    )

    result = writer.get_email_message_by_content_fingerprint("fingerprint-1")

    assert result and result["id"] == "email-1"
    assert "raw_metadata-%3E%3Emessage_content_fingerprint=eq.fingerprint-1" in seen["url"]


def test_poll_and_classify_skips_existing_live_email(monkeypatch) -> None:
    class FakeClient:
        def list_messages(self, after=None, limit=20):
            return [
                {
                    "message_id": "msg-1",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "SANTO CORTE JUEVES 18 JUNIO 2026",
                    "timestamp": "2026-06-19T17:34:00Z",
                    "attachments": [
                        {
                            "attachment_id": "att-1",
                            "filename": "SANTO CORTE 18 JUNIO 2026.xlsx",
                            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "size": 48100,
                        }
                    ],
                }
            ]

        def download_attachment(self, message_id, attachment_id):
            raise AssertionError("attachments must not be downloaded for skipped messages")

    class FakeSupabase:
        def get_email_message(self, provider, provider_message_id):
            assert provider == "agentmail"
            assert provider_message_id == "msg-1"
            return {
                "id": "email-1",
                "provider": provider,
                "provider_message_id": provider_message_id,
                "processing_status": "classified",
            }

        def get_email_message_by_content_fingerprint(self, fingerprint):
            raise AssertionError("message id match should short-circuit content fingerprint lookup")

    def fail_automation(**kwargs):
        raise AssertionError("corte automation must not run for skipped messages")

    monkeypatch.setattr("services.agent_mail.poller.run_corte_initial_from_message", fail_automation)

    results = poll_and_classify(
        FakeClient(),
        {"confirmed": True, "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"}},
        supabase=FakeSupabase(),
        dry_run=False,
    )

    assert results[0]["status"] == "skipped"
    assert results[0]["skipped_reason"] == "email_message_already_processed"


def test_poll_and_classify_skips_existing_content_duplicate(monkeypatch) -> None:
    class FakeClient:
        def list_messages(self, after=None, limit=20):
            return [
                {
                    "message_id": "msg-2",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "Fwd: SANTO CORTE JUEVES 18 JUNIO 2026",
                    "timestamp": "2026-06-19T20:56:00Z",
                    "attachments": [
                        {
                            "attachment_id": "att-1",
                            "filename": "SANTO CORTE 18 JUNIO 2026.xlsx",
                            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            "size": 49220,
                        }
                    ],
                }
            ]

    class FakeSupabase:
        def get_email_message(self, provider, provider_message_id):
            return None

        def get_email_message_by_content_fingerprint(self, fingerprint):
            assert fingerprint
            return {
                "id": "email-1",
                "provider": "agentmail",
                "provider_message_id": "msg-1",
                "processing_status": "classified",
            }

    def fail_automation(**kwargs):
        raise AssertionError("corte automation must not run for duplicate content")

    monkeypatch.setattr("services.agent_mail.poller.run_corte_initial_from_message", fail_automation)

    results = poll_and_classify(
        FakeClient(),
        {"confirmed": True, "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"}},
        supabase=FakeSupabase(),
        dry_run=False,
    )

    assert results[0]["status"] == "skipped"
    assert results[0]["skipped_reason"] == "email_message_already_processed"


def test_poll_and_classify_force_reprocess_bypasses_existing_email(monkeypatch) -> None:
    class FakeClient:
        def list_messages(self, after=None, limit=20):
            return [
                {
                    "message_id": "msg-1",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "SANTO CORTE JUEVES 18 JUNIO 2026",
                    "timestamp": "2026-06-19T17:34:00Z",
                    "attachments": [],
                }
            ]

    class FakeSupabase:
        def get_email_message(self, provider, provider_message_id):
            raise AssertionError("force reprocess should bypass message-id dedupe")

        def get_email_message_by_content_fingerprint(self, fingerprint):
            raise AssertionError("force reprocess should bypass content dedupe")

        def upsert_email_message(self, record):
            return {"id": "email-1", **record}

        def insert_event(self, event):
            return True

        def get_workflow_id(self, workflow_key):
            return None

    monkeypatch.setattr("services.agent_mail.poller.summarize_email", lambda subject, body: None)

    results = poll_and_classify(
        FakeClient(),
        {
            "confirmed": True,
            "allowed_senders": ["developer@santorestaurants.com"],
            "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"},
        },
        supabase=FakeSupabase(),
        dry_run=False,
        force_reprocess=True,
    )

    assert results[0]["status"] == "classified"
    assert results[0]["email_message"]["classification_key"] == "SANTO CORTE"


def test_poll_and_classify_filters_by_subject(monkeypatch) -> None:
    seen = {}

    class FakeClient:
        def list_messages(self, after=None, limit=20):
            seen["after"] = after
            seen["limit"] = limit
            return [
                {
                    "message_id": "msg-18",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "SANTO CORTE JUEVES 18 JUNIO 2026",
                    "timestamp": "2026-06-19T23:56:00Z",
                    "attachments": [],
                },
                {
                    "message_id": "msg-19",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "SANTO CORTE VIERNES 19 JUNIO 2026",
                    "timestamp": "2026-06-20T23:56:00Z",
                    "attachments": [],
                },
            ]

    monkeypatch.setattr("services.agent_mail.poller.summarize_email", lambda subject, body: None)

    results = poll_and_classify(
        FakeClient(),
        {
            "confirmed": True,
            "allowed_senders": ["developer@santorestaurants.com"],
            "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"},
        },
        after="2026-06-19T00:00:00Z",
        message_limit=5,
        subject_contains="18 JUNIO 2026",
    )

    assert seen == {"after": "2026-06-19T00:00:00Z", "limit": 5}
    assert len(results) == 1
    assert results[0]["email_message"]["provider_message_id"] == "msg-18"


def test_subject_filter_processes_most_complete_package_first(monkeypatch) -> None:
    class FakeClient:
        def list_messages(self, after=None, limit=20):
            return [
                {
                    "message_id": "msg-later",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "SANTO CORTE 17 JUNIO 2026",
                    "timestamp": "2026-06-18T17:00:00Z",
                    "attachments": [{"filename": "SANTO CORTE.xlsx", "size": 1}],
                },
                {
                    "message_id": "msg-complete",
                    "inbox_id": "santoos@agentmail.to",
                    "from": "Developer Santo <developer@santorestaurants.com>",
                    "to": ["santoos@agentmail.to"],
                    "subject": "SANTO CORTE 17 JUNIO 2026",
                    "timestamp": "2026-06-18T16:00:00Z",
                    "attachments": [
                        {"filename": "SANTO CORTE.xlsx", "size": 1},
                        {"filename": "AJUSTE DE CXC.jpeg", "size": 1},
                    ],
                },
            ]

    monkeypatch.setattr("services.agent_mail.poller.summarize_email", lambda subject, body: None)

    results = poll_and_classify(
        FakeClient(),
        {
            "confirmed": True,
            "allowed_senders": ["developer@santorestaurants.com"],
            "subject_prefixes": {"SANTO CORTE": "corte_santo_daily_sales_reconciliation"},
        },
        subject_contains="17 JUNIO 2026",
    )

    assert [item["email_message"]["provider_message_id"] for item in results] == ["msg-complete"]


def test_supabase_workflow_run_upsert_uses_conflict_target() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=[{"id": "run-1"}], request=request)

    writer = SupabaseWriter("https://supabase.test", "service-key")
    writer.http = httpx.Client(
        base_url="https://supabase.test",
        transport=httpx.MockTransport(handler),
    )

    result = writer.upsert_workflow_run(
        {
            "workflow_id": "workflow-1",
            "idempotency_key": "idem",
            "business_date": "2026-06-04",
            "status": "requires_review",
            "source_channel": "agent_mail",
        }
    )

    assert result == "run-1"
    assert "on_conflict=workflow_id%2Cidempotency_key" in seen["url"]
