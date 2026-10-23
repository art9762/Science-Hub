"""Searchable, project-owned public sources with explicit extraction provenance."""

from urllib.parse import urlsplit, urlunsplit
from uuid import NAMESPACE_URL, uuid5

from .storage import now


def source_url(value: str) -> str:
    try:
        parts = urlsplit(value.strip())
        if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
            raise ValueError
        _ = parts.port
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, ""))
    except (ValueError, AttributeError):
        raise ValueError("Укажите корректную публичную HTTP(S) ссылку на источник.") from None


def save_web_source(store, pid, item, *, content=None, folder_id=None):
    url = source_url(item["url"])
    item_id = str(uuid5(NAMESPACE_URL, f"science-hub:{pid}:web:{url}"))

    def merge(previous, incoming):
        metadata = dict(previous.get("metadata", {}))
        title = str(item.get("title") or previous.get("name") or url)[:200]
        # This check and the write share a transaction, including across Store
        # instances: a late search result cannot overwrite a page just read.
        if content is None and metadata.get("content_kind") == "web_page":
            return previous
        snippet = str(item.get("snippet") or metadata.get("search_snippet") or "")[:20000]
        body = str(content) if content is not None else snippet
        text = f"{title}\n{url}\n\n{body}"
        metadata.update(
            url=url, source=str(item.get("source") or metadata.get("source") or "web"),
            content_kind="web_page" if content is not None else "search_snippet",
            search_snippet=snippet, retrieved_at=now(),
        )
        for key in ("read_url", "truncated", "note"):
            if key in item:
                metadata[key] = item[key]
        return {
            **previous, "id": item_id, "name": title, "source_type": "web", "source_url": url,
            "category": previous.get("category", "Интернет"), "mime_type": "text/plain",
            "folder_id": folder_id if folder_id is not None else previous.get("folder_id"),
            "text": text, "pages": [{"number": 1, "text": text}], "size": len(text.encode("utf-8")),
            "description": "Текст веб-страницы" if content is not None else "Результат поиска: сохранён фрагмент, полный текст страницы ещё не прочитан.",
            "metadata": metadata,
        }

    return store.put(pid, "document", {"id": item_id}, merge=merge)
