"""Durable, project-isolated local storage. Each operation owns its connection."""

from __future__ import annotations

import json
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

KINDS = frozenset(
    {
        "document",
        "annotation",
        "agent",
        "message",
        "run",
        "event",
        "workspace_document",
        "decision",
        "claim",
        "board_item",
        "link",
    }
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, data_dir: Path):
        self.root = Path(data_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "files").mkdir(exist_ok=True)
        self.database = self.root / "science-hub.sqlite3"
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS objects (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
                    kind TEXT NOT NULL, data TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
                CREATE INDEX IF NOT EXISTS objects_project_kind ON objects(project_id, kind);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.database, timeout=30)
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=30000")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _kind(kind: str):
        if kind not in KINDS:
            raise ValueError("Unknown object kind")

    @staticmethod
    def _project(db, project_id: str) -> dict:
        row = db.execute("SELECT data FROM projects WHERE id=?", (project_id,)).fetchone()
        if row is None:
            raise KeyError("Project not found")
        return json.loads(row[0])

    def projects(self) -> list[dict]:
        with self.connection() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT data FROM projects ORDER BY rowid DESC")]

    def create_project(self, name: str, description: str = "") -> dict:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Project name is required")
        timestamp = now()
        result = {
            "id": str(uuid4()),
            "name": name.strip(),
            "description": description,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        with self.connection() as db:
            db.execute(
                "INSERT INTO projects(id,data) VALUES(?,?)",
                (result["id"], json.dumps(result, ensure_ascii=False)),
            )
        return result

    def project(self, project_id: str) -> dict:
        with self.connection() as db:
            return self._project(db, project_id)

    def update_project(self, project_id: str, changes: dict) -> dict:
        with self.connection() as db:
            result = self._project(db, project_id)
            for key in ("name", "description"):
                if key in changes:
                    result[key] = changes[key]
            if not isinstance(result["name"], str) or not result["name"].strip():
                raise ValueError("Project name is required")
            result["name"] = result["name"].strip()
            result["updated_at"] = now()
            db.execute(
                "UPDATE projects SET data=? WHERE id=?", (json.dumps(result, ensure_ascii=False), project_id)
            )
        return result

    def delete_project(self, project_id: str):
        with self.connection() as db:
            self._project(db, project_id)
            db.execute("DELETE FROM projects WHERE id=?", (project_id,))
        directory = (self.root / "files" / project_id).resolve()
        if directory.parent == (self.root / "files").resolve():
            shutil.rmtree(directory, ignore_errors=True)

    def list(self, project_id: str, kind: str) -> list[dict]:
        self._kind(kind)
        with self.connection() as db:
            self._project(db, project_id)
            rows = db.execute(
                "SELECT data FROM objects WHERE project_id=? AND kind=? ORDER BY rowid", (project_id, kind)
            )
            return [json.loads(row[0]) for row in rows]

    def get(self, project_id: str, kind: str, item_id: str) -> dict:
        self._kind(kind)
        with self.connection() as db:
            self._project(db, project_id)
            row = db.execute(
                "SELECT data FROM objects WHERE project_id=? AND kind=? AND id=?", (project_id, kind, item_id)
            ).fetchone()
            if row is None:
                raise KeyError("Object not found in this project")
            return json.loads(row[0])

    def put(self, project_id: str, kind: str, data: dict) -> dict:
        self._kind(kind)
        result = dict(data)
        if result.get("project_id", project_id) != project_id:
            raise KeyError("Object does not belong to this project")
        item_id = result.get("id") or str(uuid4())
        if not isinstance(item_id, str) or not item_id or len(item_id) > 200:
            raise ValueError("Invalid object identifier")
        with self.connection() as db:
            self._project(db, project_id)
            existing = db.execute(
                "SELECT project_id,kind,data FROM objects WHERE id=?", (item_id,)
            ).fetchone()
            if existing and (existing[0] != project_id or existing[1] != kind):
                raise KeyError("Object does not belong to this project or kind")
            previous = json.loads(existing[2]) if existing else {}
            timestamp = now()
            result.update(
                id=item_id,
                project_id=project_id,
                created_at=previous.get("created_at", result.get("created_at") or timestamp),
                updated_at=timestamp,
            )
            db.execute(
                "INSERT INTO objects(id,project_id,kind,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                (item_id, project_id, kind, json.dumps(result, ensure_ascii=False, allow_nan=False)),
            )
        return result

    def delete(self, project_id: str, kind: str, item_id: str):
        self._kind(kind)
        with self.connection() as db:
            self._project(db, project_id)
            row = db.execute(
                "SELECT data FROM objects WHERE project_id=? AND kind=? AND id=?", (project_id, kind, item_id)
            ).fetchone()
            if row is None:
                raise KeyError("Object not found in this project")
            deleted = json.loads(row[0])
            # Remove dangling anchors/visual references, including edges to removed cards.
            related = [
                (row[0], row[1], json.loads(row[2]))
                for row in db.execute(
                    "SELECT id,kind,data FROM objects WHERE project_id=?", (project_id,)
                ).fetchall()
            ]
            removed = {item_id}
            while True:
                previous_count = len(removed)
                for related_id, related_kind, item in related:
                    cascade = (
                        (related_kind == "annotation" and item.get("document_id") in removed)
                        or (
                            related_kind == "link"
                            and (item.get("source") in removed or item.get("target") in removed)
                        )
                        or (related_kind == "board_item" and item.get("reference_id") in removed)
                    )
                    if cascade:
                        removed.add(related_id)
                if len(removed) == previous_count:
                    break
            for related_id, related_kind, item in related:
                if related_id in removed:
                    db.execute("DELETE FROM objects WHERE id=?", (related_id,))
                    continue
                changed = False
                if related_kind == "decision" and item.get("parent_id") in removed:
                    item["parent_id"] = None
                    changed = True
                missing = [source for source in item.get("source_ids", []) if source in removed]
                if missing and related_kind in {"claim", "decision"}:
                    item["source_ids"] = [source for source in item["source_ids"] if source not in removed]
                    item["missing_source_ids"] = list(
                        dict.fromkeys(item.get("missing_source_ids", []) + missing)
                    )
                    item["confidence"] = None
                    notice = "Источник удалён из проекта. Вывод требует повторной проверки."
                    item["verification_note"] = notice
                    item["confidence_provenance"] = "source_removed"
                    if related_kind == "claim":
                        item["status"] = "unverified"
                        item["reason"] = (item.get("reason", "") + "\n" + notice).strip()
                    else:
                        item["rationale"] = (item.get("rationale", "") + "\n" + notice).strip()
                    changed = True
                if changed:
                    item["updated_at"] = now()
                    db.execute(
                        "UPDATE objects SET data=? WHERE id=?",
                        (json.dumps(item, ensure_ascii=False), related_id),
                    )
        if kind == "document" and deleted.get("file_path"):
            try:
                self.file_path(deleted["file_path"]).unlink(missing_ok=True)
            except (ValueError, OSError):
                pass

    def file_path(self, relative: str) -> Path:
        """Resolve only regular uploaded files inside the managed file directory."""
        if Path(relative).is_absolute():
            raise ValueError("Invalid stored file path")
        path = (self.root / relative).resolve()
        if not path.is_relative_to((self.root / "files").resolve()):
            raise ValueError("Invalid stored file path")
        return path

    def search(self, project_id: str, query: str, document_ids=None) -> list[dict]:
        documents = self.list(project_id, "document")
        if document_ids:
            allowed = set(document_ids)
            available = {item["id"] for item in documents}
            if not allowed.issubset(available):
                raise KeyError("Document not found in this project")
            documents = [item for item in documents if item["id"] in allowed]
        needle = query.strip().casefold()
        if not needle:
            return []
        result = []
        by_id = {item["id"]: item for item in documents}

        def add(document, text, source, page=1, **extra):
            text = str(text or "")
            folded = text.casefold()
            index = folded.find(needle)
            if index < 0 or len(result) >= 100:
                return
            match_end = index + len(needle)
            if len(folded) != len(text):
                # Case folding can expand characters (ß -> ss); keep original text anchors.
                cursor, original_start = 0, None
                for offset, character in enumerate(text):
                    next_cursor = cursor + len(character.casefold())
                    if original_start is None and next_cursor > index:
                        original_start = offset
                    if next_cursor >= match_end:
                        index, match_end = original_start or 0, offset + 1
                        break
                    cursor = next_cursor
            start, end = max(0, index - 100), min(len(text), match_end + 220)
            result.append(
                {
                    "document_id": document["id"],
                    "document_name": document["name"],
                    "page": page,
                    "text": text[start:end],
                    "source": source,
                    "start": index,
                    "end": match_end,
                    "quote": text[index:match_end],
                    "snippet_start": start,
                    **extra,
                }
            )

        for document in documents:
            for page in document.get("pages", []):
                add(document, page.get("text", ""), "text", page.get("number", 1))
            if not document.get("pages"):
                add(document, document.get("text", ""), "text")
            add(document, document.get("description", ""), "description")
            add(
                document,
                " · ".join(str(document.get(key, "")) for key in ("name", "category", "mime_type"))
                + " "
                + json.dumps(document.get("metadata", {}), ensure_ascii=False),
                "metadata",
            )
        for annotation in self.list(project_id, "annotation"):
            if document := by_id.get(annotation.get("document_id")):
                add(
                    document,
                    " ".join([annotation.get("quote", ""), annotation.get("note", "")]),
                    "annotation",
                    annotation.get("page", 1),
                    annotation_id=annotation["id"],
                    start=annotation.get("start", 0),
                    end=annotation.get("end", 0),
                    quote=annotation.get("quote", ""),
                )
        return result
