import os

import pytest


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    """Every test gets its own DATA_DIR + fresh DB engine."""
    monkeypatch.setenv("DRAFTENGINE_DATA_DIR", str(tmp_path / "data"))
    from draftengine import db

    db.reset_engine()
    yield
    db.reset_engine()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from draftengine.main import create_app

    with TestClient(create_app()) as c:
        yield c


os.environ.setdefault("DRAFTENGINE_OFFLINE", "1")
