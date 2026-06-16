import httpx

from services.agent_mail.notifications import send_notification


MESSAGE = {"to": "developer@santorestaurants.com", "subject": "Corte cargado", "text": "Listo"}


def test_notification_dry_run_is_ready() -> None:
    result = send_notification(MESSAGE, dry_run=True)
    assert result["status"] == "ready_to_send"


def test_notification_live_send(monkeypatch) -> None:
    monkeypatch.setenv("AGENTMAIL_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message_id": "msg-1"})

    result = send_notification(MESSAGE, dry_run=False, transport=httpx.MockTransport(handler))
    assert result["status"] == "sent"
