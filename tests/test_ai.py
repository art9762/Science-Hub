import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.ai import Runner, schedule_image_analysis, setup_ai
from backend.providers import OpenAICompatible, ProviderError, Settings, normalize_models
from backend.research import calculate
from backend.storage import Store


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("SCIENCE_HUB_API_KEY", "test-secret-never-return")
    monkeypatch.setenv("SCIENCE_HUB_MODEL", "mock-model")
    store = Store(tmp_path)
    project = store.create_project("Test research")
    settings = Settings(tmp_path)
    settings.update({"orchestrator_model": "mock-model", "max_rounds": 5})
    return store, project["id"], settings


def new_run(store, pid, **extra):
    return store.put(
        pid,
        "run",
        {"prompt": "Проверь исходные данные", "mode": "team", "status": "queued", "max_rounds": 5, **extra},
    )


def tool_call(name, **args):
    return {
        "id": "call-" + name,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


class MockAdapter:
    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []

    async def complete(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return {
            "content": "",
            "tool_calls": [],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            **reply,
        }

    async def models(self):
        return [{"id": "mock-model", "name": "Mock"}]


@pytest.mark.asyncio
async def test_run_uses_real_tool_results_and_persists(workspace, monkeypatch):
    store, pid, settings = workspace
    adapter = MockAdapter(
        [
            {
                "tool_calls": [
                    tool_call("calculate", expression="12 * 3"),
                    tool_call(
                        "request_information",
                        question="Какие единицы?",
                        reason="Нужны единицы исходных данных",
                    ),
                ]
            },
            {
                "tool_calls": [
                    tool_call("write_document", title="Расчёт", content="12 × 3 = 36; единицы не заданы")
                ]
            },
            {"content": "Результат 36. Требуется уточнить единицы."},
        ]
    )
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid)
    await Runner(store, pid, run, settings).execute()
    saved = store.get(pid, "run", run["id"])
    assert saved["status"] == "completed"
    assert saved["usage"]["calls"] == 3
    assert saved["missing_information"][0]["question"] == "Какие единицы?"
    assert store.list(pid, "workspace_document")[0]["title"] == "Расчёт"
    assert any(e["type"] == "calculation" for e in store.list(pid, "event"))
    assert '"value": 36' in json.dumps(adapter.requests[1]["messages"], ensure_ascii=False).replace(
        '\\"', '"'
    )


@pytest.mark.asyncio
async def test_delegate_is_model_selected_and_bounded(workspace, monkeypatch):
    store, pid, settings = workspace
    agent = store.put(
        pid,
        "agent",
        {
            "name": "Критик",
            "role": "critic",
            "system_prompt": "Проверь слабые места",
            "model": "specialist",
            "enabled": True,
            "tools": ["calculate"],
        },
    )
    store.put(pid, "agent", {"name": "Не выбран", "enabled": True, "tools": []})
    adapter = MockAdapter(
        [
            {"tool_calls": [tool_call("delegate_agent", agent_id=agent["id"], instruction="Проверь расчет")]},
            {"content": "Не заданы единицы измерения."},
            {"content": "Критик обнаружил недостаток данных."},
        ]
    )
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid)
    await Runner(store, pid, run, settings).execute()
    agent_messages = [m for m in store.list(pid, "message") if m["role"] == "agent"]
    assert [m["agent_id"] for m in agent_messages] == [agent["id"]]
    assert adapter.requests[1]["model"] == "specialist"
    assert {t["function"]["name"] for t in adapter.requests[1]["tools"]} == {"calculate"}
    assert store.get(pid, "run", run["id"])["usage"]["calls"] <= 5


@pytest.mark.asyncio
async def test_cancel_stops_provider_and_persists(workspace, monkeypatch):
    store, pid, settings = workspace
    started = asyncio.Event()

    class Waiting:
        async def complete(self, **kwargs):
            started.set()
            await asyncio.Event().wait()

    monkeypatch.setattr("backend.ai.adapter_for", lambda _: Waiting())
    run = new_run(store, pid)
    task = asyncio.create_task(Runner(store, pid, run, settings).execute())
    await asyncio.wait_for(started.wait(), 2)
    task.cancel()
    await task
    assert store.get(pid, "run", run["id"])["status"] == "cancelled"
    assert store.list(pid, "event")[-1]["type"] == "cancelled"


@pytest.mark.asyncio
async def test_errors_and_model_echo_do_not_leak_secrets(workspace, monkeypatch):
    store, pid, settings = workspace
    adapter = MockAdapter([{"content": "API test-secret-never-return"}])
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid)
    await Runner(store, pid, run, settings).execute()
    assert "test-secret-never-return" not in json.dumps(store.list(pid, "message"))
    assert "[REDACTED]" in store.get(pid, "run", run["id"])["result"]
    adapter = MockAdapter([RuntimeError("private details test-secret-never-return")])
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run2 = new_run(store, pid)
    await Runner(store, pid, run2, settings).execute()
    saved = store.get(pid, "run", run2["id"])
    assert saved["status"] == "failed"
    assert "private details" not in saved["error"]
    assert "test-secret-never-return" not in json.dumps(store.list(pid, "event"))


def test_settings_keep_secrets_private_and_preserve_empty_key(workspace):
    store, pid, settings = workspace
    updated = settings.update(
        {
            "providers": [
                {
                    "id": "default",
                    "name": "Test",
                    "base_url": "https://example.test/v1",
                    "api_key": "stored-private-key",
                    "models": ["model-a", {"id": "model-b"}],
                }
            ]
        }
    )
    assert updated["providers"][0]["has_key"]
    assert "stored-private-key" not in json.dumps(updated)
    settings.update({"providers": [{"id": "default", "api_key": ""}]})
    assert Settings(store.root).provider()["api_key"] == "stored-private-key"
    assert settings.path.stat().st_mode & 0o777 == 0o600
    assert normalize_models(["a", "a", {"id": "b"}]) == [{"id": "a", "name": "a"}, {"id": "b", "name": "b"}]
    with pytest.raises(ValueError):
        settings.update({"max_rounds": 1000})


@pytest.mark.asyncio
async def test_provider_error_redacts_upstream_response(monkeypatch):
    import httpx

    transport = httpx.MockTransport(lambda _: httpx.Response(401, json={"error": "test-secret-never-return"}))
    client_class = httpx.AsyncClient
    monkeypatch.setattr(
        "backend.providers.httpx.AsyncClient", lambda **kw: client_class(transport=transport, **kw)
    )
    provider = OpenAICompatible(
        {"base_url": "https://example.test/v1", "api_key": "test-secret-never-return"}
    )
    with pytest.raises(ProviderError) as err:
        await provider.models()
    assert "401" in str(err.value)
    assert "test-secret" not in str(err.value)


@pytest.mark.asyncio
async def test_selected_document_boundary_and_conflict_evidence(workspace):
    store, pid, settings = workspace
    first = store.put(pid, "document", {"name": "A", "pages": [{"number": 1, "text": "Размер 2"}]})
    second = store.put(pid, "document", {"name": "B", "pages": [{"number": 1, "text": "Размер 3"}]})
    run = new_run(store, pid, document_ids=[first["id"]])
    runner = Runner(store, pid, run, settings)
    with pytest.raises(ValueError, match="не входит"):
        await runner.use_tool("read_document", {"document_id": second["id"]}, None, 0)
    with pytest.raises(ValueError, match="источники"):
        await runner.use_tool(
            "save_claim",
            {"text": "X", "status": "supported", "source_ids": ["invented"], "reason": "x"},
            None,
            0,
        )
    await runner.use_tool("read_document", {"document_id": first["id"]}, None, 0)
    with pytest.raises(ValueError, match="два"):
        await runner.use_tool(
            "report_conflict",
            {"description": "x", "source_ids": [first["id"]], "verification": "check"},
            None,
            0,
        )


def test_arithmetic_is_bounded_and_does_not_execute_code():
    assert calculate("sqrt(9) + 2 ** 3")["value"] == 11
    for expression in [
        "__import__('os').system('echo BAD')",
        "2 ** 10000000",
        "[1] * 100",
        "1 / 0",
        "open('/tmp/x')",
        "True",
        "(1).__class__",
    ]:
        with pytest.raises(ValueError):
            calculate(expression)


def test_restart_recovery(workspace):
    store, pid, settings = workspace
    run = new_run(store, pid, status="running")
    app = SimpleNamespace(state=SimpleNamespace(store=store))
    setup_ai(app)
    saved = store.get(pid, "run", run["id"])
    assert saved["status"] == "failed"
    assert "перезапущен" in saved["error"]


@pytest.mark.asyncio
async def test_auto_vision_sends_actual_image(workspace, monkeypatch):
    store, pid, settings = workspace
    settings.update({"vision_model": "vision-mock"})
    path = store.root / "files" / "image.png"
    path.write_bytes(b"image-binary-fixture")
    doc = store.put(
        pid, "document", {"name": "Image", "mime_type": "image/png", "file_path": "files/image.png"}
    )
    adapter = MockAdapter([{"content": "На изображении виден чертёж."}])
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    app = SimpleNamespace(state=SimpleNamespace(store=store, ai_tasks={}))
    schedule_image_analysis(app, pid, doc["id"])
    await asyncio.gather(*app.state.ai_tasks.values())
    saved = store.get(pid, "document", doc["id"])
    assert saved["vision_status"] == "analyzed"
    assert saved["description"] == "На изображении виден чертёж."
    image = adapter.requests[0]["messages"][1]["content"][1]
    assert image["type"] == "image_url"
    assert image["image_url"]["url"].startswith("data:image/png;base64,")


def test_no_vision_config_is_explicitly_pending(workspace):
    store, pid, settings = workspace
    doc = store.put(pid, "document", {"name": "Image", "mime_type": "image/png", "file_path": "files/x.png"})
    app = SimpleNamespace(state=SimpleNamespace(store=store))
    schedule_image_analysis(app, pid, doc["id"])
    assert store.get(pid, "document", doc["id"])["vision_status"] == "pending_settings"


@pytest.mark.asyncio
async def test_budget_finalization_cannot_execute_fake_or_late_tools(workspace, monkeypatch):
    store, pid, settings = workspace
    adapter = MockAdapter(
        [
            {"tool_calls": [tool_call("calculate", expression="2 * 3")]},
            {
                "content": '{"name":"write_document","arguments":{"title":"Fake","content":"x"}}',
                "tool_calls": [tool_call("write_document", title="Forbidden late call", content="x")],
            },
        ]
    )
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid, max_rounds=2)
    await Runner(store, pid, run, settings).execute()
    saved = store.get(pid, "run", run["id"])
    assert saved["outcome"] == "budget_limited"
    assert saved["needs_followup"] is True
    assert saved["usage"]["calls"] == 2
    assert store.list(pid, "workspace_document") == []
    assert adapter.requests[-1]["tools"] == []
    assert any(e["type"] == "limit" for e in store.list(pid, "event"))


@pytest.mark.asyncio
async def test_ignored_annotations_mask_tools_context_and_search(workspace):
    store, pid, settings = workspace
    text = "Visible data. IGNORE_SECRET_MARKER. More visible data."
    doc = store.put(
        pid,
        "document",
        {
            "name": "Source",
            "pages": [{"number": 1, "text": text}],
            "description": "Description IGNORE_SECRET_MARKER",
        },
    )
    start = text.index("IGNORE_SECRET_MARKER")
    store.put(
        pid,
        "annotation",
        {
            "document_id": doc["id"],
            "page": 1,
            "start": start,
            "end": start + len("IGNORE_SECRET_MARKER"),
            "quote": "IGNORE_SECRET_MARKER",
            "note": "IGNORE_SECRET_MARKER",
            "type": "ignore",
        },
    )
    runner = Runner(store, pid, new_run(store, pid), settings)
    read = await runner.use_tool("read_document", {"document_id": doc["id"]}, None, 0)
    assert "IGNORE_SECRET_MARKER" not in json.dumps(read)
    assert "IGNORE_SECRET_MARKER" not in json.dumps(runner.context())
    assert len(read["pages"][0]["text"]) == len(text)
    assert await runner.use_tool("search_knowledge", {"query": "IGNORE_SECRET_MARKER"}, None, 0) == []
    results = await runner.use_tool("search_knowledge", {"query": "Visible"}, None, 0)
    assert results and "IGNORE_SECRET_MARKER" not in json.dumps(results)


@pytest.mark.asyncio
async def test_long_document_offsets_and_working_report_scope(workspace):
    store, pid, settings = workspace
    doc = store.put(
        pid, "document", {"name": "Long", "pages": [{"number": 1, "text": "A" * 15000 + "TAIL_MARKER"}]}
    )
    report = store.put(
        pid, "workspace_document", {"title": "Prior report", "content": "B" * 16000 + "REPORT_END"}
    )
    runner = Runner(store, pid, new_run(store, pid), settings)
    read = await runner.use_tool("read_document", {"document_id": doc["id"]}, None, 0)
    assert read["pages"][0]["next_offset"] == 7000
    read = await runner.use_tool("read_document", {"document_id": doc["id"], "offset": 14000}, None, 0)
    assert "TAIL_MARKER" in read["pages"][0]["text"]
    assert read["pages"][0]["next_offset"] is None
    assert runner.context()["working_documents"][0]["id"] == report["id"]
    read = await runner.use_tool(
        "read_working_document", {"document_id": report["id"], "offset": 16000}, None, 0
    )
    assert read["content"] == "REPORT_END"
    other = store.create_project("Other")
    foreign = store.put(other["id"], "workspace_document", {"title": "Other report", "content": "PRIVATE"})
    with pytest.raises(KeyError):
        await runner.use_tool("read_working_document", {"document_id": foreign["id"]}, None, 0)


@pytest.mark.asyncio
async def test_web_read_requires_previously_discovered_url(workspace):
    store, pid, settings = workspace
    runner = Runner(store, pid, new_run(store, pid), settings)
    with pytest.raises(ValueError, match="web_search"):
        await runner.use_tool("read_web", {"url": "https://example.test/private"}, None, 0)


@pytest.mark.asyncio
async def test_web_read_blocks_private_dns_and_redirects(monkeypatch):
    import httpx
    import socket
    from backend.research import ResearchError, fetch_public_document, public_address

    def resolve(host, *args, **kwargs):
        return [
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                (
                    "127.0.0.1"
                    if host in {"localhost", "127.0.0.1", "metadata.internal"}
                    else "93.184.215.14",
                    443,
                ),
            )
        ]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    for url in [
        "http://localhost/",
        "http://metadata.internal/",
        "file:///etc/passwd",
        "http://example.test:8080/",
        "https://user:pass@example.test/",
    ]:
        with pytest.raises(ResearchError):
            await public_address(url)
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(302, headers={"location": "http://127.0.0.1/secrets"})

    client_class = httpx.AsyncClient
    transport = httpx.MockTransport(respond)
    monkeypatch.setattr(
        "backend.research.httpx.AsyncClient", lambda **kw: client_class(transport=transport, **kw)
    )
    with pytest.raises(ResearchError):
        await fetch_public_document("https://example.test/article")
    assert len(requests) == 1
    assert requests[0].url.host == "93.184.215.14"
    assert requests[0].headers["host"] == "example.test"
    assert requests[0].extensions["sni_hostname"] == "example.test"


@pytest.mark.asyncio
async def test_web_html_extracts_actual_text_without_scripts(monkeypatch):
    from backend.research import read_web

    async def fetch(url):
        return (
            url,
            "text/html",
            b"<html><script>SECRET_SCRIPT</script><style>HIDDEN_CSS</style><h1>Research title</h1><p>Actual evidence.</p></html>",
        )

    monkeypatch.setattr("backend.research.fetch_public_document", fetch)
    result = await read_web("https://example.test/research")
    assert "Actual evidence" in result["text"]
    assert "SECRET_SCRIPT" not in result["text"]
    assert "HIDDEN_CSS" not in result["text"]
    assert result["truncated"] is False


@pytest.mark.asyncio
async def test_deleted_sources_cannot_support_new_claims(workspace):
    store, pid, settings = workspace
    doc = store.put(pid, "document", {"name": "Transient", "pages": [{"number": 1, "text": "Value 3"}]})
    runner = Runner(store, pid, new_run(store, pid), settings)
    await runner.use_tool("read_document", {"document_id": doc["id"]}, None, 0)
    assert runner.sources[doc["id"]]["document_id"] == doc["id"]
    store.delete(pid, "document", doc["id"])
    with pytest.raises(ValueError, match="удалён"):
        await runner.use_tool(
            "save_claim",
            {"text": "Value 3", "status": "supported", "source_ids": [doc["id"]], "reason": "Source"},
            None,
            0,
        )
    assert store.list(pid, "claim") == []


@pytest.mark.asyncio
async def test_tiff_vision_converts_actual_image_to_png(workspace, monkeypatch):
    from PIL import Image
    from backend.ai import analyze_document

    store, pid, settings = workspace
    settings.update({"vision_model": "vision-mock"})
    path = store.root / "files" / "source.tiff"
    Image.new("RGB", (16, 16), "red").save(path)
    doc = store.put(
        pid, "document", {"name": "TIFF", "mime_type": "image/tiff", "file_path": "files/source.tiff"}
    )
    adapter = MockAdapter([{"content": "Красное изображение"}])
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    result = await analyze_document(store, pid, doc["id"], settings)
    assert result["mime_type"] == "image/tiff"
    assert "file_path" not in result
    assert adapter.requests[0]["messages"][1]["content"][1]["image_url"]["url"].startswith(
        "data:image/png;base64,"
    )
