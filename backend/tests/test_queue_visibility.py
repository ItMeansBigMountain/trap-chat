"""The Competitive screen used to infer "nobody else is queued" from nothing
having happened yet. That inference is wrong whenever two people queue for
different games, and it looks exactly like broken matchmaking. The server
knows who is waiting, so these pin that it says so."""

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


def test_an_empty_queue_reports_nobody_waiting(tmp_path):
    module = load(tmp_path)
    watcher = guest(module)

    state = watcher.get("/api/games/pushups/queue").get_json()

    assert state["others_waiting"] == 0
    assert state["you_are_waiting"] is False
    assert state["game_name"] == "Push-Ups"


def test_someone_else_waiting_is_visible(tmp_path):
    module = load(tmp_path)
    waiting = guest(module)
    waiting.post("/api/matches/quick", json={"game_slug": "pushups"})

    state = guest(module).get("/api/games/pushups/queue").get_json()

    assert state["others_waiting"] == 1, state
    assert state["you_are_waiting"] is False


def test_your_own_queue_is_not_counted_as_an_opponent(tmp_path):
    """Counting yourself would promise a match that can never happen: the
    server will not pair a player with themselves."""
    module = load(tmp_path)
    me = guest(module)
    me.post("/api/matches/quick", json={"game_slug": "pushups"})

    state = me.get("/api/games/pushups/queue").get_json()

    assert state["others_waiting"] == 0, state
    assert state["you_are_waiting"] is True


def test_queues_are_per_game(tmp_path):
    """The bug this endpoint exists for. Two people queue, each for a different
    game, and both correctly wait forever. Each has to be able to see that the
    other is not in their queue."""
    module = load(tmp_path)
    rapper = guest(module)
    rapper.post("/api/matches/quick", json={"game_slug": "rapbattle"})

    lifter = guest(module)
    lifter.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert lifter.get("/api/games/pushups/queue").get_json()["others_waiting"] == 0
    assert rapper.get("/api/games/rapbattle/queue").get_json()["others_waiting"] == 0
    # ...and each can see the other's queue is occupied.
    assert lifter.get("/api/games/rapbattle/queue").get_json()["others_waiting"] == 1


def test_a_stale_queue_entry_is_not_advertised(tmp_path):
    """Someone who queued and closed their tab an hour ago is not an opponent,
    and promising one would be worse than saying the queue is empty."""
    from datetime import datetime, timedelta

    module = load(tmp_path)
    ghost = guest(module)
    result = ghost.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    with module.app.app_context():
        match = module.db.session.get(module.Match, result["match_id"])
        match.created_at = datetime.utcnow() - timedelta(
            minutes=module.QUEUE_TIMEOUT_MINUTES + 5
        )
        module.db.session.commit()

    state = guest(module).get("/api/games/pushups/queue").get_json()

    assert state["others_waiting"] == 0, state


def test_a_match_already_underway_is_not_a_queue(tmp_path):
    """Two players mid-match are not available to pair with."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)
    one.post("/api/matches/quick", json={"game_slug": "pushups"})
    two.post("/api/matches/quick", json={"game_slug": "pushups"})

    state = guest(module).get("/api/games/pushups/queue").get_json()

    assert state["others_waiting"] == 0, state
