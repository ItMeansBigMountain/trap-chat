import importlib
import os


def load_app(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    return module.app


def test_api_health_reports_database_ready(tmp_path):
    app = load_app(tmp_path)

    response = app.test_client().get("/api/health")

    assert response.status_code == 200
    # Asserted field by field rather than as a whole dict: health grows over
    # time, and an exact match makes every addition a failing test.
    body = response.get_json()
    assert body["ok"] is True
    assert body["service"] == "trap-chat-backend"
    assert body["storage"] == "sqlite"
    assert body["productionReadyStorage"] is True
    assert "version" in body, "deploys are waited on by version, so it must be reported"


def test_games_endpoint_returns_seeded_games(tmp_path):
    app = load_app(tmp_path)

    response = app.test_client().get("/api/games")

    assert response.status_code == 200
    assert {game["slug"] for game in response.get_json()} >= {"pushups", "squats", "rapbattle"}
