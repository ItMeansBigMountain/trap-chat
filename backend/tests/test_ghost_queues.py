"""Nobody should be paired against a tab that was closed.

A dropped socket is deliberately not treated as leaving a queue: Socket.IO
reconnects on any blip, and treating that as a decision to leave used to pull
players out of their own queue. The cost of that choice was that a genuinely
closed tab stayed pairable for the full queue timeout, so the next person to
arrive started a match against somebody who was never coming back.

The seat still belongs to whoever took it -- they can come back to it -- it
just stops being offered to anybody else once they have not been seen.
"""

import importlib
import os
from datetime import datetime, timedelta


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


def go_quiet(module, match_id, seconds):
    """Age a queue's last-seen stamp, as a closed tab does by saying nothing."""
    with module.MATCH_LAST_SEEN_LOCK:
        module.MATCH_LAST_SEEN[match_id] = datetime.utcnow() - timedelta(seconds=seconds)


def test_a_queue_nobody_is_sitting_in_is_not_offered(tmp_path):
    ghost = guest(module := load(tmp_path))
    abandoned = queue(ghost)
    go_quiet(module, abandoned["match_id"], module.QUEUE_PRESENCE_GRACE_SECONDS + 10)

    arriving = queue(guest(module))
    assert arriving["match_id"] != abandoned["match_id"], (
        "paired into the abandoned queue, so the match starts against nobody"
    )
    assert arriving["status"] == "waiting"


def test_a_queue_somebody_is_sitting_in_is_offered(tmp_path):
    """The other half: presence must not make matchmaking stop working."""
    module = load(tmp_path)
    waiting = queue(guest(module))
    joined = queue(guest(module))

    assert joined["match_id"] == waiting["match_id"]
    assert joined["status"] == "active"


def test_a_brief_blip_does_not_lose_your_place(tmp_path):
    """Inside the grace window nothing changes, which is the whole point of
    not dequeueing on disconnect in the first place."""
    module = load(tmp_path)
    blipped = queue(guest(module))
    go_quiet(module, blipped["match_id"], module.QUEUE_PRESENCE_GRACE_SECONDS - 15)

    joined = queue(guest(module))
    assert joined["match_id"] == blipped["match_id"]
    assert joined["status"] == "active"


def test_the_ghost_can_still_come_back_to_their_own_queue(tmp_path):
    """Not being offered to others is not the same as being evicted."""
    module = load(tmp_path)
    ghost = guest(module)
    mine = queue(ghost)
    go_quiet(module, mine["match_id"], module.QUEUE_PRESENCE_GRACE_SECONDS + 10)

    assert queue(ghost)["match_id"] == mine["match_id"]


def test_queueing_marks_you_present_without_a_socket(tmp_path):
    """The HTTP call is itself being here.

    Presence defaults to when the process started, so on a long-running server
    a brand new queue would read as ancient and no second player could ever
    join it -- matchmaking broken outright, which is worse than the bug fixed.
    """
    module = load(tmp_path)
    module.PROCESS_STARTED_AT = datetime.utcnow() - timedelta(hours=3)

    first = queue(guest(module))
    second = queue(guest(module))
    assert second["match_id"] == first["match_id"]
    assert second["status"] == "active"
