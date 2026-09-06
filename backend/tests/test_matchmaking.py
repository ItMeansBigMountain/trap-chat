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


def create_guest(client):
    response = client.post("/api/auth/guest")
    assert response.status_code == 200
    return response


def test_quick_match_requires_an_identifiable_guest_or_authenticated_user(client):
    response = client.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert response.status_code == 401
    assert response.get_json() == {"error": "guest session required"}


def test_quick_match_does_not_add_the_same_guest_twice(client):
    create_guest(client)

    first = client.post("/api/matches/quick", json={"game_slug": "pushups"})
    second = client.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json()["match_id"] == first.get_json()["match_id"]
    assert second.get_json()["status"] == "waiting"
    assert len(second.get_json()["players"]) == 1


def test_two_distinct_guests_activate_a_quick_match(client):
    create_guest(client)
    first = client.post("/api/matches/quick", json={"game_slug": "pushups"})

    opponent = client.application.test_client()
    create_guest(opponent)
    second = opponent.post("/api/matches/quick", json={"game_slug": "pushups"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.get_json()["match_id"] == first.get_json()["match_id"]
    assert second.get_json()["status"] == "active"
    assert len(second.get_json()["players"]) == 2


def test_quick_match_ignores_a_stale_waiting_match(tmp_path):
    """A waiting match whose player closed their tab hours ago must not be
    handed to the next person: they would sit in a room with a ghost."""
    import importlib
    import os
    from datetime import datetime, timedelta

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    app = module.app

    abandoner = app.test_client()
    abandoner.post("/api/auth/register", json={"username": "ghost_player", "password": "Str0ng-Pass!1"})
    first = abandoner.post("/api/matches/quick", json={"game_slug": "rapbattle"})
    assert first.status_code == 200
    stale_match_id = first.get_json()["match_id"]

    # Age that queued match well past any sensible window.
    with app.app_context():
        stale = module.db.session.get(module.Match, stale_match_id)
        stale.created_at = datetime.utcnow() - timedelta(hours=3)
        module.db.session.commit()

    newcomer = app.test_client()
    newcomer.post("/api/auth/register", json={"username": "fresh_player", "password": "Str0ng-Pass!1"})
    second = newcomer.post("/api/matches/quick", json={"game_slug": "rapbattle"})

    assert second.status_code == 200, second.get_data(as_text=True)
    body = second.get_json()
    assert body["match_id"] != stale_match_id, "joined an abandoned queue instead of starting a fresh one"
    assert body["status"] == "waiting"


def test_a_guest_and_an_account_pair_with_each_other(tmp_path):
    """The two tabs people actually test with: one signed in, one guest."""
    import importlib
    import os

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    app = module.app

    guest = app.test_client()
    assert guest.post("/api/auth/guest").status_code == 200

    account = app.test_client()
    assert account.post(
        "/api/auth/register", json={"username": "pair_acct", "password": "Str0ng-Pass!1"}
    ).status_code == 200

    first = guest.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    second = account.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    assert first["match_id"] == second["match_id"], "queued separately instead of pairing"
    assert second["status"] == "active"


def test_requeueing_activates_a_match_that_already_has_two_players(tmp_path):
    """Re-queueing returns the match you are already in. If the pair is
    complete by then, that path still has to start the match, otherwise both
    players sit on 'searching' forever while the room quietly has two people
    in it."""
    import importlib
    import os

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    app = module.app

    one = app.test_client()
    one.post("/api/auth/guest")
    two = app.test_client()
    two.post("/api/auth/guest")

    queued = one.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()
    match_id = queued["match_id"]

    # Second player joins the same match, but leave it marked waiting to stand
    # in for any path that added a player without starting the match.
    two.post("/api/matches/quick", json={"game_slug": "pushups"})
    with app.app_context():
        match = module.db.session.get(module.Match, match_id)
        match.status = "waiting"
        module.db.session.commit()

    again = one.post("/api/matches/quick", json={"game_slug": "pushups"}).get_json()

    assert again["match_id"] == match_id
    assert again["status"] == "active", "a full match was handed back still waiting"


def test_simultaneous_queuers_do_not_each_create_their_own_match(tmp_path):
    """Two people hitting the queue at the same instant must meet, not both
    read an empty queue and both open a match nobody else can see."""
    import importlib
    import os
    import threading

    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    app = module.app

    clients = []
    for _ in range(2):
        client = app.test_client()
        client.post("/api/auth/guest")
        clients.append(client)

    results = {}
    barrier = threading.Barrier(len(clients))

    def queue(index):
        barrier.wait()  # line them up so they really do collide
        results[index] = clients[index].post(
            "/api/matches/quick", json={"game_slug": "pushups"}
        ).get_json()

    threads = [threading.Thread(target=queue, args=(i,)) for i in range(len(clients))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    ids = {r["match_id"] for r in results.values()}
    assert len(ids) == 1, f"queued into separate matches: {ids}"
    assert any(r["status"] == "active" for r in results.values())
