import httpx

from services.agent_mail.poller import AgentMailClient
from services.agent_mail.poller import SupabaseWriter


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
