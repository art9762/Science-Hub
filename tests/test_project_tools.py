import json

import pytest

from backend.ai import SHARED_PROJECT_TOOLS, Runner
from backend.providers import Settings
from backend.storage import KINDS, Store


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setenv("SCIENCE_HUB_MODEL", "mock")
    store = Store(tmp_path)
    pid = store.create_project("Unified project")["id"]
    settings = Settings(tmp_path)
    run = store.put(pid, "run", {"prompt": "Read board", "mode": "team", "status": "queued"})
    return store, pid, settings, Runner(store, pid, run, settings)


async def use(runner, name, **args):
    return await runner.use_tool(name, args, None, 0)


@pytest.mark.asyncio
async def test_discover_every_entity_kind_with_pagination_and_fresh_reads(project):
    store, pid, _, runner = project
    items = {}
    for kind in sorted(KINDS):
        if kind == "folder":
            data = {"name": "Folder"}
        else:
            data = {"name": kind, "title": kind, "content": f"Content from {kind}"}
        items[kind] = store.put(pid, kind, data)
    found, offset = [], 0
    while True:
        page = await use(runner, "list_project_entities", offset=offset, limit=3)
        found.extend(page["items"])
        if page["next_offset"] is None:
            break
        offset = page["next_offset"]
    assert {item["kind"] for item in found} == KINDS
    assert {item["id"] for item in found} >= {item["id"] for item in items.values()}
    board = store.put(pid, "board_item", {**items["board_item"], "text": "Fresh board edit"})
    read = await use(runner, "read_project_entity", kind="board_item", entity_id=board["id"])
    assert json.loads(read["content"])["text"] == "Fresh board edit"
    assert runner.context()["board"][-1]["preview"] == "Fresh board edit"
    assert runner.context()["entity_counts"]["board_item"] == 1


@pytest.mark.asyncio
async def test_find_and_read_full_entity_beyond_initial_snapshot(project):
    store, pid, _, runner = project
    for index in range(110):
        store.put(pid, "document", {"name": f"Source {index}", "text": "A" * 1500})
    tail = store.put(pid, "document", {"name": "Last source", "text": "B" * 17000 + "DEEP_NEEDLE"})
    listed = await use(runner, "list_project_entities", kind="document", query="DEEP_NEEDLE")
    assert [item["id"] for item in listed["items"]] == [tail["id"]]
    read = await use(runner, "read_document", document_id=tail["id"], offset=16000)
    assert "DEEP_NEEDLE" in read["pages"][0]["text"]
    chunks, offset = [], 0
    while True:
        result = await use(
            runner,
            "read_project_entity",
            kind="document",
            entity_id=tail["id"],
            offset=offset,
            max_chars=1000,
        )
        chunks.append(result["content"])
        if result["next_offset"] is None:
            break
        offset = result["next_offset"]
    assert json.loads("".join(chunks))["text"].endswith("DEEP_NEEDLE")
    knowledge = await use(runner, "search_knowledge", query="DEEP_NEEDLE")
    assert knowledge[0]["document_id"] == tail["id"]


@pytest.mark.asyncio
async def test_board_crud_references_links_and_project_isolation(project):
    store, pid, _, runner = project
    doc = store.put(pid, "document", {"name": "Local evidence", "text": "Value 42"})
    card = await use(runner, "create_board_item", text="Investigate", reference_id=doc["id"], x=75)
    changed = await use(runner, "update_board_item", item_id=card["id"], text="Investigated")
    assert changed["reference_id"] == doc["id"] and changed["x"] == 75
    link = await use(runner, "link_entities", source=card["id"], target=doc["id"], label="evidence")
    assert (await use(runner, "list_project_entities", kind="link"))["items"][0]["id"] == link["id"]
    await use(runner, "delete_link", link_id=link["id"])
    assert store.list(pid, "link") == []
    await use(runner, "link_entities", source=card["id"], target=doc["id"], label="evidence")
    foreign_pid = store.create_project("Other")["id"]
    foreign = store.put(foreign_pid, "board_item", {"text": "Private"})
    for name, args in [
        ("read_project_entity", {"kind": "board_item", "entity_id": foreign["id"]}),
        ("update_board_item", {"item_id": foreign["id"], "text": "Overwrite"}),
        ("delete_board_item", {"item_id": foreign["id"]}),
        ("create_board_item", {"reference_id": foreign["id"]}),
        ("link_entities", {"source": card["id"], "target": foreign["id"], "label": "x"}),
    ]:
        with pytest.raises((KeyError, ValueError)):
            await use(runner, name, **args)
    assert store.get(foreign_pid, "board_item", foreign["id"])["text"] == "Private"
    await use(runner, "delete_board_item", item_id=card["id"])
    assert store.list(pid, "board_item") == [] and store.list(pid, "link") == []


@pytest.mark.asyncio
async def test_board_fields_are_validated_before_mutation(project):
    store, pid, _, runner = project
    for args in [
        {"type": "unsupported"},
        {"x": float("nan")},
        {"width": 1},
        {"color": "red"},
        {"project_id": "another-project"},
        {"reference_id": "missing"},
    ]:
        with pytest.raises(ValueError):
            await use(runner, "create_board_item", **args)
    assert store.list(pid, "board_item") == []


@pytest.mark.asyncio
async def test_all_entity_routes_respect_ignored_annotations(project):
    store, pid, _, runner = project
    doc = store.put(
        pid,
        "document",
        {
            "name": "Source",
            "text": "Moved SECRET_QUOTE after an update",
            "description": "SECRET_QUOTE",
            "file_path": "/private/path",
            "metadata": {"excerpt": "SECRET_QUOTE"},
        },
    )
    annotation = store.put(
        pid,
        "annotation",
        {
            "document_id": doc["id"],
            "type": "ignore",
            "page": 1,
            "start": 0,
            "end": 5,
            "quote": "SECRET_QUOTE",
            "note": "SECRET_QUOTE",
        },
    )
    for kind, item in [("document", doc), ("annotation", annotation)]:
        data = await use(runner, "read_project_entity", kind=kind, entity_id=item["id"])
        assert "SECRET_QUOTE" not in json.dumps(data)
        assert "file_path" not in data["content"]
    for kind in ("document", "annotation"):
        data = await use(runner, "list_project_entities", kind=kind, query="SECRET_QUOTE")
        assert data["items"] == []
    text = (await use(runner, "read_document", document_id=doc["id"]))["pages"][0]["text"]
    assert "SECRET_QUOTE" not in text and len(text) == len(doc["text"])
    assert await use(runner, "search_knowledge", query="SECRET_QUOTE") == []


@pytest.mark.asyncio
async def test_ignored_spans_without_saved_quote_mask_duplicated_text_and_metadata(project):
    store, pid, _, runner = project
    doc = store.put(
        pid,
        "document",
        {
            "name": "Source",
            "text": "First page\n\nHIDDEN_WORD on second page",
            "pages": [
                {"number": 1, "text": "First page"},
                {"number": 2, "text": "HIDDEN_WORD on second page"},
            ],
            "metadata": {"excerpt": "HIDDEN_WORD"},
        },
    )
    store.put(
        pid, "annotation", {"document_id": doc["id"], "page": 2, "start": 0, "end": 11, "type": "ignore"}
    )
    read = await use(runner, "read_project_entity", kind="document", entity_id=doc["id"])
    assert "HIDDEN_WORD" not in json.dumps(read)
    assert (await use(runner, "list_project_entities", query="HIDDEN_WORD"))["items"] == []


def test_legacy_agent_profiles_share_project_and_board_but_keep_optional_capabilities(project):
    _, _, _, runner = project
    for configured in ([], ["calculator"], ["documents"], ["web"]):
        tools = runner.allowed_tools({"tools": configured})
        assert tools >= SHARED_PROJECT_TOOLS
        assert ("calculate" in tools) == ("calculator" in configured)
        assert ("web_search" in tools) == ("web" in configured)
    assert "delegate_agent" not in runner.allowed_tools({"tools": ["calculator"]})


def test_large_tool_results_remain_valid_json_with_retry_and_write_acknowledgement(project):
    _, _, _, runner = project
    result = {"id": "board-id", "kind": "board_item", "text": '\\"' * 20000, "saved": True}
    encoded = runner.serialize_tool_result(result)
    decoded = json.loads(encoded)["untrusted_tool_data"]
    assert len(encoded) < 24000 and decoded["result_too_large"]
    assert decoded["id"] == "board-id" and decoded["saved"]
    assert "SAME offset" in decoded["note"]


@pytest.mark.asyncio
async def test_youtube_chat_tool_persists_caption_document_and_scope(project, monkeypatch):
    store, pid, _, runner = project
    calls = []

    def parse(url, language):
        calls.append((url, language))
        return {
            "name": "Video",
            "source_type": "youtube",
            "source_url": url,
            "mime_type": "text/plain",
            "text": "[00:01] Real caption",
            "pages": [{"number": 1, "text": "[00:01] Real caption"}],
            "metadata": {"analysis_scope": "captions_only", "language_code": language},
            "warnings": ["Video frames and audio were not analysed"],
        }

    monkeypatch.setattr("backend.youtube.parse_youtube", parse)
    url = "https://www.youtube.com/watch?v=abcdefghijk"
    result = await use(runner, "import_youtube", url=url, language="ru")
    assert calls == [(url, "ru")] and result["saved"]
    doc = store.get(pid, "document", result["document_id"])
    assert doc["text"] == "[00:01] Real caption"
    assert doc["source_run_id"] == runner.run["id"]
    read = await use(runner, "read_document", document_id=doc["id"])
    assert read["provenance"]["analysis_scope"] == "captions_only"
    assert read["provenance"]["source_type"] == "youtube"
    assert store.list(pid, "board_item") == []


@pytest.mark.asyncio
async def test_web_search_saves_kb_sources_upgrades_pages_and_never_creates_cards(project, monkeypatch):
    store, pid, settings, runner = project
    url = "https://example.test/paper"

    async def search(*args):
        return [{"url": url, "title": "Paper", "snippet": "SEARCH_SNIPPET", "source": "arxiv"}]

    async def fetch(*args):
        return {
            "url": url + "/full",
            "text": "ACTUAL_PAGE_TEXT",
            "truncated": True,
            "note": "Only five PDF pages",
            "source": "web_page",
        }

    monkeypatch.setattr("backend.ai.search_web", search)
    monkeypatch.setattr("backend.ai.read_web", fetch)
    result = await use(runner, "web_search", query="public paper")
    doc_id = result[0]["document_id"]
    assert result[0]["saved"] and store.list(pid, "board_item") == []
    assert store.get(pid, "document", doc_id)["metadata"]["content_kind"] == "search_snippet"
    found = await use(runner, "search_knowledge", query="SEARCH_SNIPPET")
    assert found[0]["provenance"]["type"] == "web_search_result"
    read = await use(runner, "read_document", document_id=doc_id)
    assert read["provenance"]["type"] == "web_search_result"
    next_run = store.put(pid, "run", {"prompt": "Continue", "mode": "team", "status": "queued"})
    second = Runner(store, pid, next_run, settings)
    page = await use(second, "read_web", url=url)
    assert page["saved"] and page["document_id"] == doc_id
    doc = store.get(pid, "document", doc_id)
    assert "ACTUAL_PAGE_TEXT" in doc["text"]
    assert doc["metadata"]["content_kind"] == "web_page" and doc["metadata"]["truncated"]
    assert "five PDF pages" in doc["metadata"]["note"]
    assert second.sources[url]["type"] == "web_page"
    await use(second, "web_search", query="public paper")
    assert len(store.list(pid, "document")) == 1
    assert "ACTUAL_PAGE_TEXT" in store.get(pid, "document", doc_id)["text"]
    assert store.list(pid, "board_item") == []
    store.delete(pid, "document", doc_id)
    with pytest.raises(ValueError, match="удалён"):
        await use(second, "save_claim", text="Value", status="supported", source_ids=[url], reason="Page")


@pytest.mark.asyncio
async def test_long_source_metadata_does_not_prevent_paginated_reads(project):
    from backend.sources import save_web_source

    _, pid, _, runner = project
    doc = save_web_source(runner.store, pid, {
        "url": "https://example.test/" + "x" * 3900,
        "title": "Paper", "snippet": "S" * 20000, "note": "N" * 20000,
    })
    read = await use(runner, "read_document", document_id=doc["id"], max_chars=100)
    assert len(read["provenance"]["snippet"]) <= 1000
    assert "result_too_large" not in json.loads(runner.serialize_tool_result(read))["untrusted_tool_data"]
    entity = await use(runner, "read_project_entity", kind="document", entity_id=doc["id"], max_chars=1000)
    assert "result_too_large" not in json.loads(runner.serialize_tool_result(entity))["untrusted_tool_data"]


@pytest.mark.asyncio
async def test_web_urls_with_fragments_share_canonical_source_and_remain_readable(project, monkeypatch):
    _, _, _, runner = project
    original = "https://EXAMPLE.TEST/paper#section"
    canonical = "https://example.test/paper"
    fetched = []

    async def search(*args):
        return [{"url": original, "title": "Paper", "snippet": "Snippet"}]

    async def fetch(url):
        fetched.append(url)
        return {"url": url, "text": "Page", "truncated": False}

    monkeypatch.setattr("backend.ai.search_web", search)
    monkeypatch.setattr("backend.ai.read_web", fetch)
    found = await use(runner, "web_search", query="public paper")
    assert found[0]["url"] == found[0]["id"] == canonical
    page = await use(runner, "read_web", url=original)
    assert fetched == [canonical] and page["saved"]
    assert page["document_id"] == found[0]["document_id"]


@pytest.mark.asyncio
async def test_project_entity_evidence_rejects_deleted_objects(project):
    store, pid, _, runner = project
    card = store.put(pid, "board_item", {"text": "Proposed option"})
    read = await use(runner, "read_project_entity", kind="board_item", entity_id=card["id"])
    assert read["provenance"]["type"] == "project_entity"
    store.delete(pid, "board_item", card["id"])
    with pytest.raises(ValueError, match="удалён"):
        await use(
            runner, "save_claim", text="Option", status="supported", source_ids=[card["id"]], reason="Card"
        )
