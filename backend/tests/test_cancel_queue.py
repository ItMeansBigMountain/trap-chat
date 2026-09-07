"""Cancelling a search used to be client-side only. The screen stopped
searching and the server entry sat there for the whole queue timeout, so the
next player was paired with somebody who had walked away and then waited for a
match that could never start."""

import importlib
import os


def load(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    return importlib.import_module("app")


def guest(module):
    client = module.app.test_client()
    client.post("/api/auth/guest")
    return client


def queue(client, slug="pushups"):
    return client.post("/api/matches/quick", json={"game_slug": slug}).get_json()


def cancel(client, slug="pushups"):
    return client.post("/api/matches/quick/cancel", json={"game_slug": slug})


def test_cancelling_removes_you_from_the_queue(tmp_path):
    module = load(tmp_path)
    one = guest(module)
    queue(one)

    response = cancel(one)

    assert response.status_code == 200, response.get_data(as_text=True)
    assert response.get_json()["left"] == 1
    watcher = guest(module)
    assert watcher.get("/api/games/pushups/queue").get_json()["others_waiting"] == 0


def test_nobody_is_paired_with_someone_who_cancelled(tmp_path):
    """The whole point. A cancelled player must not be handed to the next
    arrival as an opponent."""
    module = load(tmp_path)
    leaver = guest(module)
    queue(leaver)
    cancel(leaver)

    arriving = guest(module)
    result = queue(arriving)

    assert result["status"] == "waiting", (
        "paired with a player who had already cancelled"
    )
    assert len(result["players"]) == 1, result


def test_cancelling_an_empty_queue_is_harmless(tmp_path):
    module = load(tmp_path)
    one = guest(module)

    response = cancel(one)

    assert response.status_code == 200
    assert response.get_json()["left"] == 0


def test_cancelling_does_not_touch_a_match_that_started(tmp_path):
    """Once a match is active, cancelling is not how you leave: forfeiting is.
    Silently removing a player from a live match would end it for both."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    queue(one)
    started = queue(two)
    assert started["status"] == "active"

    cancel(one)

    with module.app.app_context():
        match = module.db.session.get(module.Match, started["match_id"])
        assert match is not None, "cancelling deleted a live match"
        assert len(module.present_players(match)) == 2, "cancelling emptied a live match"


def test_cancelling_one_game_leaves_another_queue_alone(tmp_path):
    module = load(tmp_path)
    one = guest(module)
    queue(one, "pushups")
    queue(one, "squats")

    cancel(one, "pushups")

    watcher = guest(module)
    assert watcher.get("/api/games/pushups/queue").get_json()["others_waiting"] == 0
    assert watcher.get("/api/games/squats/queue").get_json()["others_waiting"] == 1
