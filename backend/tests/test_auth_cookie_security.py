import importlib
import sys


def load_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'trapchat.db'}")
    monkeypatch.setenv("SECRET_KEY", "test-secret")
    monkeypatch.setenv("FRONTEND_ORIGIN", "https://trap-chat.example")
    sys.modules.pop("app", None)
    module = importlib.import_module("app")
    module.app.config.update(TESTING=True)
    return module.app.test_client()


def test_cross_origin_registration_uses_secure_samesite_none_cookie(tmp_path, monkeypatch):
    client = load_client(tmp_path, monkeypatch)

    response = client.post(
        "/api/auth/register",
        json={"username": "secure-cookie-user", "password": "password-123"},
    )

    assert response.status_code == 200
    cookie = response.headers["Set-Cookie"]
    assert "HttpOnly" in cookie
    assert "Secure" in cookie
    assert "SameSite=None" in cookie
