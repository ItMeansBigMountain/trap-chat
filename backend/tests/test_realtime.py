import importlib
import sys

import pytest


@pytest.fixture
def backend(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'trapchat.db'}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    sys.modules.pop("app", None)
    return importlib.import_module("app")


def guest_with_match(backend):
    http = backend.app.test_client()
    http.post("/api/auth/guest")
    match = http.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    socket = backend.socketio.test_client(backend.app, flask_test_client=http)
    return http, socket, match


def event_payload(client, name):
    return [item["args"][0] for item in client.get_received() if item["name"] == name]


def test_match_member_can_join_and_relay_chat_and_signals(backend):
    _, first, match = guest_with_match(backend)
    _, second, opponent_match = guest_with_match(backend)
    assert opponent_match["match_id"] == match["match_id"]

    first.emit("join_match", {"match_id": match["match_id"]})
    second.emit("join_match", {"match_id": match["match_id"]})
    first.get_received()
    second.get_received()

    first.emit("chat_message", {"match_id": match["match_id"], "text": "hello"})
    chats = event_payload(second, "chat_message")
    assert chats[0]["match_id"] == match["match_id"]
    assert chats[0]["text"] == "hello"
    assert chats[0]["from"].startswith("Guest_")

    first.emit("signal", {"match_id": match["match_id"], "type": "offer", "offer": {"sdp": "test"}})
    signals = event_payload(second, "signal")
    assert signals[0]["type"] == "offer"
    assert signals[0]["offer"] == {"sdp": "test"}


def test_non_member_cannot_join_or_send_to_match(backend):
    _, member, match = guest_with_match(backend)
    outsider_http = backend.app.test_client()
    outsider_http.post("/api/auth/guest")
    outsider = backend.socketio.test_client(backend.app, flask_test_client=outsider_http)

    member.emit("join_match", {"match_id": match["match_id"]})
    member.get_received()
    outsider.emit("join_match", {"match_id": match["match_id"]})
    errors = event_payload(outsider, "error")
    assert errors == [{"message": "not a player in this match", "code": "forbidden"}]

    outsider.emit("chat_message", {"match_id": match["match_id"], "text": "intrusion"})
    assert event_payload(member, "chat_message") == []
