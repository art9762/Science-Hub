import asyncio
import json
from types import SimpleNamespace

import pytest

from backend.ai import SHARED_PROJECT_TOOLS, Runner, schedule_image_analysis, setup_ai
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
    settings.update(
        {"orchestrator_model": "mock-model", "max_runtime_seconds": 600, "shutdown_grace_seconds": 60}
    )
    return store, project["id"], settings


def new_run(store, pid, **extra):
    return store.put(
        pid,
        "run",
        {
            "prompt": "Проверь исходные данные",
            "mode": "team",
            "status": "queued",
            "max_runtime_seconds": 600,
            "shutdown_grace_seconds": 60,
            **extra,
        },
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
    assert saved["finished_at"] >= saved["started_at"]
    assert saved["usage"]["calls"] == 3
    assert saved["missing_information"][0]["question"] == "Какие единицы?"
    assert store.list(pid, "workspace_document")[0]["title"] == "Расчёт"
    assert any(e["type"] == "calculation" for e in store.list(pid, "event"))
    assert '"value": 36' in json.dumps(adapter.requests[1]["messages"], ensure_ascii=False).replace(
        '\\"', '"'
    )


@pytest.mark.asyncio
async def test_delegate_is_model_selected(workspace, monkeypatch):
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
    assert {t["function"]["name"] for t in adapter.requests[1]["tools"]} == {
        "calculate"
    } | SHARED_PROJECT_TOOLS
    assert store.get(pid, "run", run["id"])["usage"]["calls"] == 3


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
    assert store.get(pid, "run", run["id"])["finished_at"]
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
    assert saved["finished_at"]
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
async def test_document_focus_keeps_project_access_and_conflict_evidence(workspace):
    store, pid, settings = workspace
    first = store.put(pid, "document", {"name": "A", "pages": [{"number": 1, "text": "Размер 2"}]})
    second = store.put(pid, "document", {"name": "B", "pages": [{"number": 1, "text": "Размер 3"}]})
    run = new_run(store, pid, document_ids=[first["id"]])
    runner = Runner(store, pid, run, settings)
    read = await runner.use_tool("read_document", {"document_id": second["id"]}, None, 0)
    assert read["pages"][0]["text"] == "Размер 3"
    assert runner.context()["focused_document_ids"] == [first["id"]]
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
async def test_soft_deadline_keeps_document_tools_available(workspace, monkeypatch):
    store, pid, settings = workspace
    adapter = MockAdapter(
        [
            {"tool_calls": [tool_call("calculate", expression="2 * 3")]},
            {"tool_calls": [tool_call("write_document", title="Расчёт", content="2 × 3 = 6")]},
            {"content": "Расчёт сохранён. Проверка единиц ещё нужна."},
        ]
    )
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid)
    runner = Runner(store, pid, run, settings)
    original = runner.use_tool

    async def cross_soft_deadline(name, args, agent, depth):
        result = await original(name, args, agent, depth)
        if name == "calculate":
            runner.soft_deadline = asyncio.get_running_loop().time() - 1
        return result

    monkeypatch.setattr(runner, "use_tool", cross_soft_deadline)
    await runner.execute()
    saved = store.get(pid, "run", run["id"])
    assert saved["status"] == "completed"
    assert saved["outcome"] == "time_limited"
    assert saved["stop_reason"] == "soft_deadline"
    assert saved["needs_followup"] is True
    assert saved["usage"]["calls"] == 3
    assert store.list(pid, "workspace_document")[0]["content"] == "2 × 3 = 6"
    grace_tools = {t["function"]["name"] for t in adapter.requests[1]["tools"]}
    assert "write_document" in grace_tools and "delegate_agent" not in grace_tools
    assert any(
        m["role"] == "system" and "Быстро заверши" in m["content"] for m in adapter.requests[1]["messages"]
    )
    assert len([e for e in store.list(pid, "event") if e["type"] == "time_limit"]) == 1


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


@pytest.mark.asyncio
async def test_specialist_can_use_more_than_two_replies_and_no_global_call_cap(workspace, monkeypatch):
    store, pid, settings = workspace
    agent = store.put(
        pid, "agent", {"name": "Расчётчик", "enabled": True, "tools": ["calculator", "documents"]}
    )
    adapter = MockAdapter(
        [
            {
                "tool_calls": [
                    tool_call("delegate_agent", agent_id=agent["id"], instruction="Рассчитай и сохрани")
                ]
            },
            *[{"tool_calls": [tool_call("calculate", expression=f"{i} + 1")]} for i in range(26)],
            {"tool_calls": [tool_call("write_document", title="Все результаты", content="Расчёты готовы")]},
            {"content": "Документ сохранён."},
            {"content": "Команда завершила расчёт."},
        ]
    )
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid, max_rounds=1)  # Persisted legacy limits are ignored.
    await Runner(store, pid, run, settings).execute()
    assert store.get(pid, "run", run["id"])["status"] == "completed"
    assert store.get(pid, "run", run["id"])["usage"]["calls"] == 30
    assert store.list(pid, "workspace_document")[0]["content"] == "Расчёты готовы"


@pytest.mark.asyncio
async def test_hard_deadline_cancels_active_provider_after_soft_notice(workspace, monkeypatch):
    store, pid, settings = workspace
    cancelled = asyncio.Event()
    soft_seen = asyncio.Event()
    observed = []

    class Waiting:
        async def complete(self, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

    monkeypatch.setattr("backend.ai.adapter_for", lambda _: Waiting())
    run = new_run(store, pid, max_runtime_seconds=0.03, shutdown_grace_seconds=0.03)
    runner = Runner(store, pid, run, settings)
    original = runner.begin_wrapup

    def begin():
        original()
        observed.append(store.get(pid, "run", run["id"])["status"])
        soft_seen.set()

    monkeypatch.setattr(runner, "begin_wrapup", begin)
    task = asyncio.create_task(runner.execute())
    await asyncio.wait_for(task, 2)
    assert soft_seen.is_set() and observed == ["wrapping_up"]
    assert cancelled.is_set()
    saved = store.get(pid, "run", run["id"])
    assert saved["status"] == "timed_out"
    assert saved["stop_reason"] == "hard_deadline"
    assert saved["finished_at"] >= saved["started_at"]
    assert saved["needs_followup"] is True
    assert any(e["type"] == "timed_out" for e in store.list(pid, "event"))


@pytest.mark.asyncio
async def test_hard_deadline_cancels_delegated_tool_without_late_write(workspace, monkeypatch):
    store, pid, settings = workspace
    agent = store.put(pid, "agent", {"name": "Исследователь", "enabled": True, "tools": ["web"]})
    adapter = MockAdapter(
        [
            {"tool_calls": [tool_call("delegate_agent", agent_id=agent["id"], instruction="Найди данные")]},
            {"tool_calls": [tool_call("web_search", query="public physics")]},
        ]
    )
    stopped = asyncio.Event()

    async def wait_for_search(*args):
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    monkeypatch.setattr("backend.ai.search_web", wait_for_search)
    run = new_run(store, pid, max_runtime_seconds=0.03, shutdown_grace_seconds=0.03)
    runner = Runner(store, pid, run, settings)
    await asyncio.wait_for(runner.execute(), 2)
    assert stopped.is_set()
    assert not runner.active_agents
    assert store.get(pid, "run", run["id"])["status"] == "timed_out"
    assert store.list(pid, "workspace_document") == []


@pytest.mark.asyncio
async def test_soft_notice_reaches_specialist_before_returning_to_orchestrator(workspace, monkeypatch):
    store, pid, settings = workspace
    agent = store.put(pid, "agent", {"name": "Автор", "enabled": True, "tools": ["documents"]})
    adapter = MockAdapter(
        [
            {
                "tool_calls": [
                    tool_call("delegate_agent", agent_id=agent["id"], instruction="Подготовь документ")
                ]
            },
            {"content": "Есть предварительные результаты."},
            {"tool_calls": [tool_call("write_document", title="Итог", content="Частичный результат")]},
            {"content": "Результаты сохранены."},
            {"content": "Работа завершена по имеющимся данным."},
        ]
    )
    run = new_run(store, pid)
    runner = Runner(store, pid, run, settings)
    original = adapter.complete

    async def respond(**kwargs):
        response = await original(**kwargs)
        if len(adapter.requests) == 2:
            runner.soft_deadline = asyncio.get_running_loop().time() - 1
        return response

    monkeypatch.setattr(adapter, "complete", respond)
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    await runner.execute()
    notices = [e for e in store.list(pid, "event") if e["type"] == "wrapup_notice"]
    assert [e["agent_id"] for e in notices] == [agent["id"], None]
    assert store.list(pid, "workspace_document")[0]["content"] == "Частичный результат"


@pytest.mark.asyncio
async def test_document_aliases_update_append_and_scope(workspace):
    store, pid, settings = workspace
    runner = Runner(store, pid, new_run(store, pid), settings)
    created = await runner.use_tool(
        "write_document", {"name": "Первый", "markdown": "Часть 1", "document_id": None}, None, 0
    )
    assert created["saved"] and created["characters"] == 7
    updated = await runner.use_tool(
        "write_document", {"id": created["id"], "text": "\nЧасть 2", "mode": "append"}, None, 0
    )
    doc = store.get(pid, "workspace_document", created["id"])
    assert updated["saved"] and doc["title"] == "Первый" and doc["content"] == "Часть 1\nЧасть 2"
    source = store.put(pid, "document", {"name": "Источник"})
    with pytest.raises(ValueError, match="исходного файла"):
        await runner.use_tool(
            "write_document", {"document_id": source["id"], "content": "Overwrite?"}, None, 0
        )
    other = store.create_project("Other")
    foreign = store.put(other["id"], "workspace_document", {"title": "Private", "content": "Preserved"})
    with pytest.raises(ValueError, match="не найден"):
        await runner.use_tool(
            "write_document", {"document_id": foreign["id"], "content": "Overwrite?"}, None, 0
        )
    assert store.get(other["id"], "workspace_document", foreign["id"])["content"] == "Preserved"


@pytest.mark.asyncio
async def test_write_validation_does_not_truncate_or_coerce(workspace):
    store, pid, settings = workspace
    runner = Runner(store, pid, new_run(store, pid), settings)
    for args in [
        {"title": "x", "content": None},
        {"title": "x", "content": {"text": "bad"}},
        {"title": "x", "content": "A" * 100001},
        {"title": "A" * 201, "content": "x"},
        {"title": "x", "content": "x", "text": "conflicting"},
        {"content": "x", "mode": "append"},
        {"content": "x", "mode": []},
        {"content": "x", "path": "/some/file.md"},
    ]:
        with pytest.raises(ValueError):
            await runner.use_tool("write_document", args, None, 0)
    assert store.list(pid, "workspace_document") == []
    result = await runner.use_tool("write_document", {"content": "# Название\nТекст"}, None, 0)
    assert result["title"] == "Название"


@pytest.mark.asyncio
async def test_bad_document_call_is_recoverable_and_not_a_success(workspace, monkeypatch):
    store, pid, settings = workspace
    broken = tool_call("write_document", title="Первый", content="bad")
    broken["function"]["arguments"] = '{"title":"Первый","content":"truncated'
    adapter = MockAdapter(
        [
            {"tool_calls": [broken], "finish_reason": "length"},
            {"tool_calls": [tool_call("write_document", title="Исправленный", content="Полный текст")]},
            {"content": "Документ сохранён после исправления."},
        ]
    )
    monkeypatch.setattr("backend.ai.adapter_for", lambda _: adapter)
    run = new_run(store, pid)
    await Runner(store, pid, run, settings).execute()
    results = [
        json.loads(m["content"])["untrusted_tool_data"]
        for m in adapter.requests[-1]["messages"]
        if m["role"] == "tool"
    ]
    assert results[0]["saved"] is False and "mode=append" in results[0]["error"]
    assert results[1]["saved"] is True
    assert len(store.list(pid, "workspace_document")) == 1
    assert store.get(pid, "run", run["id"])["status"] == "completed"


@pytest.mark.asyncio
async def test_storage_failure_does_not_acknowledge_document(workspace, monkeypatch):
    store, pid, settings = workspace
    runner = Runner(store, pid, new_run(store, pid), settings)
    original = store.put

    def failing_put(pid, kind, data):
        if kind == "workspace_document":
            raise OSError("disk unavailable")
        return original(pid, kind, data)

    monkeypatch.setattr(store, "put", failing_put)
    with pytest.raises(ValueError, match="Не удалось подтвердить"):
        await runner.use_tool("write_document", {"title": "x", "content": "text"}, None, 0)
    assert store.list(pid, "workspace_document") == []
    assert not runner.sources


@pytest.mark.asyncio
async def test_provider_normalizes_object_tool_arguments(workspace, monkeypatch):
    _, _, settings = workspace
    provider = OpenAICompatible(settings.provider())

    async def response(*args):
        return {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "write_document",
                                    "arguments": {"title": "Документ", "content": "Текст"},
                                }
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        }

    monkeypatch.setattr(provider, "request", response)
    result = await provider.complete(model="mock", messages=[], tools=[], max_tokens=2048)
    call = result["tool_calls"][0]
    assert call["id"] and call["type"] == "function"
    assert json.loads(call["function"]["arguments"])["content"] == "Текст"


def test_runtime_settings_validation_and_legacy_migration(tmp_path):
    (tmp_path / "settings.private.json").write_text(json.dumps({"max_rounds": 1}))
    settings = Settings(tmp_path)
    assert "max_rounds" not in settings.public()
    assert settings.public()["max_runtime_seconds"] == 600
    assert settings.public()["shutdown_grace_seconds"] == 60
    for patch in [
        {"max_runtime_seconds": 0},
        {"max_runtime_seconds": True},
        {"shutdown_grace_seconds": 601},
        {"max_runtime_seconds": 86401},
    ]:
        with pytest.raises(ValueError):
            settings.update(patch)
    settings.update({"max_runtime_seconds": 1800, "shutdown_grace_seconds": 120})
    assert Settings(tmp_path).public()["max_runtime_seconds"] == 1800


@pytest.mark.asyncio
async def test_user_cancel_during_grace_preserves_document(workspace, monkeypatch):
    from backend.ai import cancel_run

    store, pid, settings = workspace
    waiting = asyncio.Event()
    stopped = asyncio.Event()
    run = new_run(store, pid)
    runner = Runner(store, pid, run, settings)
    replies = MockAdapter(
        [
            {
                "tool_calls": [
                    tool_call("write_document", title="Сохранённый", content="Результаты до отмены")
                ]
            },
        ]
    )

    async def complete(**kwargs):
        if replies.replies:
            result = await replies.complete(**kwargs)
            runner.soft_deadline = asyncio.get_running_loop().time() - 1
            return result
        waiting.set()
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr("backend.ai.adapter_for", lambda _: SimpleNamespace(complete=complete))
    task = asyncio.create_task(runner.execute())
    await asyncio.wait_for(waiting.wait(), 2)
    assert store.get(pid, "run", run["id"])["status"] == "wrapping_up"
    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(store=store, ai_tasks={run["id"]: task}))
    )
    cancelled = await cancel_run(pid, run["id"], request)
    await task
    assert stopped.is_set()
    assert cancelled["status"] == "cancelled" and cancelled["finished_at"]
    assert store.get(pid, "run", run["id"])["finished_at"] == cancelled["finished_at"]
    assert store.list(pid, "workspace_document")[0]["content"] == "Результаты до отмены"


@pytest.mark.asyncio
async def test_write_acknowledgement_requires_matching_persisted_content(workspace, monkeypatch):
    store, pid, settings = workspace
    runner = Runner(store, pid, new_run(store, pid), settings)
    original = store.get

    def altered_read(pid, kind, item_id):
        value = original(pid, kind, item_id)
        return {**value, "content": "unexpected value"} if kind == "workspace_document" else value

    monkeypatch.setattr(store, "get", altered_read)
    with pytest.raises(ValueError, match="подтвердить полное"):
        await runner.use_tool("write_document", {"title": "Test", "content": "Expected"}, None, 0)
    assert not runner.sources
