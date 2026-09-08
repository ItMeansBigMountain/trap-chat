"""Shared test setup.

Every test imports the same app module, so process-level state carries between
them: the rate limiter, presence stamps, and the database itself. Each has
caused a failure that only appeared when the whole suite ran, so each is reset
here rather than discovered again.
"""

import sys

import pytest


@pytest.fixture(autouse=True)
def reset_process_state():
    app_module = sys.modules.get("app")
    if app_module is None:
        yield
        return

    if hasattr(app_module, "reset_rate_limits"):
        app_module.reset_rate_limits()

    # Presence is keyed by match id, and match ids restart at 1 for every
    # test database. Without clearing it a test inherits the last-seen stamp
    # of some unrelated match from an earlier file, so its queue reads as
    # abandoned and nobody pairs -- only when the suite runs whole.
    if hasattr(app_module, "MATCH_LAST_SEEN"):
        with app_module.MATCH_LAST_SEEN_LOCK:
            app_module.MATCH_LAST_SEEN.clear()

    # The module is imported once, so every test shares one database. A queue
    # left behind by an earlier test changes who the next one is paired with,
    # which makes matchmaking assertions fail only when the suite runs whole.
    try:
        with app_module.app.app_context():
            stale = app_module.Match.query.filter_by(status="waiting").all()
            for match in stale:
                app_module.MatchPlayer.query.filter_by(match_id=match.id).delete()
                app_module.db.session.delete(match)
            # Events accumulate for the same reason and make every count in
            # the metrics tests depend on which files ran first. Blocks are
            # worse: one left behind silently changes who a later test is
            # allowed to be matched with.
            for name in ("Event", "Block", "Report"):
                model = getattr(app_module, name, None)
                if model is not None:
                    model.query.delete()
            app_module.db.session.commit()
    except Exception:
        # A test that has not created its tables yet has nothing to clear.
        pass

    yield
