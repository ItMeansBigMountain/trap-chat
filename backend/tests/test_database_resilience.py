import importlib
import os


def load_app(tmp_path):
    os.environ["DATABASE_URL"] = f"sqlite:///{tmp_path / 'trapchat.db'}"
    os.environ["SECRET_KEY"] = "test-secret"
    module = importlib.import_module("app")
    return module


def test_sqlite_connections_wait_for_a_locked_database(tmp_path):
    """In production the SQLite file lives on an Azure Files share that a
    restarting revision may still hold open. Connections must wait for the
    lock instead of failing immediately with "database is locked", which
    otherwise kills the Gunicorn worker before it can bind a port."""
    module = load_app(tmp_path)

    with module.app.app_context():
        with module.db.engine.connect() as connection:
            busy_timeout_ms = connection.exec_driver_sql("PRAGMA busy_timeout").scalar()

    assert busy_timeout_ms >= 30000, (
        f"expected a busy timeout of at least 30s, got {busy_timeout_ms}ms"
    )
