from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.sources import save_web_source
from backend.storage import Store


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        yield client


def test_legacy_chat_migration_is_atomic_and_preserves_history(tmp_path):
    store = Store(tmp_path)
    pid = store.create_project("Legacy")["id"]
    run = store.put(pid, "run", {"prompt": "Old task", "status": "completed"})
    message = store.put(pid, "message", {"run_id": run["id"], "content": "Old answer"})
    event = store.put(pid, "event", {"run_id": run["id"], "message": "Done"})
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: store.ensure_chats(pid), range(8)))
    assert len(store.list(pid, "chat")) == 1
    chat_id = store.list(pid, "chat")[0]["id"]
    for kind, item in (("run", run), ("message", message), ("event", event)):
        assert store.get(pid, kind, item["id"])["chat_id"] == chat_id
    assert Store(tmp_path).get(pid, "message", message["id"])["content"] == "Old answer"
    # New-format runs with a missing event chat_id inherit their existing chat.
    store.put(pid, "event", {"run_id": run["id"], "message": "Restart"})
    store.ensure_chats(pid)
    assert len(store.list(pid, "chat")) == 1
    assert store.list(pid, "event")[-1]["chat_id"] == chat_id


def test_chat_routes_isolation_delete_and_shared_materials(client):
    pid = client.post("/api/projects", json={"name": "Research"}).json()["id"]
    other = client.post("/api/projects", json={"name": "Other"}).json()["id"]
    base = f"/api/projects/{pid}"
    assert client.get(base + "/state").json()["chats"] == []
    first = client.post(base + "/chats", json={"title": "  First  "}).json()
    second = client.post(base + "/chats", json={}).json()
    assert first["title"] == "First"
    assert client.patch(base + f"/chats/{first['id']}", json={"title": "Updated"}).json()["title"] == "Updated"
    assert client.post(base + "/chats", json={"title": "  "}).status_code == 422
    assert client.patch(f"/api/projects/{other}/chats/{first['id']}", json={"title": "Bad"}).status_code == 404
    store = client.app.state.store
    for chat in (first, second):
        run = store.put(pid, "run", {"chat_id": chat["id"], "status": "completed"})
        store.put(pid, "message", {"chat_id": chat["id"], "run_id": run["id"], "content": chat["title"]})
        store.put(pid, "event", {"chat_id": chat["id"], "run_id": run["id"], "message": "Completed"})
    doc = store.put(pid, "workspace_document", {"title": "Shared", "content": "Keep me"})
    board = store.put(pid, "board_item", {"text": "Shared board"})
    assert client.delete(base + f"/chats/{first['id']}").status_code == 204
    state = client.get(base + "/state").json()
    for key in ("chats", "messages", "runs", "events"):
        assert len(state[key]) == 1
    assert state["workspace_documents"][0]["id"] == doc["id"]
    assert state["board_items"][0]["id"] == board["id"]


def test_web_sources_are_searchable_deduplicated_and_downloadable(client):
    pid = client.post("/api/projects", json={"name": "Research"}).json()["id"]
    other = client.post("/api/projects", json={"name": "Other"}).json()["id"]
    base = f"/api/projects/{pid}"
    folder = client.post(base + "/folders", json={"name": "Sources"}).json()
    data = {"url": "https://example.org/paper#section", "title": "Paper", "snippet": "Quantum result", "source": "arxiv", "folder_id": folder["id"]}
    response = client.post(base + "/documents/web", json=data)
    assert response.status_code == 201
    doc = response.json()
    assert doc["metadata"]["content_kind"] == "search_snippet"
    assert doc["folder_id"] == folder["id"] and "file_path" not in doc
    assert client.post(base + "/documents/web", json=data).json()["id"] == doc["id"]
    state = client.get(base + "/state").json()
    assert len(state["documents"]) == 1 and state["board_items"] == []
    assert client.get(base + "/search?q=Quantum").json()[0]["document_id"] == doc["id"]
    upgraded = save_web_source(client.app.state.store, pid, data, content="Full experiment detail")
    assert upgraded["id"] == doc["id"]
    assert save_web_source(client.app.state.store, pid, data)["metadata"]["content_kind"] == "web_page"
    assert "Full experiment detail" in client.get(base + f"/documents/{doc['id']}/file").text
    assert client.get(f"/api/projects/{other}/documents/{doc['id']}").status_code == 404
    assert client.post(f"/api/projects/{other}/documents/web", json=data).status_code == 404
    assert client.post(base + "/documents/web", json={"url": "javascript:bad()"}).status_code == 422


@pytest.mark.asyncio
async def test_chat_history_is_separate_while_project_materials_are_shared(tmp_path, monkeypatch):
    from backend.ai import Runner
    from backend.providers import Settings

    monkeypatch.setenv("SCIENCE_HUB_API_KEY", "synthetic-test-key")
    monkeypatch.setenv("SCIENCE_HUB_MODEL", "mock-model")
    store = Store(tmp_path)
    pid = store.create_project("Chat isolation")["id"]
    first = store.put(pid, "chat", {"title": "First"})
    second = store.put(pid, "chat", {"title": "Second"})
    store.put(pid, "message", {"chat_id": first["id"], "content": "EXCLUDED_OTHER_CHAT", "role": "user"})
    store.put(pid, "message", {"chat_id": second["id"], "content": "INCLUDED_CURRENT_CHAT", "role": "user"})
    store.put(pid, "document", {"name": "Shared source", "text": "Shared text"})
    run = store.put(pid, "run", {"chat_id": second["id"], "prompt": "Continue", "mode": "chat", "status": "queued"})
    requests = []

    class Adapter:
        async def complete(self, **kwargs):
            requests.append(kwargs)
            return {"content": "Done", "tool_calls": []}

    monkeypatch.setattr("backend.ai.adapter_for", lambda _: Adapter())
    await Runner(store, pid, run, Settings(tmp_path)).execute()
    import json
    context = json.dumps(requests[0]["messages"])
    assert "INCLUDED_CURRENT_CHAT" in context and "EXCLUDED_OTHER_CHAT" not in context
    assert "Shared source" in context
    assert all(item.get("chat_id") == second["id"] for item in store.list(pid, "event"))
    assert store.list(pid, "message")[-1]["chat_id"] == second["id"]


def test_run_chat_validation_and_active_chat_delete(client, monkeypatch):
    import asyncio
    import threading

    monkeypatch.setenv("SCIENCE_HUB_API_KEY", "synthetic-test-key")
    monkeypatch.setenv("SCIENCE_HUB_MODEL", "mock-model")
    pid = client.post("/api/projects", json={"name": "Runs"}).json()["id"]
    other = client.post("/api/projects", json={"name": "Other"}).json()["id"]
    base = f"/api/projects/{pid}"
    chat = client.post(base + "/chats", json={}).json()
    started = threading.Event()

    class Waiting:
        async def complete(self, **kwargs):
            started.set()
            await asyncio.Event().wait()

    monkeypatch.setattr("backend.ai.adapter_for", lambda _: Waiting())
    assert client.post(f"/api/projects/{other}/runs", json={"chat_id": chat["id"], "prompt": "Bad"}).status_code == 404
    response = client.post(base + "/runs", json={"chat_id": chat["id"], "prompt": "First question"})
    assert response.status_code == 202 and response.json()["chat_id"] == chat["id"]
    assert started.wait(2)
    assert client.get(base + "/chats").json()[0]["title"] == "First question"
    assert client.delete(base + f"/chats/{chat['id']}").status_code == 204
    state = client.get(base + "/state").json()
    assert state["chats"] == state["runs"] == state["messages"] == state["events"] == []


@pytest.mark.parametrize("delayed_content", [None, "New full page text"])
def test_web_source_save_atomically_preserves_full_text_and_latest_folder(tmp_path, monkeypatch, delayed_content):
    """A source request started earlier must merge against the latest committed row."""
    import threading

    store = Store(tmp_path)
    other_connection = Store(tmp_path)
    pid = store.create_project("Concurrent sources")["id"]
    item = {"url": "https://example.org/research", "title": "Research", "snippet": "Search summary"}
    source = save_web_source(store, pid, item)
    folder = store.put(pid, "folder", {"name": "User's folder"})
    ready, continue_write = threading.Event(), threading.Event()
    original_put = store.put

    def delayed_put(project_id, kind, data, **kwargs):
        # Pause immediately before the source's transaction; before the fix,
        # its previous-row read had already happened at this point.
        ready.set()
        assert continue_write.wait(5)
        return original_put(project_id, kind, data, **kwargs)

    monkeypatch.setattr(store, "put", delayed_put)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(save_web_source, store, pid, item, content=delayed_content)
        try:
            assert ready.wait(5)
            if delayed_content is None:
                save_web_source(other_connection, pid, item, content="Full page already saved")
            current = other_connection.get(pid, "document", source["id"])
            other_connection.put(pid, "document", {
                **current, "folder_id": folder["id"], "category": "User's category",
                "metadata": {**current["metadata"], "user_note": "Keep this latest metadata"},
            })
        finally:
            continue_write.set()
        result = pending.result(timeout=5)
    final = store.get(pid, "document", source["id"])
    assert result == final
    assert final["metadata"]["content_kind"] == "web_page"
    assert (delayed_content or "Full page already saved") in final["text"]
    assert final["folder_id"] == folder["id"]
    assert final["category"] == "User's category"
    assert final["metadata"]["user_note"] == "Keep this latest metadata"
    assert len(store.list(pid, "document")) == 1
