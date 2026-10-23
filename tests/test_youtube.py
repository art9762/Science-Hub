"""Deterministic YouTube imports; no network, personal account, or real captions."""

import io
from types import SimpleNamespace

import httpx
import pytest

from backend import youtube

VIDEO = "dQw4w9WgXcQ"
URL = f"https://www.youtube.com/watch?v={VIDEO}"


def transcript(snippets=None, language="Русский", code="ru", generated=False):
    class Transcript(list):
        pass

    result = Transcript(snippets if snippets is not None else [SimpleNamespace(text="Первый факт", start=65.4, duration=2.5)])
    result.language = language
    result.language_code = code
    result.is_generated = generated
    return result


@pytest.mark.parametrize("value", [
    URL, f"http://youtube.com/watch?v={VIDEO}&list=ignored#start", f"youtu.be/{VIDEO}?t=12",
    f"https://www.youtube.com/shorts/{VIDEO}", f"https://m.youtube.com/live/{VIDEO}?si=abc",
    f"https://music.youtube.com/watch?v={VIDEO}", f"https://www.youtube-nocookie.com/embed/{VIDEO}",
])
def test_known_video_url_shapes_are_canonical(value):
    assert youtube.normalize_youtube_url(value) == (VIDEO, URL)


@pytest.mark.parametrize("value", [
    "https://youtube.com.evil.test/watch?v=" + VIDEO, "https://evil.test/" + VIDEO,
    "https://www.youtube.com@localhost/watch?v=" + VIDEO, "https://user:pass@youtube.com/watch?v=" + VIDEO,
    "https://www.youtube.com:443/watch?v=" + VIDEO, "file:///etc/passwd", "https://127.0.0.1/watch?v=" + VIDEO,
    "https://youtube.com/playlist?list=" + VIDEO, "https://youtube.com/watch?v=" + VIDEO + "&v=" + VIDEO,
    "https://youtu.be/short", "https://youtu.be/" + VIDEO + "/extra", "https://youtube.com/watch?v=../../passwd",
    "https://www.youtube.com\\@localhost/watch?v=" + VIDEO, "https://youtube.com/\nwatch?v=" + VIDEO,
])
def test_rejects_non_video_and_ambiguous_urls_before_any_network(monkeypatch, value):
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: pytest.fail("No network expected"))
    with pytest.raises(ValueError):
        youtube.parse_youtube(value)


def test_import_preserves_timestamps_language_and_honest_scope(monkeypatch):
    snippets = [SimpleNamespace(text="A &amp; B", start=65.4, duration=2),
                SimpleNamespace(text="Схема <в кадре>", start=3601.1, duration=5)]
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript(snippets, generated=True), ["ru", "en"]))
    monkeypatch.setattr(youtube, "_metadata", lambda url: {"title": "Научное видео", "author_name": "Автор"})
    result = youtube.parse_youtube(f"https://youtu.be/{VIDEO}")
    assert result["source_url"] == URL
    assert result["source_type"] == "youtube" and result["status"] == "ready"
    assert result["name"] == "Научное видео"
    assert result["metadata"]["analysis_scope"] == "captions_only"
    assert result["metadata"]["is_generated"] is True
    assert result["metadata"]["author"] == "Автор"
    assert result["pages"][0]["segments"][0]["url"] == URL + "&t=65"
    assert result["text"] == "[01:05] A & B\n[1:00:01] Схема <в кадре>"
    assert "Кадры видео и звук не анализировались" in result["description"]
    assert "segments" not in result["metadata"]  # Project summaries stay compact.


def test_transcript_pages_keep_every_segment_without_overlap(monkeypatch):
    snippets = [SimpleNamespace(text=f"Факт {i}", start=i * 2, duration=1) for i in range(161)]
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript(snippets), ["ru"]))
    monkeypatch.setattr(youtube, "_metadata", lambda _: {"title": "Видео"})
    result = youtube.parse_youtube(URL)
    assert [len(page["segments"]) for page in result["pages"]] == [80, 80, 1]
    assert result["metadata"]["segment_count"] == 161
    assert result["pages"][2]["start_seconds"] == 320
    assert len([s for p in result["pages"] for s in p["segments"]]) == 161


def test_metadata_failure_does_not_discard_captions(monkeypatch):
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript(), ["ru"]))
    monkeypatch.setattr(youtube, "_metadata", lambda _: (_ for _ in ()).throw(httpx.ConnectError("offline")))
    result = youtube.parse_youtube(URL)
    assert "Первый факт" in result["text"]
    assert result["name"] == "YouTube · " + VIDEO
    assert any("Название и автор недоступны" in warning for warning in result["warnings"])


@pytest.mark.parametrize("start,duration", [(float("nan"), 2), (2, float("inf")), (-1, 2)])
def test_rejects_invalid_timestamps(monkeypatch, start, duration):
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript([SimpleNamespace(text="x", start=start, duration=duration)]), ["ru"]))
    with pytest.raises(ValueError, match="временные метки"):
        youtube.parse_youtube(URL)


def test_empty_and_oversized_captions_are_not_ready_sources(monkeypatch):
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript([]), ["ru"]))
    with pytest.raises(ValueError, match="пуста"):
        youtube.parse_youtube(URL)
    monkeypatch.setattr(youtube, "MAX_SEGMENTS", 1)
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript([SimpleNamespace(text="x", start=1, duration=1)] * 2), ["ru"]))
    with pytest.raises(ValueError, match="слишком велика"):
        youtube.parse_youtube(URL)


def fake_api(monkeypatch, available):
    import youtube_transcript_api

    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", lambda **kwargs: SimpleNamespace(list=lambda _: available))


def track(code, generated):
    fetched = transcript(language=code, code=code, generated=generated)
    return SimpleNamespace(language_code=code, is_generated=generated, fetch=lambda: fetched)


def test_auto_language_prefers_russian_then_manual_and_supports_any_available(monkeypatch):
    fake_api(monkeypatch, [track("en", False), track("ru", True), track("ru", False)])
    fetched, available = youtube._fetch_transcript(VIDEO, None)
    assert fetched.language_code == "ru" and not fetched.is_generated
    assert available == ["en", "ru", "ru"]
    fake_api(monkeypatch, [track("fr", True), track("de", False)])
    fetched, _ = youtube._fetch_transcript(VIDEO, None)
    assert fetched.language_code == "de"


def test_explicit_language_is_not_silently_substituted(monkeypatch):
    fake_api(monkeypatch, [track("en", False)])
    with pytest.raises(ValueError, match="Доступны: en"):
        youtube._fetch_transcript(VIDEO, "ru")


@pytest.mark.parametrize("error_name,expected", [
    ("TranscriptsDisabled", "нет доступных субтитров"),
    ("VideoUnavailable", "Видео недоступно"),
    ("AgeRestricted", "требует входа"),
    ("RequestBlocked", "заблокировал"),
])
def test_upstream_failures_are_actionable_and_do_not_create_empty_sources(monkeypatch, error_name, expected):
    import youtube_transcript_api
    from youtube_transcript_api import _errors

    def fail(_):
        raise getattr(_errors, error_name)(VIDEO)

    monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", lambda **kwargs: SimpleNamespace(list=fail))
    with pytest.raises(ValueError, match=expected) as error:
        youtube.parse_youtube(URL)
    assert "TXT или Markdown" in str(error.value)


def test_transport_blocks_caption_redirects_and_non_youtube_hosts(monkeypatch):
    import requests
    import youtube_transcript_api

    sent = []

    def network(self, prepared, **kwargs):
        sent.append(prepared.url)
        assert kwargs["stream"] and kwargs["timeout"] <= 10 and not kwargs["allow_redirects"]
        response = requests.Response()
        response.status_code = 302
        response.headers["Location"] = "http://127.0.0.1/private"
        response.raw = io.BytesIO(b"")
        return response

    monkeypatch.setattr(requests.Session, "send", network)
    for url in ("https://evil.test/captions", "https://www.youtube.com/api/timedtext"):
        def factory(http_client, target=url):
            def listing(_):
                http_client.get(target)
                return []
            return SimpleNamespace(list=listing)
        monkeypatch.setattr(youtube_transcript_api, "YouTubeTranscriptApi", factory)
        with pytest.raises(ValueError):
            youtube._fetch_transcript(VIDEO, None)
    assert sent == ["https://www.youtube.com/api/timedtext"]


def test_oembed_uses_only_fixed_endpoint_and_canonical_video(monkeypatch):
    original_client = httpx.Client
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"title": "Test", "author_name": "Author"})

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: original_client(transport=httpx.MockTransport(respond), **kwargs))
    assert youtube._metadata(URL) == {"title": "Test", "author_name": "Author"}
    assert len(requests) == 1
    assert str(requests[0].url).startswith("https://www.youtube.com/oembed?")
    assert requests[0].url.params["url"] == URL


@pytest.fixture
def youtube_client(tmp_path):
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    from fastapi.testclient import TestClient

    from backend.core import router
    from backend.storage import Store

    app = FastAPI()
    app.state.store = Store(tmp_path)
    app.include_router(router, prefix="/api")

    @app.exception_handler(KeyError)
    async def not_found(request, exc):
        return JSONResponse({"error": "not found"}, status_code=404)

    with TestClient(app) as client:
        yield client


def test_api_youtube_import_search_download_and_annotation(youtube_client, monkeypatch):
    client = youtube_client
    pid = client.post("/api/projects", json={"name": "YouTube test"}).json()["id"]
    base = f"/api/projects/{pid}"
    folder = client.post(base + "/folders", json={"name": "Видео"}).json()
    calls = []

    def fetch(video_id, language):
        calls.append((video_id, language))
        return transcript(), ["ru"]

    monkeypatch.setattr(youtube, "_fetch_transcript", fetch)
    monkeypatch.setattr(youtube, "_metadata", lambda _: {"title": "Измерение", "author_name": "Автор"})
    response = client.post(base + "/documents/youtube", json={
        "url": f"https://youtu.be/{VIDEO}?si=tracking", "language": "ru", "folder_id": folder["id"],
    })
    assert response.status_code == 201, response.text
    document = response.json()
    did = document["id"]
    assert calls == [(VIDEO, "ru")]
    assert document["folder_id"] == folder["id"]
    assert document["source_url"] == URL
    assert document["size"] == len(document["text"].encode())
    assert "file_path" not in document
    assert client.get(base + f"/documents/{did}").json()["pages"][0]["segments"][0]["url"] == URL + "&t=65"

    state = client.get(base + "/state").json()
    assert len(state["documents"]) == 1
    assert state["documents"][0]["source_type"] == "youtube"
    assert "pages" not in state["documents"][0] and "text" not in state["documents"][0]
    results = client.get(base + "/search", params={"q": "Первый факт"}).json()
    assert results and results[0]["document_id"] == did
    assert "Первый факт" in results[0]["text"]

    downloaded = client.get(base + f"/documents/{did}/file")
    assert downloaded.status_code == 200
    assert downloaded.text == document["text"]
    assert downloaded.headers["content-type"].startswith("text/plain")
    assert "attachment" in downloaded.headers["content-disposition"]
    assert downloaded.headers["content-security-policy"] == "sandbox"
    start = document["pages"][0]["text"].index("Первый факт")
    annotation = client.post(base + "/annotations", json={
        "document_id": did, "page": 1, "start": start, "end": start + len("Первый факт"),
        "quote": "Первый факт", "note": "Проверить по ролику", "type": "verify",
    })
    assert annotation.status_code == 201, annotation.text


def test_api_youtube_respects_project_and_folder_boundaries(youtube_client, monkeypatch):
    client = youtube_client
    one = client.post("/api/projects", json={"name": "Первый"}).json()["id"]
    two = client.post("/api/projects", json={"name": "Другой"}).json()["id"]
    first, second = f"/api/projects/{one}", f"/api/projects/{two}"
    folder = client.post(first + "/folders", json={"name": "Только в первом проекте"}).json()
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: pytest.fail("Invalid folder must fail before network"))
    assert client.post(second + "/documents/youtube", json={"url": URL, "folder_id": folder["id"]}).status_code == 404
    assert client.post(second + "/documents/youtube", json={"url": URL, "folder_id": "missing"}).status_code == 404
    assert client.post("/api/projects/missing/documents/youtube", json={"url": URL}).status_code == 404
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (transcript(), ["ru"]))
    monkeypatch.setattr(youtube, "_metadata", lambda _: {"title": "Тест"})
    document = client.post(first + "/documents/youtube", json={"url": URL}).json()
    assert document["folder_id"] is None
    for suffix in ("", "/file"):
        assert client.get(second + f"/documents/{document['id']}" + suffix).status_code == 404
    assert client.get(second + "/search", params={"q": "Первый факт"}).json() == []
    assert client.get(second + "/state").json()["documents"] == []


@pytest.mark.parametrize("error", [
    "У этого видео нет доступных субтитров.", "Видео недоступно, закрыто или требует входа в YouTube.",
    "YouTube заблокировал получение субтитров.", "Ошибка связи с YouTube.",
])
def test_api_youtube_failures_return_422_without_creating_documents(youtube_client, monkeypatch, error):
    client = youtube_client
    pid = client.post("/api/projects", json={"name": "Ошибки"}).json()["id"]
    base = f"/api/projects/{pid}"
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: (_ for _ in ()).throw(ValueError(error)))
    response = client.post(base + "/documents/youtube", json={"url": URL})
    assert response.status_code == 422
    assert response.json()["detail"] == error
    assert client.get(base + "/state").json()["documents"] == []


def test_api_youtube_rejects_invalid_url_and_language_before_fetch(youtube_client, monkeypatch):
    client = youtube_client
    pid = client.post("/api/projects", json={"name": "Валидация"}).json()["id"]
    base = f"/api/projects/{pid}"
    monkeypatch.setattr(youtube, "_fetch_transcript", lambda *a: pytest.fail("No fetch for invalid input"))
    for payload in ({"url": "https://127.0.0.1/private"}, {"url": URL, "language": "../../private"}, {"url": ""}):
        response = client.post(base + "/documents/youtube", json=payload)
        assert response.status_code == 422
    assert client.get(base + "/state").json()["documents"] == []
