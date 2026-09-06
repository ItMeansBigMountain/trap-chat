"""Shared test setup.

Every test imports the same app module, so process-level state carries between
them. The rate limiter is the one piece that matters: a file that registers
several accounts would otherwise throttle the file that runs after it.
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

    # The module is imported once, so every test shares one database. A queue
    # left behind by an earlier test changes who the next one is paired with,
    # which makes matchmaking assertions fail only when the suite runs whole.
    try:
        with app_module.app.app_context():
            stale = app_module.Match.query.filter_by(status="waiting").all()
            for match in stale:
                app_module.MatchPlayer.query.filter_by(match_id=match.id).delete()
                app_module.db.session.delete(match)
            app_module.db.session.commit()
    except Exception:
        # A test that has not created its tables yet has nothing to clear.
        pass

    yield
