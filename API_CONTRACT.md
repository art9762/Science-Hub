# Science Hub internal contract

Local FastAPI backend, React + TypeScript frontend. API prefix `/api`. JSON fields use snake_case. No authentication in initial single-user loopback-only mode. Reject foreign Origin mutation requests. Secrets stay in a gitignored `.env` / local settings, never returned in API. Lists return arrays for this local workspace.

## Storage Python interface (backend/storage.py)
`Store(data_dir: Path)` initializes SQLite and `data_dir/files`. `store.root` is data_dir. Methods: `projects() -> list[dict]`, `create_project(name, description='') -> dict`, `project(project_id) -> dict` (raise KeyError if missing), `update_project(project_id, changes) -> dict`, `delete_project(project_id)`, `list(project_id, kind) -> list[dict]`, `get(project_id, kind, item_id) -> dict`, `put(project_id, kind, data: dict) -> dict` (assign id, created_at, updated_at, project_id if missing; update existing), `delete(project_id, kind, item_id)`, `search(project_id, query, document_ids=None) -> list[dict]`. All lookups strictly project-scoped. Generic kinds: document, annotation, agent, message, run, event, workspace_document, decision, claim, board_item, link. Independent connection per operation and WAL. Raise KeyError for nonexistent/cross-project IDs. `put` replaces full supplied object; caller merges if patching.

Project: `{id,name,description,created_at,updated_at}`. Document: `{id,project_id,name,mime_type,category,size,status,pages:[{number,text}],text,description,file_path,created_at,updated_at}`. file_path is relative to root and must not be returned to client. Search result: `{document_id,document_name,page,text,source,annotation_id?}`.

## Core HTTP routes (backend/core.py, router, root injects request.app.state.store)
GET/POST `/projects` (body `{name,description?}`); GET/PATCH/DELETE `/projects/{pid}`.
GET `/projects/{pid}/state`: `{project,documents,agents,messages,runs,events,workspace_documents,decisions,claims,board_items,links}`. Document summaries omit pages/text/file_path. Seed eight agents when a project is created, with id/name/role/system_prompt/model/provider_id/color/tools/enabled. Role ids: engineer, analyst, researcher, critic, fact_checker, technologist, estimator, pessimist. State also includes annotations (all project annotations).
POST `/projects/{pid}/documents`: multipart `files` (multiple), optional `category`. Return array of document summaries. GET `/projects/{pid}/documents/{id}` returns full document without file_path. PATCH (name/category/description). DELETE. GET `/projects/{pid}/documents/{id}/file` serves original, HTML always download. POST `/projects/{pid}/documents/{id}/analyze` is AI agent's route.
GET `/projects/{pid}/search?q=...&document_ids=id1,id2` returns search array. Must search extracted page text, document descriptions/metadata and annotations.
GET `/projects/{pid}/documents/{id}/pages/{page}/image` returns a PNG rendering of the original PDF page (1-based, longest edge at most 1600px). Cross-project IDs and absent pages return 404; non-PDF documents return 422. The viewer does not require a browser PDF plugin.
GET/POST `/projects/{pid}/annotations`: `{document_id,page,start,end,quote,note,type}` with types important/ignore/verify/note. DELETE `/projects/{pid}/annotations/{id}`. Validate referenced document/pages.
GET/POST `/projects/{pid}/agents`, PATCH/DELETE `/projects/{pid}/agents/{id}`: all agent fields above.
GET/POST `/projects/{pid}/workspace-documents`, GET/PATCH/DELETE `/projects/{pid}/workspace-documents/{id}`: `{title,content,format:'markdown',source_run_id?}`. GET `/projects/{pid}/workspace-documents/{id}/export?format=md|txt|docx|pdf`.
GET/POST `/projects/{pid}/decisions`, PATCH/DELETE `/projects/{pid}/decisions/{id}`: `{title,description,status:'proposed|accepted|rejected',parent_id?,rationale,alternatives?:[{title,reason}],source_ids?:[],confidence?:number}`.
GET/POST `/projects/{pid}/claims`, PATCH/DELETE `/projects/{pid}/claims/{id}`: `{text,confidence,status:'unverified|supported|disputed',source_ids:[],reason}`. User confidence is not verified automatically.
GET/POST `/projects/{pid}/board-items`, PATCH/DELETE `/projects/{pid}/board-items/{id}`: `{type:'note|document|image|research',text,x,y,width,height,color,reference_id?}`.
GET/POST `/projects/{pid}/links`, DELETE `/projects/{pid}/links/{id}`: `{source,target,label}`.

## AI HTTP routes (backend/ai.py, router)
GET `/settings`: `{providers:[{id,name,base_url,has_key,models:[{id,name?}]}],default_provider_id,orchestrator_model,vision_model,max_rounds,max_tokens}`. Initially env `SCIENCE_HUB_API_KEY`, `SCIENCE_HUB_API_BASE_URL`, `SCIENCE_HUB_MODEL`; secrets never returned. PATCH `/settings` accepts same fields; provider api_key can be supplied/updated; omitted or empty key preserves existing. Models may be strings or `{id,name}` normalized to objects.
GET `/providers/{id}/models` fetches remote model list and saves it; returns array of `{id,name}`.
POST `/projects/{pid}/runs`: `{prompt,document_ids?:[],agent_ids?:[],model?:str,mode:'chat|team',max_rounds?:number}` returns run immediately; execute async background, no fake responses. Empty document_ids means entire KB. Empty agent_ids means all enabled available to coordinator. Agent ids constrain team. Errors visible as events/messages and run status. `run:{id,prompt,status:'queued|running|completed|failed|cancelled',mode,created_at,updated_at,result?,error?}`.
GET `/projects/{pid}/runs/{id}`. POST `/projects/{pid}/runs/{id}/cancel`. State polling every 1.5s drives live UI; events `{id,run_id,agent_id?,type,message,created_at}`; messages `{id,run_id,role:'user|assistant|agent|system',agent_id?,agent_name?,content,created_at,sources?:[]}`.
POST `/projects/{pid}/documents/{id}/analyze` uses configured vision model for image binary, persists description and returns document. Must not pretend OCR-only is image understanding. If key/model unavailable return clear error.
GET `/search/web?q=...&source=auto|arxiv|github|duckduckgo` returns `{title,url,snippet,source}[]` (pluggable read-only public sources). No arbitrary page execution.

## Module boundaries
- `storage.py`, `documents.py`, and `core.py`: persistence, document processing and project APIs.
- `ai.py`, `providers.py`, and `research.py`: orchestration, model protocols and external research.
- `frontend/`: Russian React/TypeScript interface with Lucide icons. Vite proxies `/api` to port 8765 during development; Python serves `frontend/dist` in a release.
- `app.py`: application lifecycle, local HTTP boundary, errors and static assets. `run.py`, `setup.py`, and `scripts/`: launch, installation and release packaging.

Exceptions: FastAPI HTTP errors converted at app boundary to `{error:{code,message}}`. Python KeyError -> 404. Validation -> 422. AI provider errors sanitized, no keys, no raw request headers. Local network binding only. Uploaded document text treated as untrusted data by AI.
