"""Login is the one endpoint worth guessing at, so it cannot be free to try
forever."""

import importlib
import os


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    module.reset_rate_limits()
    return module


def test_repeated_bad_passwords_get_locked_out(tmp_path):
    module = load(tmp_path)
    client = module.app.test_client()
    client.post("/api/auth/register", json={"username": "target", "password": "Str0ng-Pass!1"})

    statuses = []
    for _ in range(12):
        response = client.post(
            "/api/auth/login",
            json={"username": "target", "password": "wrong-guess"},
            environ_overrides={"REMOTE_ADDR": "203.0.113.7"},
        )
        statuses.append(response.status_code)

    assert 429 in statuses, f"guessing was never throttled: {statuses}"


def test_a_throttled_caller_is_told_to_wait(tmp_path):
    module = load(tmp_path)
    client = module.app.test_client()
    for _ in range(12):
        response = client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "x"},
            environ_overrides={"REMOTE_ADDR": "203.0.113.8"},
        )
    assert response.status_code == 429
    assert "retry_after" in response.get_json()


def test_a_different_caller_is_unaffected(tmp_path):
    """Throttling is per caller. One person guessing must not lock everyone
    else out of the product."""
    module = load(tmp_path)
    client = module.app.test_client()
    client.post("/api/auth/register", json={"username": "bystander", "password": "Str0ng-Pass!1"})

    for _ in range(12):
        client.post(
            "/api/auth/login",
            json={"username": "bystander", "password": "wrong"},
            environ_overrides={"REMOTE_ADDR": "203.0.113.9"},
        )

    allowed = client.post(
        "/api/auth/login",
        json={"username": "bystander", "password": "Str0ng-Pass!1"},
        environ_overrides={"REMOTE_ADDR": "198.51.100.4"},
    )

    assert allowed.status_code == 200, allowed.get_data(as_text=True)


def test_a_correct_password_still_works_within_the_limit(tmp_path):
    module = load(tmp_path)
    client = module.app.test_client()
    client.post("/api/auth/register", json={"username": "normal", "password": "Str0ng-Pass!1"})

    for _ in range(3):
        client.post(
            "/api/auth/login",
            json={"username": "normal", "password": "wrong"},
            environ_overrides={"REMOTE_ADDR": "198.51.100.9"},
        )
    response = client.post(
        "/api/auth/login",
        json={"username": "normal", "password": "Str0ng-Pass!1"},
        environ_overrides={"REMOTE_ADDR": "198.51.100.9"},
    )

    assert response.status_code == 200, response.get_data(as_text=True)
