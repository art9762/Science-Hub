from fastapi.testclient import TestClient
import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SCIENCE_HUB_API_KEY", "")
    from backend.app import create_app

    with TestClient(create_app(tmp_path)) as instance:
        yield instance


def test_local_health_and_uniform_errors(client):
    assert client.get("/api/health").json()["storage"] == "local"
    response = client.get("/api/projects/not-here")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    response = client.post("/api/projects", json={})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get("/api/no-such-route").status_code == 404


def test_cross_origin_mutations_and_untrusted_host_rejected(client):
    response = client.post(
        "/api/projects", json={"name": "Attacker"}, headers={"Origin": "https://outside.example"}
    )
    assert response.status_code == 403
    assert client.get("/api/projects").json() == []
    response = client.get("/api/health", headers={"Host": "outside.example"})
    assert response.status_code == 400
    response = client.post(
        "/api/projects", json={"name": "Local"}, headers={"Origin": "http://127.0.0.1:8765"}
    )
    assert response.status_code in (200, 201)


def test_private_headers_and_key_absence(client):
    response = client.get("/api/settings")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    for provider in response.json()["providers"]:
        assert "api_key" not in provider
        assert "has_key" in provider
