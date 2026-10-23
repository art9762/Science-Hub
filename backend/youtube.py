"""Import public YouTube captions as text, without downloading video or audio."""

from __future__ import annotations

import html
import math
import re
import time
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from .documents import MAX_EXTRACTED_CHARS, safe_filename

VIDEO_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")
LANGUAGE = re.compile(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\Z")
MAX_SEGMENTS = 30_000
MAX_RESPONSE_BYTES = 12 * 1024 * 1024
CAPTION_SCOPE = (
    "Источник содержит субтитры YouTube с временными метками. "
    "Кадры видео и звук не анализировались; субтитры могут содержать ошибки."
)
MANUAL_FALLBACK = "Можно загрузить расшифровку вручную как TXT или Markdown в базу знаний."


def normalize_youtube_url(value: str) -> tuple[str, str]:
    """Accept only known video URL shapes; never fetch the user supplied URL."""
    value = value.strip()
    if not value or len(value) > 2048 or any(ord(c) < 32 for c in value):
        raise ValueError("Укажите корректную ссылку на видео YouTube.")
    if "://" not in value:
        value = "https://" + value
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port is not None
            or "\\" in value
        ):
            raise ValueError
    except ValueError as exc:
        raise ValueError("Укажите обычную HTTP(S)-ссылку на видео YouTube.") from exc
    parts = parsed.path.strip("/").split("/")
    video_id = ""
    if host in {"youtu.be", "www.youtu.be"} and len(parts) == 1:
        video_id = parts[0]
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path.rstrip("/") == "/watch":
            ids = parse_qs(parsed.query).get("v", [])
            if len(ids) == 1:
                video_id = ids[0]
        elif len(parts) == 2 and parts[0] in {"shorts", "embed", "live"}:
            video_id = parts[1]
    elif host in {"youtube-nocookie.com", "www.youtube-nocookie.com"}:
        if len(parts) == 2 and parts[0] == "embed":
            video_id = parts[1]
    if not VIDEO_ID.fullmatch(video_id):
        raise ValueError("Нужна ссылка на отдельное видео YouTube: watch, youtu.be, shorts или live.")
    return video_id, f"https://www.youtube.com/watch?v={video_id}"


def _timestamp(seconds: float) -> str:
    seconds = int(seconds)
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}:{minutes:02}:{seconds:02}" if hours else f"{minutes:02}:{seconds:02}"


def _metadata(url: str) -> dict:
    # The endpoint and query video URL are canonical, not a general URL fetcher.
    with httpx.Client(timeout=10, follow_redirects=False) as client:
        with client.stream("GET", "https://www.youtube.com/oembed", params={"url": url, "format": "json"}) as response:
            response.raise_for_status()
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 200_000:
                    raise ValueError("Метаданные YouTube превышают допустимый размер.")
            import json

            data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("Некорректные метаданные YouTube.")
    return {key: str(data.get(key) or "")[:1000] for key in ("title", "author_name")}


def _fetch_transcript(video_id: str, language: str | None):
    """Keep the upstream client's requests bounded and confined to YouTube."""
    try:
        from requests import Session
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import (
            AgeRestricted,
            CouldNotRetrieveTranscript,
            RequestBlocked,
            TranscriptsDisabled,
            VideoUnavailable,
            VideoUnplayable,
        )
    except ImportError as exc:
        raise ValueError("Не установлен модуль youtube-transcript-api. Обновите зависимости приложения.") from exc

    class BoundedSession(Session):
        def __init__(self):
            super().__init__()
            self.deadline = time.monotonic() + 45
            self.trust_env = False

        def send(self, request, **kwargs):
            parsed = urlsplit(request.url)
            if (
                parsed.scheme != "https"
                or parsed.hostname not in {"www.youtube.com", "youtube.com", "youtubei.googleapis.com"}
                or parsed.username is not None
                or parsed.port is not None
            ):
                raise ValueError("YouTube вернул неподдерживаемый адрес субтитров.")
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise ValueError("Время загрузки субтитров истекло. Попробуйте позже.")
            kwargs.update(timeout=min(10, remaining), stream=True, allow_redirects=False)
            response = super().send(request, **kwargs)
            try:
                if response.is_redirect:
                    raise ValueError("YouTube перенаправил запрос. Попробуйте позже или загрузите расшифровку.")
                body = bytearray()
                for chunk in response.iter_content(64 * 1024):
                    body.extend(chunk)
                    if len(body) > MAX_RESPONSE_BYTES or time.monotonic() > self.deadline:
                        raise ValueError("Превышен лимит размера или времени загрузки субтитров.")
                response._content = bytes(body)
                response._content_consumed = True
                return response
            finally:
                response.close()

    try:
        with BoundedSession() as session:
            available = list(YouTubeTranscriptApi(http_client=session).list(video_id))
            if not available:
                raise ValueError("У этого видео нет доступных субтитров. " + MANUAL_FALLBACK)
            preferred = [language.lower()] if language else ["ru", "en"]
            chosen = None
            for code in preferred:
                matches = [item for item in available if item.language_code.lower() == code]
                if matches:
                    chosen = min(matches, key=lambda item: item.is_generated)
                    break
            if chosen is None and language:
                codes = ", ".join(sorted({item.language_code for item in available}))
                raise ValueError(f"Нет субтитров на языке «{language}». Доступны: {codes}.")
            chosen = chosen or min(available, key=lambda item: item.is_generated)
            return chosen.fetch(), [item.language_code for item in available]
    except (VideoUnavailable, VideoUnplayable, AgeRestricted) as exc:
        raise ValueError("Видео недоступно, закрыто или требует входа в YouTube. " + MANUAL_FALLBACK) from exc
    except TranscriptsDisabled as exc:
        raise ValueError("У этого видео нет доступных субтитров. " + MANUAL_FALLBACK) from exc
    except RequestBlocked as exc:
        raise ValueError("YouTube заблокировал получение субтитров. Попробуйте позже. " + MANUAL_FALLBACK) from exc
    except CouldNotRetrieveTranscript as exc:
        raise ValueError("Не удалось получить субтитры YouTube. " + MANUAL_FALLBACK) from exc
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Ошибка связи с YouTube. Попробуйте позже. " + MANUAL_FALLBACK) from exc


def parse_youtube(url: str, language: str | None = None) -> dict:
    """Return ordinary searchable document fields; caller persists the result."""
    video_id, canonical = normalize_youtube_url(url)
    language = language.strip() if language else None
    if language and not LANGUAGE.fullmatch(language):
        raise ValueError("Укажите код языка субтитров, например ru, en или zh-Hans.")
    transcript, available_languages = _fetch_transcript(video_id, language)
    segments, total = [], 0
    for snippet in transcript:
        text = html.unescape(str(snippet.text)).strip()
        if not text:
            continue
        start, duration = float(snippet.start), float(snippet.duration)
        if not all(math.isfinite(n) and 0 <= n <= 30 * 86400 for n in (start, duration)):
            raise ValueError("YouTube вернул некорректные временные метки.")
        total += len(text) + 20
        if total > MAX_EXTRACTED_CHARS - 10_000 or len(segments) >= MAX_SEGMENTS:
            raise ValueError("Расшифровка слишком велика: лимит 3 млн символов и 30 000 фрагментов.")
        segments.append({"text": text, "start": start, "duration": duration,
                         "url": canonical + "&" + urlencode({"t": int(start)})})
    if not segments:
        raise ValueError("Расшифровка YouTube пуста. " + MANUAL_FALLBACK)
    notices = [CAPTION_SCOPE]
    try:
        metadata = _metadata(canonical)
    except Exception:
        metadata = {}
        notices.append("Название и автор недоступны; расшифровка сохранена.")
    title = metadata.get("title") or f"YouTube · {video_id}"
    language_name = str(transcript.language)
    generated = bool(transcript.is_generated)
    pages = []
    for offset in range(0, len(segments), 80):
        group = segments[offset:offset + 80]
        text = "\n".join(f"[{_timestamp(item['start'])}] {item['text']}" for item in group)
        pages.append({"number": len(pages) + 1, "text": text,
                      "start_seconds": group[0]["start"], "segments": group})
    full_text = "\n\n".join(page["text"] for page in pages)
    return {
        "name": safe_filename(title)[:180], "category": "YouTube", "mime_type": "text/plain",
        "status": "ready", "ocr_status": "not_needed", "source_type": "youtube",
        "source_url": canonical, "url": canonical, "pages": pages,
        "text": full_text, "size": len(full_text.encode("utf-8")),
        "description": f"{title}\n{canonical}\n{CAPTION_SCOPE}", "warnings": notices,
        "metadata": {"video_id": video_id, "url": canonical, "title": title,
                     "author": metadata.get("author_name", ""), "language": language_name,
                     "language_code": transcript.language_code, "is_generated": generated,
                     "available_languages": available_languages, "transcript_kind": "automatic" if generated else "manual",
                     "segment_count": len(segments), "page_count": len(pages), "analysis_scope": "captions_only"},
    }
