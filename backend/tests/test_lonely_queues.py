"""Two people, the same game, both stuck on "you are the only one in this
queue" while sitting in separate empty queues.

Re-queueing used to return the waiting match you were already in without ever
looking for an opponent, so once both players had a queue of their own neither
could see the other. Every earlier matchmaking test queued each player exactly
once, which is the one case where this cannot happen.
"""

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


def test_two_players_each_already_queued_still_pair(tmp_path):
    """The exact reported failure: both queue, get nothing, and queue again."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)

    # Both queue while the other is not yet visible, so each opens its own.
    first = queue(one)
    with module.app.app_context():
        # Force the situation the lock normally prevents: two separate waiting
        # matches for one game, which is what repeated queueing produced.
        match = module.db.session.get(module.Match, first["match_id"])
        match.status = "waiting"
        module.db.session.commit()

    second = queue(two)

    assert second["match_id"] == first["match_id"], (
        "the second player opened their own queue instead of joining the first"
    )
    assert second["status"] == "active", second


def test_requeueing_from_a_lonely_queue_finds_a_waiting_opponent(tmp_path):
    """One player is already sitting in an empty queue when another arrives.
    Asking again has to pair them, not hand back the same empty room."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)

    queue(one)          # one is alone in match A
    queue(two)          # two joins A, which fills and starts
    again = queue(one)  # one asks again

    assert again["status"] == "active", again


def test_a_second_queue_attempt_does_not_strand_you(tmp_path):
    """Queueing twice in a row must leave exactly one live queue entry, or the
    next arrival can pair with the copy you are no longer watching."""
    module = load(tmp_path)
    one = guest(module)

    first = queue(one)
    second = queue(one)

    assert first["match_id"] == second["match_id"], "queueing twice made two rooms"
    with module.app.app_context():
        live = [
            m
            for m in module.Match.query.filter_by(status="waiting").all()
            if module.present_players(m)
        ]
        assert len(live) == 1, f"expected one live queue, found {len(live)}"


def test_pairing_wins_over_the_queue_you_are_already_in(tmp_path):
    """Given a choice between your own empty queue and one with a real
    opponent in it, the opponent wins."""
    module = load(tmp_path)
    one, two = guest(module), guest(module)

    mine = queue(one)
    with module.app.app_context():
        # Someone else is waiting in a separate room for the same game.
        theirs = module.Match(
            game_id=module.Game.query.filter_by(slug="pushups").first().id,
            room_code="OTHERQUE",
            status="waiting",
        )
        module.db.session.add(theirs)
        module.db.session.commit()
        module.db.session.add(module.MatchPlayer(
            match_id=theirs.id,
            guest_session_id="someone-else",
            display_name="Rival#000000",
        ))
        module.db.session.commit()
        rival_match = theirs.id

    again = queue(one)

    assert again["match_id"] == rival_match, (
        f"stayed in the empty queue {mine['match_id']} instead of joining {rival_match}"
    )
    assert again["status"] == "active", again
