"""Guards that backend responses match the shapes the frontend declares in
frontend/expo/src/types/index.ts. A mismatch here does not fail any build, it
just renders undefined in the UI, so it needs a test."""

import importlib
import os


def load_app(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    return module.app


def register(client, username):
    return client.post(
        "/api/auth/register",
        json={"username": username, "password": "Str0ng-Pass!1"},
    )


def test_quick_match_players_match_the_declared_typescript_shape(tmp_path):
    """MatchmakingResponse declares players as { display_name: string }[], and
    the player_joined socket event already sends objects. Returning bare
    strings here makes player.display_name undefined in the UI."""
    app = load_app(tmp_path)
    client = app.test_client()
    register(client, "contract_player")

    response = client.post("/api/matches/quick", json={"game_slug": "rapbattle"})

    assert response.status_code == 200, response.get_data(as_text=True)
    players = response.get_json()["players"]
    assert players, "expected at least one player"
    for player in players:
        assert isinstance(player, dict), f"expected an object, got {player!r}"
        assert "display_name" in player, f"missing display_name in {player!r}"


def test_credentialed_cors_works_without_an_explicit_frontend_origin(tmp_path):
    """The frontend sends every request with credentials: 'include'. Browsers
    reject such a response unless Access-Control-Allow-Credentials is true, so
    a backend started without FRONTEND_ORIGIN (local development) must still
    negotiate credentialed CORS or the whole UI fails to talk to it."""
    app = load_app(tmp_path)
    client = app.test_client()

    response = client.options(
        "/api/auth/me",
        headers={
            "Origin": "http://127.0.0.1:8100",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.headers.get("Access-Control-Allow-Credentials") == "true", (
        f"missing credentials header; got {dict(response.headers)}"
    )
    assert response.headers.get("Access-Control-Allow-Origin") == "http://127.0.0.1:8100", (
        "must echo the caller's origin: browsers reject '*' on credentialed requests"
    )
