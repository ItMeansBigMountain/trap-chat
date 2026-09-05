import importlib
import sys

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'trapchat.db'}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    sys.modules.pop("app", None)
    module = importlib.import_module("app")
    module.app.config.update(TESTING=True)
    return module.app.test_client()


def test_registration_rejects_short_password(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "valid-user", "password": "short"},
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "password must be at least 8 characters"}


def test_registration_rejects_invalid_username(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "not valid!", "password": "password-123"},
    )

    assert response.status_code == 400
    assert response.get_json() == {"error": "username must be 3-50 letters, numbers, _ or -"}


def test_authenticated_user_can_fetch_complete_profile(client):
    client.post(
        "/api/auth/register",
        json={"username": "profile-user", "email": "profile@example.test", "password": "password-123"},
    )

    response = client.get("/api/auth/me")

    assert response.status_code == 200
    assert response.get_json()["user"] == {
        "id": 1,
        "username": "profile-user",
        "email": "profile@example.test",
        "preferences": {},
        "rating": 1000,
        "lat": None,
        "lng": None,
    }
