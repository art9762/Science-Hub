"""HTTP workspace CRUD, document ingestion, anchors, and exports."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlparse
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .documents import (
    MAX_UPLOAD_BYTES,
    SUPPORTED_EXTENSIONS,
    export_document,
    parse_document,
    render_pdf_page,
    safe_filename,
)
from .storage import KINDS, Store

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class ProjectInput(Payload):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=20000)


class ProjectPatch(Payload):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=20000)


class DocumentPatch(Payload):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=100000)
    folder_id: str | None = Field(default=None, min_length=1, max_length=200)


class FolderInput(Payload):
    name: str = Field(min_length=1, max_length=200)
    parent_id: str | None = Field(default=None, min_length=1, max_length=200)


class ChatInput(Payload):
    title: str = Field(default="Новый чат", min_length=1, max_length=200)


class WebSourceInput(Payload):
    url: str = Field(min_length=1, max_length=4000)
    title: str = Field(default="", max_length=2000)
    snippet: str = Field(default="", max_length=20000)
    source: str = Field(default="web", max_length=100)
    folder_id: str | None = Field(default=None, min_length=1, max_length=200)


class YouTubeInput(Payload):
    url: str = Field(min_length=1, max_length=4000)
    language: str | None = Field(default=None, max_length=30)
    folder_id: str | None = Field(default=None, min_length=1, max_length=200)


class AnnotationInput(Payload):
    document_id: str
    page: int = Field(default=1, ge=1)
    start: int = Field(default=0, ge=0)
    end: int = Field(default=0, ge=0)
    quote: str = Field(default="", max_length=100000)
    note: str = Field(default="", max_length=20000)
    type: Literal["important", "ignore", "verify", "note"] = "note"


class AgentInput(Payload):
    name: str = Field(default="Новый специалист", min_length=1, max_length=120)
    role: str = Field(default="specialist", max_length=120)
    system_prompt: str = Field(default="", max_length=50000)
    model: str = Field(default="", max_length=200)
    provider_id: str = Field(default="", max_length=200)
    color: str = Field(default="#7164f4", pattern=r"^#[0-9a-fA-F]{6}$")
    tools: list[str] = Field(
        default_factory=lambda: [
            "search_knowledge",
            "read_document",
            "read_working_document",
            "web_search",
            "read_web",
            "calculate",
            "write_document",
            "save_claim",
            "save_decision",
            "report_conflict",
            "request_information",
            "remember",
            "delegate_agent",
            "link_entities",
        ],
        max_length=30,
    )
    enabled: bool = True


class WorkspaceInput(Payload):
    title: str = Field(default="Новый документ", min_length=1, max_length=200)
    content: str = Field(default="", max_length=3_000_000)
    format: Literal["markdown"] = "markdown"
    source_run_id: str | None = None


class Alternative(Payload):
    title: str = Field(max_length=500)
    reason: str = Field(default="", max_length=20000)


class DecisionInput(Payload):
    title: str = Field(default="Новое решение", min_length=1, max_length=500)
    description: str = Field(default="", max_length=100000)
    status: Literal["proposed", "accepted", "rejected"] = "proposed"
    parent_id: str | None = None
    rationale: str = Field(default="", max_length=100000)
    alternatives: list[Alternative] = Field(default_factory=list, max_length=100)
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)


class ClaimInput(Payload):
    text: str = Field(default="Новый факт", min_length=1, max_length=100000)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    status: Literal["unverified", "supported", "disputed"] = "unverified"
    source_ids: list[str] = Field(default_factory=list, max_length=100)
    reason: str = Field(default="", max_length=100000)


class BoardInput(Payload):
    type: Literal["note", "document", "image", "research"] = "note"
    text: str = Field(default="", max_length=100000)
    x: float = Field(default=40, ge=-100000, le=100000, allow_inf_nan=False)
    y: float = Field(default=40, ge=-100000, le=100000, allow_inf_nan=False)
    width: float = Field(default=260, ge=80, le=2000, allow_inf_nan=False)
    height: float = Field(default=180, ge=60, le=2000, allow_inf_nan=False)
    color: str = Field(default="#fff6ce", pattern=r"^#[0-9a-fA-F]{6}$")
    reference_id: str | None = None


class LinkInput(Payload):
    source: str = Field(min_length=1, max_length=200)
    target: str = Field(min_length=1, max_length=200)
    label: str = Field(default="связано", max_length=300)


SEEDS = [
    (
        "engineer",
        "Инженер-конструктор",
        "Проектируй инженерные решения, проверяй исходные данные, допуски, нагрузки и единицы измерения. Явно отмечай предположения и обосновывай выбор конструкции.",
        "#7467ed",
    ),
    (
        "analyst",
        "Аналитик",
        "Анализируй данные проекта, сравнивай варианты и выполняй прозрачные расчёты. Отделяй наблюдения от выводов, оценивай полноту данных.",
        "#5096f3",
    ),
    (
        "researcher",
        "Исследователь",
        "Исследуй первичные источники, техническую документацию и научные работы. Сохраняй ссылки и явно указывай ограничения найденных сведений.",
        "#38a990",
    ),
    (
        "critic",
        "Критик",
        "Ищи слабые места предлагаемых решений, противоречия и альтернативы. Формулируй конкретные проверяемые возражения и способы устранения проблем.",
        "#e89d49",
    ),
    (
        "fact_checker",
        "Факт-чекер",
        "Проверяй факты по независимым источникам. Не считай уверенность модели доказательством. Показывай происхождение каждого проверенного утверждения и выявляй противоречия.",
        "#35a9ba",
    ),
    (
        "technologist",
        "Технолог",
        "Оценивай технологичность, материалы, производственные процессы, сборку, обслуживание и контроль качества. Указывай недостающие производственные ограничения.",
        "#a476d6",
    ),
    (
        "estimator",
        "Сметчик",
        "Оценивай стоимость материалов, производства и эксплуатации. Указывай валюту, дату, источники цен и диапазон неопределённости; не выдумывай котировки.",
        "#c7904c",
    ),
    (
        "pessimist",
        "Агент-пессимист",
        "Сосредоточься на рисках, отказах, худших сценариях и скрытых зависимостях. Оцени последствия и способы проверки риска без необоснованной категоричности.",
        "#d07185",
    ),
]


def store_for(request: Request) -> Store:
    return request.app.state.store


def document_public(document: dict, summary=False) -> dict:
    result = {key: value for key, value in document.items() if key != "file_path"}
    result.setdefault("folder_id", None)
    result["page_count"] = len(document.get("pages", []))
    if summary:
        result.pop("pages", None)
        result.pop("text", None)
    return result


def _changes(body: BaseModel) -> dict:
    return body.model_dump(exclude_unset=True, exclude_none=True)


def _named(data: dict, field="name"):
    if field in data and not data[field].strip():
        raise HTTPException(422, f"Поле {field} не может быть пустым.")


def _object_exists(store, pid, item_id):
    for kind in KINDS - {"annotation", "link"}:
        try:
            return store.get(pid, kind, item_id)
        except KeyError:
            continue
    raise KeyError("Referenced object not found in this project")


def _validate_sources(store, pid, source_ids):
    for source in source_ids:
        parsed = urlparse(source)
        if parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.username:
            continue
        _object_exists(store, pid, source)


@router.get("/projects")
def projects(request: Request):
    return store_for(request).projects()


@router.post("/projects", status_code=201)
def create_project(body: ProjectInput, request: Request):
    _named(body.model_dump())
    store = store_for(request)
    project = store.create_project(body.name, body.description)
    for role, name, prompt, color in SEEDS:
        store.put(
            project["id"],
            "agent",
            AgentInput(role=role, name=name, system_prompt=prompt, color=color).model_dump(),
        )
    return project


@router.get("/projects/{pid}")
def project(pid: str, request: Request):
    return store_for(request).project(pid)


@router.patch("/projects/{pid}")
def patch_project(pid: str, body: ProjectPatch, request: Request):
    data = _changes(body)
    _named(data)
    return store_for(request).update_project(pid, data)


@router.delete("/projects/{pid}", status_code=204)
async def delete_project(pid: str, request: Request):
    store = store_for(request)
    task_keys = [run["id"] for run in store.list(pid, "run")]
    task_keys += ["vision:" + doc["id"] for doc in store.list(pid, "document")]
    tasks = getattr(request.app.state, "ai_tasks", {})
    pending = [tasks[key] for key in task_keys if key in tasks]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    store.delete_project(pid)


@router.get("/projects/{pid}/state")
def state(pid: str, request: Request):
    store = store_for(request)
    store.ensure_chats(pid)
    result = {"project": store.project(pid)}
    for plural, kind in (
        ("documents", "document"),
        ("folders", "folder"),
        ("agents", "agent"),
        ("chats", "chat"),
        ("messages", "message"),
        ("runs", "run"),
        ("events", "event"),
        ("workspace_documents", "workspace_document"),
        ("decisions", "decision"),
        ("claims", "claim"),
        ("board_items", "board_item"),
        ("links", "link"),
        ("annotations", "annotation"),
    ):
        result[plural] = store.list(pid, kind)
    result["documents"] = [document_public(item, summary=True) for item in result["documents"]]
    return result


@router.get("/projects/{pid}/chats")
def chats(pid: str, request: Request):
    store = store_for(request)
    store.ensure_chats(pid)
    return store.list(pid, "chat")


@router.post("/projects/{pid}/chats", status_code=201)
def create_chat(pid: str, body: ChatInput, request: Request):
    _named(body.model_dump(), "title")
    return store_for(request).put(pid, "chat", {"title": body.title.strip()})


@router.patch("/projects/{pid}/chats/{item_id}")
def rename_chat(pid: str, item_id: str, body: ChatInput, request: Request):
    _named(body.model_dump(), "title")
    store = store_for(request)
    return store.put(pid, "chat", {**store.get(pid, "chat", item_id), "title": body.title.strip()})


@router.delete("/projects/{pid}/chats/{item_id}", status_code=204)
async def delete_chat(pid: str, item_id: str, request: Request):
    store = store_for(request)
    store.get(pid, "chat", item_id)
    tasks = getattr(request.app.state, "ai_tasks", {})
    pending = [tasks[run["id"]] for run in store.list(pid, "run") if run.get("chat_id") == item_id and run["id"] in tasks]
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    store.delete(pid, "chat", item_id)


@router.post("/projects/{pid}/documents/web", status_code=201)
def import_web_source(pid: str, body: WebSourceInput, request: Request):
    from .sources import save_web_source

    store = store_for(request)
    store.project(pid)
    if body.folder_id:
        store.get(pid, "folder", body.folder_id)
    try:
        return document_public(save_web_source(store, pid, body.model_dump(), folder_id=body.folder_id))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/projects/{pid}/documents/youtube", status_code=201)
async def import_youtube(pid: str, body: YouTubeInput, request: Request):
    from .youtube import parse_youtube

    store = store_for(request)
    store.project(pid)
    if body.folder_id:
        store.get(pid, "folder", body.folder_id)
    try:
        parsed = await run_in_threadpool(parse_youtube, body.url, body.language)
        return document_public(store.put(pid, "document", {**parsed, "folder_id": body.folder_id}))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/projects/{pid}/documents", status_code=201)
async def upload_documents(
    pid: str,
    request: Request,
    files: list[UploadFile] = File(...),
    category: str = Form("Общее"),
    folder_id: str | None = Form(default=None, min_length=1, max_length=200),
):
    store = store_for(request)
    store.project(pid)
    if folder_id is not None:
        store.get(pid, "folder", folder_id)
    if len(files) > 20 or not files:
        raise HTTPException(422, "Загрузите от 1 до 20 файлов за один раз.")
    if len(category) > 100:
        raise HTTPException(422, "Название категории слишком длинное.")
    directory = store.root / "files" / pid
    directory.mkdir(parents=True, exist_ok=True)
    created, current, batch_size = [], None, 0
    try:
        for upload in files:
            name = safe_filename(upload.filename or "document")
            extension = Path(name).suffix.lower()
            if extension not in SUPPORTED_EXTENSIONS:
                raise HTTPException(422, f"Формат файла «{name}» не поддерживается.")
            current = directory / f"{uuid4()}{extension}"
            size = 0
            with current.open("xb") as output:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    batch_size += len(chunk)
                    if size > MAX_UPLOAD_BYTES or batch_size > 100 * 1024 * 1024:
                        raise HTTPException(413, "Лимит: 30 МБ на файл и 100 МБ на одну загрузку.")
                    output.write(chunk)
            if size == 0:
                raise HTTPException(422, f"Файл «{name}» пуст.")
            extracted = await run_in_threadpool(parse_document, current, name)
            document = store.put(
                pid,
                "document",
                {
                    "name": name,
                    "category": category.strip() or "Общее",
                    "folder_id": folder_id,
                    "size": size,
                    "file_path": str(current.relative_to(store.root)),
                    **extracted,
                },
            )
            created.append(document)
            current = None
        # Only schedule once the whole upload succeeds, avoiding work on rolled-back files.
        from .ai import schedule_image_analysis

        for item in created:
            if item["mime_type"].startswith("image/"):
                schedule_image_analysis(request.app, pid, item["id"])
        return [document_public(store.get(pid, "document", item["id"]), summary=True) for item in created]
    except Exception as exc:
        if current:
            current.unlink(missing_ok=True)
        for item in created:
            store.delete(pid, "document", item["id"])
        if isinstance(exc, ValueError):
            raise HTTPException(422, str(exc)) from exc
        raise
    finally:
        for upload in files:
            await upload.close()


@router.get("/projects/{pid}/documents/{item_id}")
def document(pid: str, item_id: str, request: Request):
    return document_public(store_for(request).get(pid, "document", item_id))


@router.patch("/projects/{pid}/documents/{item_id}")
def patch_document(pid: str, item_id: str, body: DocumentPatch, request: Request):
    store = store_for(request)
    data = _changes(body)
    if "folder_id" in body.model_fields_set:
        data["folder_id"] = body.folder_id
    _named(data)
    if "name" in data:
        data["name"] = safe_filename(data["name"])
    return document_public(store.put(pid, "document", {**store.get(pid, "document", item_id), **data}))


@router.delete("/projects/{pid}/documents/{item_id}", status_code=204)
async def delete_document(pid: str, item_id: str, request: Request):
    store = store_for(request)
    store.get(pid, "document", item_id)
    task = getattr(request.app.state, "ai_tasks", {}).get("vision:" + item_id)
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    store.delete(pid, "document", item_id)


@router.get("/projects/{pid}/documents/{item_id}/file")
def document_file(pid: str, item_id: str, request: Request):
    store = store_for(request)
    document = store.get(pid, "document", item_id)
    if not document.get("file_path") and document.get("source_type") in {"web", "youtube"}:
        filename = safe_filename(document["name"]) + ".txt"
        return Response(document.get("text", "").encode("utf-8"), media_type="text/plain; charset=utf-8", headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "Content-Security-Policy": "sandbox",
        })
    try:
        path = store.file_path(document["file_path"])
    except (ValueError, KeyError):
        raise HTTPException(404, "Исходный файл недоступен.")
    if not path.is_file():
        raise HTTPException(404, "Исходный файл не найден на диске.")
    # PDFs use the raster page viewer; download originals instead of requiring a
    # browser plugin that cannot run inside the restrictive document sandbox.
    disposition = "inline" if document["mime_type"].startswith("image/") else "attachment"
    return FileResponse(
        path,
        media_type=document["mime_type"],
        filename=safe_filename(document["name"]),
        content_disposition_type=disposition,
        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"},
    )


@router.get("/projects/{pid}/documents/{item_id}/pages/{page}/image")
def document_page_image(pid: str, item_id: str, page: int, request: Request):
    store = store_for(request)
    document = store.get(pid, "document", item_id)
    if document.get("mime_type") != "application/pdf":
        raise HTTPException(422, "Просмотр страниц доступен только для PDF.")
    if page < 1 or not any(item["number"] == page for item in document.get("pages", [])):
        raise HTTPException(404, "Страница отсутствует в документе.")
    try:
        path = store.file_path(document["file_path"])
        if not path.is_file():
            raise HTTPException(404, "Исходный PDF не найден на диске.")
        data = render_pdf_page(path, page)
    except ImportError:
        raise HTTPException(503, "Для просмотра оригинальных страниц PDF установите PyMuPDF.") from None
    except IndexError:
        raise HTTPException(404, "Страница отсутствует в документе.") from None
    except (ValueError, RuntimeError, OSError):
        raise HTTPException(
            422, "Не удалось отобразить страницу PDF. Проверьте целостность исходного файла."
        ) from None
    return Response(
        data,
        media_type="image/png",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.get("/projects/{pid}/search")
def search(pid: str, request: Request, q: str = Query(default="", max_length=300), document_ids: str = ""):
    ids = [item for item in document_ids.split(",") if item]
    return store_for(request).search(pid, q, ids or None)


@router.get("/projects/{pid}/annotations")
def annotations(pid: str, request: Request):
    return store_for(request).list(pid, "annotation")


@router.post("/projects/{pid}/annotations", status_code=201)
def create_annotation(pid: str, body: AnnotationInput, request: Request):
    store = store_for(request)
    document = store.get(pid, "document", body.document_id)
    page = next((page for page in document.get("pages", []) if page["number"] == body.page), None)
    if page is None:
        raise HTTPException(422, "Страница отсутствует в документе.")
    text = page["text"]
    if body.end < body.start or body.end > len(text):
        raise HTTPException(422, "Выделение выходит за границы текста страницы.")
    if body.quote and text[body.start : body.end] != body.quote:
        raise HTTPException(422, "Выделенный текст изменился. Повторите выделение на странице.")
    if body.start == body.end and not body.note.strip():
        raise HTTPException(422, "Выделите текст или добавьте заметку к странице.")
    data = body.model_dump()
    data["quote"] = text[body.start : body.end]
    return store.put(pid, "annotation", data)


@router.delete("/projects/{pid}/annotations/{item_id}", status_code=204)
def delete_annotation(pid: str, item_id: str, request: Request):
    store_for(request).delete(pid, "annotation", item_id)


def _validate_entity(store, pid, kind, data, item_id=None):
    if kind in {"agent", "folder"}:
        _named(data)
    if kind in {"workspace_document", "decision"}:
        _named(data, "title")
    if kind == "claim":
        _named(data, "text")
        data["confidence_provenance"] = "user_assessment"
        data["verification_note"] = "Оценка пользователя. Автоматическая проверка источников не выполнялась."
    if data.get("source_ids"):
        _validate_sources(store, pid, data["source_ids"])
    if data.get("source_run_id"):
        store.get(pid, "run", data["source_run_id"])
    if kind == "decision" and data.get("parent_id"):
        parent_id = data["parent_id"]
        visited = {item_id} if item_id else set()
        while parent_id:
            if parent_id in visited:
                raise HTTPException(422, "Решения не могут образовывать цикл.")
            visited.add(parent_id)
            parent_id = store.get(pid, "decision", parent_id).get("parent_id")
    if kind == "board_item" and data.get("reference_id"):
        _object_exists(store, pid, data["reference_id"])
    if kind == "link":
        _object_exists(store, pid, data["source"])
        _object_exists(store, pid, data["target"])
        if data["source"] == data["target"]:
            raise HTTPException(422, "Выберите два разных объекта для связи.")


def _register_entity(path, kind, model, *, detail=False, patch=True):
    """Models validate a merged object on patch so partial updates remain strict."""

    def list_items(pid: str, request: Request):
        return store_for(request).list(pid, kind)

    def create_item(pid: str, request: Request, body: dict):
        from pydantic import ValidationError

        try:
            data = model.model_validate(body).model_dump()
        except ValidationError as exc:
            raise HTTPException(422, exc.errors(include_context=False)) from exc
        store = store_for(request)
        store.project(pid)
        _validate_entity(store, pid, kind, data)
        try:
            return store.put(pid, kind, data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    def get_item(pid: str, item_id: str, request: Request):
        return store_for(request).get(pid, kind, item_id)

    def patch_item(pid: str, item_id: str, request: Request, body: dict):
        from pydantic import ValidationError

        store = store_for(request)
        original = store.get(pid, kind, item_id)
        editable = {key: value for key, value in original.items() if key in model.model_fields}
        try:
            data = model.model_validate({**editable, **body}).model_dump()
        except ValidationError as exc:
            raise HTTPException(422, exc.errors(include_context=False)) from exc
        _validate_entity(store, pid, kind, data, item_id)
        try:
            return store.put(pid, kind, {**original, **data})
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    def delete_item(pid: str, item_id: str, request: Request):
        store_for(request).delete(pid, kind, item_id)

    base = f"/projects/{{pid}}/{path}"
    router.add_api_route(base, list_items, methods=["GET"], name=f"list_{kind}")
    router.add_api_route(base, create_item, methods=["POST"], status_code=201, name=f"create_{kind}")
    if detail:
        router.add_api_route(base + "/{item_id}", get_item, methods=["GET"], name=f"get_{kind}")
    if patch:
        router.add_api_route(base + "/{item_id}", patch_item, methods=["PATCH"], name=f"patch_{kind}")
    router.add_api_route(
        base + "/{item_id}", delete_item, methods=["DELETE"], status_code=204, name=f"delete_{kind}"
    )


for path, kind, model in (
    ("folders", "folder", FolderInput),
    ("agents", "agent", AgentInput),
    ("workspace-documents", "workspace_document", WorkspaceInput),
    ("decisions", "decision", DecisionInput),
    ("claims", "claim", ClaimInput),
    ("board-items", "board_item", BoardInput),
    ("links", "link", LinkInput),
):
    _register_entity(path, kind, model, detail=kind == "workspace_document", patch=kind != "link")


@router.get("/projects/{pid}/workspace-documents/{item_id}/export")
def export_workspace_document(
    pid: str, item_id: str, request: Request, format: Literal["md", "txt", "docx", "pdf"] = "md"
):
    document = store_for(request).get(pid, "workspace_document", item_id)
    try:
        data, mime_type, extension = export_document(document, format)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    filename = safe_filename(document["title"]) + extension
    return Response(
        data,
        media_type=mime_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            "X-Content-Type-Options": "nosniff",
        },
    )
