import httpx

from services.agent_mail.poller import AgentMailClient


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
