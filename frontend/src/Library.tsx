import React, { useEffect, useRef, useState } from "react";
import {
  Upload,
  Search,
  Plus,
  FileText,
  Image,
  FolderOpen,
  Folder,
  FolderPlus,
  FolderInput,
  ChevronRight,
  ChevronLeft,
  MoreHorizontal,
  Grid2X2,
  List,
  Trash2,
  Download,
  Pencil,
  Check,
  Bookmark,
  EyeOff,
  Flag,
  StickyNote,
  Sparkles,
  ExternalLink,
  Globe,
  ArrowUpRight,
  Loader2,
  Filter,
  X,
  FileCheck,
} from "lucide-react";
import { ScreenProps } from "./App";
import { api, bytes, date, Item, fileUrl, safeUrl } from "./api";
import {
  Button,
  DocIcon,
  Empty,
  Field,
  IconButton,
  Modal,
  SectionTitle,
  Tag,
} from "./ui";
import "./library.css";

export function LibraryScreen(props: ScreenProps & { globalQuery: string }) {
  const { pid, state, mutate, onError, openDocument } = props;
  const [query, setQuery] = useState(props.globalQuery),
    [category, setCategory] = useState("Все материалы"),
    [sort, setSort] = useState("newest"),
    [view, setView] = useState("grid"),
    [folderId, setFolderId] = useState<string | null>(null),
    [uploading, setUploading] = useState(false),
    [dropTarget, setDropTarget] = useState<string | null>(null),
    [dragged, setDragged] = useState<{ kind: "document" | "folder"; id: string } | null>(null),
    [results, setResults] = useState<any[] | null>(null),
    [searching, setSearching] = useState(false),
    [edit, setEdit] = useState<Item | null>(null),
    [remove, setRemove] = useState<Item | null>(null),
    [folderEdit, setFolderEdit] = useState<{ id?: string; name: string; parent_id: string | null } | null>(null),
    [folderRemove, setFolderRemove] = useState<Item | null>(null),
    [moveItem, setMoveItem] = useState<{ kind: "document" | "folder"; item: Item } | null>(null),
    [moveTarget, setMoveTarget] = useState(""),
    [saving, setSaving] = useState(false),
    [notice, setNotice] = useState(""),
    [tab, setTab] = useState("local"),
    [webResults, setWebResults] = useState<any[] | null>(null),
    [source, setSource] = useState("auto"),
    [webBusy, setWebBusy] = useState(false),
    [webSaved, setWebSaved] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const folders = state.folders || [];
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const currentFolder = folderId ? folderById.get(folderId) : null;
  const folderPath = (id: string | null): Item[] => {
    const path: Item[] = [];
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const folder = folderById.get(id);
      if (!folder) break;
      path.unshift(folder);
      id = folder.parent_id || null;
    }
    return path;
  };
  const orderedFolders = [...folders].sort((a, b) =>
    folderPath(a.id).map((f) => f.name).join(" / ").localeCompare(
      folderPath(b.id).map((f) => f.name).join(" / "), "ru",
    ),
  );
  const childFolders = folders
    .filter((f) => (f.parent_id || null) === folderId)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const categories = [
    "Все материалы",
    ...Array.from(new Set(state.documents.map((d) => d.category || "Без категории"))),
  ];
  const matchesCategory = (d: Item) => category === "Все материалы" || (d.category || "Без категории") === category;
  const docs = state.documents
    .filter((d) => (d.folder_id || null) === folderId && matchesCategory(d))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "ru")
      : sort === "oldest" ? String(a.created_at).localeCompare(b.created_at)
        : String(b.created_at).localeCompare(a.created_at));
  const searchResults = results?.filter((r) => {
    const doc = state.documents.find((d) => d.id === r.document_id);
    return doc && matchesCategory(doc);
  });
  const searchVersion = [...state.documents, ...(state.annotations || [])]
    .map((item) => `${item.id}:${item.updated_at || item.created_at || ""}`)
    .join("|");
  useEffect(() => setQuery(props.globalQuery), [props.globalQuery]);
  useEffect(() => {
    setFolderId(null);
    setCategory("Все материалы");
    setNotice("");
  }, [pid]);
  useEffect(() => {
    if (folderId && !folders.some((f) => f.id === folderId)) setFolderId(null);
  }, [folderId, folders]);
  useEffect(() => {
    if (!query.trim() || tab !== "local") {
      setResults(null);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() =>
      api(`/projects/${pid}/search?q=${encodeURIComponent(query)}`)
        .then((r) => { if (live) setResults(r); })
        .catch((e) => { if (live) onError(e); })
        .finally(() => { if (live) setSearching(false); }), 300);
    return () => { live = false; clearTimeout(timer); };
  }, [query, pid, tab, onError, searchVersion]);
  function navigateFolder(id: string | null) {
    setFolderId(id);
    setQuery("");
    setResults(null);
  }
  function newFolder() {
    setFolderEdit({ name: "", parent_id: folderId });
  }
  useEffect(() => {
    if (!categories.includes(category)) setCategory("Все материалы");
  }, [category, categories.join("\n")]);
  const targetKey = (id: string | null) => id || "root";
  function allowsMove(kind: "document" | "folder", id: string, target: string | null) {
    return kind !== "folder" || !folderPath(target).some((f) => f.id === id);
  }
  async function move(kind: "document" | "folder", id: string, target: string | null) {
    if (!allowsMove(kind, id, target)) return;
    await mutate(`/${kind === "folder" ? "folders" : "documents"}/${id}`,
      kind === "folder" ? { parent_id: target } : { folder_id: target }, "PATCH");
    setNotice(`Перемещено: ${target ? folderById.get(target)?.name || "папка" : "корень базы знаний"}`);
  }
  function startDrag(e: React.DragEvent, kind: "document" | "folder", id: string) {
    e.stopPropagation();
    e.dataTransfer.setData("application/science-item", JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = "move";
    setDragged({ kind, id });
  }
  function endDrag() {
    setDragged(null);
    setDropTarget(null);
  }
  function dropProps(target: string | null) {
    return {
      onDragEnter(e: React.DragEvent) {
        const supported = e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/science-item");
        if (!supported || (dragged && !allowsMove(dragged.kind, dragged.id, target))) return;
        e.preventDefault();
        e.stopPropagation();
        setDropTarget(targetKey(target));
      },
      onDragOver(e: React.DragEvent) {
        const internal = e.dataTransfer.types.includes("application/science-item");
        if (!e.dataTransfer.types.includes("Files") && !internal) return;
        e.stopPropagation();
        if (dragged && !allowsMove(dragged.kind, dragged.id, target)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = internal ? "move" : "copy";
        setDropTarget(targetKey(target));
      },
      onDragLeave(e: React.DragEvent) {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropTarget((value) => value === targetKey(target) ? null : value);
      },
      async onDrop(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        endDrag();
        if (e.dataTransfer.files.length) {
          await upload(e.dataTransfer.files, target);
          return;
        }
        try {
          const raw = e.dataTransfer.getData("application/science-item");
          if (!raw) return;
          const item = JSON.parse(raw);
          if ((item.kind === "document" || item.kind === "folder") && typeof item.id === "string")
            await move(item.kind, item.id, target);
        } catch {}
      },
    };
  }
  function openMove(kind: "document" | "folder", item: Item) {
    setMoveItem({ kind, item });
    setMoveTarget((kind === "folder" ? item.parent_id : item.folder_id) || "");
  }
  async function upload(files: FileList | File[] | null, target = folderId) {
    if (!files?.length) return;
    setUploading(true);
    const data = new FormData();
    Array.from(files).forEach((f) => data.append("files", f));
    if (category !== "Все материалы") data.append("category", category);
    if (target) data.append("folder_id", target);
    try {
      await mutate("/documents", data);
      setNotice(`Файлы добавлены: ${target ? folderById.get(target)?.name || "папка" : "корень базы знаний"}`);
    } catch {} finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function searchWeb(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setWebBusy(true);
    try {
      setWebResults(await api(`/search/web?q=${encodeURIComponent(query)}&source=${source}`));
    } catch (e) { onError(e); } finally { setWebBusy(false); }
  }
  return (
    <div className="library-workspace">
      <SectionTitle
        title="База знаний"
        description={`${state.documents.length} материалов · ${folders.length} папок`}
        action={<div className="library-create-actions">
          <Button variant="secondary" onClick={newFolder}><FolderPlus size={17} />Новая папка</Button>
          <Button onClick={() => input.current?.click()} busy={uploading}><Plus size={17} />Добавить файлы</Button>
        </div>}
      />
      <input type="file" ref={input} multiple hidden onChange={(e) => upload(e.target.files)}
        accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,.xml,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp" />
      <div className="library-tabs">
        <button className={tab === "local" ? "active" : ""} onClick={() => setTab("local")}>
          <FolderOpen size={17} />Файлы проекта<span>{state.documents.length}</span>
        </button>
        <button className={tab === "web" ? "active" : ""} onClick={() => setTab("web")}>
          <Globe size={17} />Поиск в интернете<ArrowUpRight size={14} />
        </button>
      </div>
      <div className="library-toolbar">
        <form className="search-box" onSubmit={tab === "web" ? searchWeb : (e) => e.preventDefault()}>
          <Search size={19} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "local" ? "Поиск по всем файлам и аннотациям…" : "Статьи, документация, репозитории…"}
            aria-label="Поиск материалов" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={16} /></button>}
          {tab === "web" && <Button busy={webBusy} disabled={!query.trim()}>Найти</Button>}
        </form>
        {tab === "local" ? <>
          {categories.length > 1 && <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Фильтр по категории">
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
            <option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По названию</option>
          </select>
          <div className="segmented compact" aria-label="Вид файлов">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="Карточки" aria-pressed={view === "grid"}><Grid2X2 size={18} /></button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="Список" aria-pressed={view === "list"}><List size={18} /></button>
          </div>
        </> : <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Источник поиска">
          <option value="auto">Автовыбор источника</option><option value="arxiv">arXiv</option><option value="github">GitHub</option><option value="duckduckgo">DuckDuckGo</option>
        </select>}
      </div>
      {tab === "web" ? (
        <div className="web-results">
          {webResults === null ? (
            <Empty icon={Globe} title="Расширьте границы исследования">
              Найдите публикации и открытые проекты. Сохраняйте полезные ссылки
              на доску проекта.
            </Empty>
          ) : !webResults.length ? (
            <Empty icon={Search} title="Источники не найдены">
              Уточните запрос или выберите другой источник поиска.
            </Empty>
          ) : (
            webResults.map((r, i) => (
              <article className="web-result panel" key={i}>
                <Tag>{r.source}</Tag>
                <a href={safeUrl(r.url)} target="_blank" rel="noreferrer">
                  <h3>
                    {r.title}
                    <ArrowUpRight size={17} />
                  </h3>
                </a>
                <p>{r.snippet}</p>
                <div>
                  <small>{r.url}</small>
                  <Button
                    variant="secondary small"
                    disabled={webSaved.includes(r.url)}
                    onClick={async () => {
                      try {
                        await mutate("/board-items", {
                          type: "research",
                          text: `${r.title}\n${r.snippet}\n${r.url}`,
                          x: 60 + (webSaved.length % 3) * 280,
                          y: 60 + Math.floor(webSaved.length / 3) * 220,
                          width: 260,
                          height: 200,
                          color: "#e4ece6",
                        });
                        setWebSaved([...webSaved, r.url]);
                      } catch {}
                    }}
                  >
                    {webSaved.includes(r.url) ? (
                      <Check size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    На доску
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className={`knowledge-body ${dragged ? "is-moving" : ""}`}>
          <aside className="folder-sidebar" aria-label="Папки базы знаний">
            <div className="folder-sidebar-heading"><strong>Папки</strong><IconButton title="Создать папку" aria-label="Создать папку" onClick={newFolder}><FolderPlus size={18} /></IconButton></div>
            <button className={`folder-nav ${folderId === null ? "active" : ""} ${dropTarget === "root" ? "drop-active" : ""}`}
              onClick={() => navigateFolder(null)} {...dropProps(null)} aria-current={folderId === null ? "location" : undefined}>
              <FolderOpen size={18} /><span>Корень базы</span><small>{state.documents.filter((d) => !d.folder_id).length}</small>
            </button>
            <div className="folder-tree">
              {orderedFolders.map((f) => <button key={f.id}
                className={`folder-nav ${folderId === f.id ? "active" : ""} ${dropTarget === f.id ? "drop-active" : ""}`}
                style={{ paddingLeft: 12 + Math.min(folderPath(f.id).length - 1, 5) * 14 }}
                title={folderPath(f.id).map((p) => p.name).join(" / ")}
                onClick={() => navigateFolder(f.id)} draggable onDragStart={(e) => startDrag(e, "folder", f.id)} onDragEnd={endDrag}
                {...dropProps(f.id)} aria-current={folderId === f.id ? "location" : undefined}>
                <Folder size={17} /><span>{f.name}</span><small>{state.documents.filter((d) => d.folder_id === f.id).length}</small>
              </button>)}
            </div>
            {!folders.length && <p className="folder-help">Создайте папки для тем, источников или этапов исследования.</p>}
            <p className="folder-help">Перетащите файл или папку в нужную папку. Кнопка <FolderInput size={14} aria-hidden="true" /> открывает выбор места.</p>
            <div className="folder-storage"><FileCheck size={16} /><span>{bytes(state.documents.reduce((n, d) => n + (d.size || 0), 0))} · локально</span></div>
          </aside>
          <section className={`file-pool ${dropTarget === targetKey(folderId) ? "drop-active" : ""}`} {...dropProps(folderId)} aria-label="Файлы и папки">
            <nav className="folder-breadcrumbs" aria-label="Путь к папке">
              <button onClick={() => navigateFolder(null)} {...dropProps(null)}>База знаний</button>
              {folderPath(folderId).map((f) => <React.Fragment key={f.id}><ChevronRight size={15} />
                <button onClick={() => navigateFolder(f.id)} {...dropProps(f.id)} aria-current={f.id === folderId ? "location" : undefined}>{f.name}</button>
              </React.Fragment>)}
            </nav>
            <div className="pool-heading">
              <div><h2>{query.trim() ? "Результаты поиска" : currentFolder?.name || "Файлы и папки"}</h2>
                <p>{query.trim() ? "По всем папкам проекта" : `${childFolders.length} папок · ${docs.length} файлов${category !== "Все материалы" ? ` · ${category}` : ""}`}</p>
              </div>
              {currentFolder && <div className="folder-actions">
                <IconButton title="Переместить папку" aria-label={`Переместить папку ${currentFolder.name}`} onClick={() => openMove("folder", currentFolder)}><FolderInput size={18} /></IconButton>
                <IconButton title="Переименовать папку" aria-label={`Переименовать папку ${currentFolder.name}`} onClick={() => setFolderEdit({ id: currentFolder.id, name: currentFolder.name, parent_id: currentFolder.parent_id || null })}><Pencil size={17} /></IconButton>
                <IconButton title="Удалить папку" aria-label={`Удалить папку ${currentFolder.name}`} onClick={() => setFolderRemove(currentFolder)}><Trash2 size={17} /></IconButton>
              </div>}
            </div>
            {notice && <p className="library-notice" role="status"><Check size={15} />{notice}<button onClick={() => setNotice("")} aria-label="Скрыть уведомление"><X size={14} /></button></p>}
            {uploading && <div className="upload-progress" role="status"><Loader2 size={17} className="spin" />Загружаем и извлекаем содержимое файлов…</div>}
            {query.trim() ? <>
              <div className="result-count" role="status">{searching || results === null ? "Ищем…" : `Найдено фрагментов: ${searchResults?.length || 0}`}</div>
              {searchResults?.map((r, i) => <button className="search-result" key={i}
                onClick={() => openDocument(r.document_id, r.page || 1, r.quote || r.text || "",
                  ["text", "annotation"].includes(r.source) ? r.start : undefined,
                  ["text", "annotation"].includes(r.source) ? r.end : undefined)}>
                <div><FileText size={18} /><strong>{r.document_name}</strong><Tag>Страница {r.page || 1}</Tag>{r.source === "annotation" && <Tag tone="orange">Аннотация</Tag>}</div>
                <p>{r.text}</p><span>Открыть фрагмент<ArrowUpRight size={14} /></span>
              </button>)}
              {!searching && searchResults?.length === 0 && <Empty icon={Search} title="Совпадений нет">Попробуйте другой запрос или уберите фильтр категории.</Empty>}
            </> : <>
              {childFolders.length > 0 && <div className="folder-pool">
                {childFolders.map((f) => <article key={f.id} className={`folder-card ${dropTarget === f.id ? "drop-active" : ""}`}
                  draggable onDragStart={(e) => startDrag(e, "folder", f.id)} onDragEnd={endDrag} {...dropProps(f.id)}>
                  <button className="folder-card-open" onClick={() => navigateFolder(f.id)}><Folder size={31} strokeWidth={1.5} /><span><strong>{f.name}</strong>
                    <small>{folders.filter((child) => child.parent_id === f.id).length} папок · {state.documents.filter((d) => d.folder_id === f.id).length} файлов</small></span><ChevronRight size={17} /></button>
                  <div className="folder-actions">
                    <IconButton title="Переместить" aria-label={`Переместить папку ${f.name}`} onClick={() => openMove("folder", f)}><FolderInput size={17} /></IconButton>
                    <IconButton title="Переименовать" aria-label={`Переименовать папку ${f.name}`} onClick={() => setFolderEdit({ id: f.id, name: f.name, parent_id: f.parent_id || null })}><Pencil size={16} /></IconButton>
                    <IconButton title="Удалить папку" aria-label={`Удалить папку ${f.name}`} onClick={() => setFolderRemove(f)}><Trash2 size={16} /></IconButton>
                  </div>
                </article>)}
              </div>}
              {docs.length > 0 && <div className={`document-list ${view === "grid" ? "document-grid" : ""}`}>
                {view === "list" && <div className="document-table-head"><span>МАТЕРИАЛ</span><span>КАТЕГОРИЯ</span><span>ДОБАВЛЕН</span><span /></div>}
                {docs.map((d) => <article className="document-row" key={d.id} draggable onDragStart={(e) => startDrag(e, "document", d.id)} onDragEnd={endDrag}>
                  <button className="document-main" draggable onDragStart={(e) => startDrag(e, "document", d.id)} onClick={() => openDocument(d.id)}><DocIcon mime={d.mime_type} name={d.name} /><span><strong title={d.name}>{d.name}</strong>
                    <small>{bytes(d.size || 0)} · {d.page_count ? `${d.page_count} стр.` : d.mime_type?.startsWith("image/") ? "Изображение" : "Документ"}
                      {d.status && d.status !== "ready" ? ` · ${({ processed: "Обработан", uploaded: "Загружен", error: "Ошибка", needs_ocr: "Нужен OCR", unsupported: "Без извлечения текста" } as any)[d.status] || d.status}` : ""}</small>
                  </span></button>
                  <Tag>{d.category || "Без категории"}</Tag><time>{date(d.created_at)}</time>
                  <div className="document-actions">
                    <IconButton title="Переместить" aria-label={`Переместить ${d.name}`} onClick={() => openMove("document", d)}><FolderInput size={17} /></IconButton>
                    <IconButton title="Свойства материала" aria-label={`Свойства ${d.name}`} onClick={() => setEdit({ ...d })}><Pencil size={16} /></IconButton>
                    <IconButton title="Удалить" aria-label={`Удалить ${d.name}`} onClick={() => setRemove(d)}><Trash2 size={16} /></IconButton>
                  </div>
                </article>)}
              </div>}
              {!docs.length && !childFolders.length && <div className="pool-empty"><Upload size={34} strokeWidth={1.4} />
                <h3>{category !== "Все материалы" ? "Нет файлов этой категории" : "В этой папке пока нет файлов"}</h3>
                <p>{category !== "Все материалы" ? "Выберите другую категорию или добавьте материалы." : "Перетащите файлы сюда или выберите их на устройстве."}</p>
                <Button variant="secondary" busy={uploading} onClick={() => input.current?.click()}><Plus size={17} />Добавить файлы</Button>
              </div>}
              {(docs.length > 0 || childFolders.length > 0) && <button className="drop-hint" onClick={() => input.current?.click()}><Upload size={18} /><span>Перетащите файлы сюда или <strong>выберите на устройстве</strong></span></button>}
            </>}
            <div className="pool-drop-label" hidden={dropTarget === null} aria-hidden="true"><FolderInput size={18} />{dragged ? "Переместить в " : "Добавить файлы в "}{dropTarget && dropTarget !== "root" ? `«${folderById.get(dropTarget)?.name || "папку"}»` : "корень базы знаний"}</div>
          </section>
        </div>
      )}
      {folderEdit && <Modal title={folderEdit.id ? "Переименовать папку" : "Новая папка"} subtitle={`В папке: ${folderEdit.parent_id ? folderById.get(folderEdit.parent_id)?.name : "Корень базы знаний"}`} onClose={() => setFolderEdit(null)}>
        <form onSubmit={async (e) => { e.preventDefault(); if (!folderEdit.name.trim()) return; setSaving(true);
          try { await mutate(folderEdit.id ? `/folders/${folderEdit.id}` : "/folders", { name: folderEdit.name.trim(), ...(folderEdit.id ? {} : { parent_id: folderEdit.parent_id }) }, folderEdit.id ? "PATCH" : "POST"); setFolderEdit(null); } catch {} finally { setSaving(false); }
        }}><Field label="Название папки"><input required maxLength={200} value={folderEdit.name} onChange={(e) => setFolderEdit({ ...folderEdit, name: e.target.value })} placeholder="Например, Статьи по теме" /></Field>
          <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setFolderEdit(null)}>Отмена</Button><Button busy={saving} disabled={!folderEdit.name.trim()}>{folderEdit.id ? "Сохранить" : "Создать папку"}</Button></div>
        </form>
      </Modal>}
      {folderRemove && <Modal title="Удалить папку?" onClose={() => setFolderRemove(null)}><p className="modal-copy">Папка «{folderRemove.name}» будет удалена. Её файлы и вложенные папки сохранятся и переместятся на уровень выше.</p>
        <div className="modal-actions"><Button variant="secondary" onClick={() => setFolderRemove(null)}>Отмена</Button><Button variant="danger" busy={saving} onClick={async () => { setSaving(true); try {
          const parent = folderRemove.parent_id || null;
          await mutate(`/folders/${folderRemove.id}`, undefined, "DELETE");
          if (folderId === folderRemove.id) setFolderId(parent);
          setFolderRemove(null);
        } catch {} finally { setSaving(false); } }}>Удалить папку</Button></div>
      </Modal>}
      {moveItem && <Modal title={moveItem.kind === "folder" ? "Переместить папку" : "Переместить файл"} subtitle={moveItem.item.name} onClose={() => setMoveItem(null)}>
        <form onSubmit={async (e) => { e.preventDefault(); setSaving(true); try { await move(moveItem.kind, moveItem.item.id, moveTarget || null); setMoveItem(null); } catch {} finally { setSaving(false); } }}>
          <Field label="Куда переместить"><select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}><option value="">Корень базы знаний</option>
            {orderedFolders.filter((f) => allowsMove(moveItem.kind, moveItem.item.id, f.id)).map((f) => <option key={f.id} value={f.id}>{folderPath(f.id).map((p) => p.name).join(" / ")}</option>)}
          </select></Field><div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setMoveItem(null)}>Отмена</Button><Button busy={saving} disabled={moveTarget === ((moveItem.kind === "folder" ? moveItem.item.parent_id : moveItem.item.folder_id) || "")}>Переместить</Button></div>
        </form>
      </Modal>}
      {edit && <Modal title="Свойства материала" onClose={() => setEdit(null)}><form onSubmit={async (e) => { e.preventDefault(); setSaving(true); try {
        await mutate(`/documents/${edit.id}`, { name: edit.name, category: edit.category, description: edit.description }, "PATCH"); setEdit(null);
      } catch {} finally { setSaving(false); } }}>
        <Field label="Название"><input required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Категория"><input list="categories" placeholder="Без категории" value={edit.category || ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /><datalist id="categories">{categories.slice(1).map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Описание"><textarea rows={5} value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
        <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Отмена</Button><Button busy={saving}>Сохранить</Button></div>
      </form></Modal>}
      {remove && <Modal title="Удалить материал?" onClose={() => setRemove(null)}><p className="modal-copy">«{remove.name}» и его аннотации будут удалены из проекта. Исходный файл на вашем устройстве останется на месте.</p>
        <div className="modal-actions"><Button variant="secondary" onClick={() => setRemove(null)}>Отмена</Button><Button variant="danger" busy={saving} onClick={async () => { setSaving(true); try { await mutate(`/documents/${remove.id}`, undefined, "DELETE"); setRemove(null); } catch {} finally { setSaving(false); } }}>Удалить материал</Button></div>
      </Modal>}
    </div>
  );
}
const annotationKinds = [
  { id: "important", label: "Важно", icon: Bookmark },
  { id: "ignore", label: "Игнорировать", icon: EyeOff },
  { id: "verify", label: "Перепроверить", icon: Flag },
  { id: "note", label: "Заметка", icon: StickyNote },
];
function PdfPagePreview({
  pid,
  documentId,
  page,
  name,
}: {
  pid: string;
  documentId: string;
  page: number;
  name: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
      "loading",
    ),
    [attempt, setAttempt] = useState(0);
  const src = `/api/projects/${encodeURIComponent(pid)}/documents/${encodeURIComponent(documentId)}/pages/${page}/image${attempt ? `?retry=${attempt}` : ""}`;
  return (
    <div className="pdf-page-preview" aria-busy={status === "loading"}>
      {status === "loading" && (
        <div className="pdf-page-loading" role="status">
          <Loader2 className="spin" size={25} />
          <p>Открываем страницу {page}…</p>
        </div>
      )}
      {status !== "error" && (
        <img
          key={src}
          className="original-pdf-page"
          src={src}
          alt={`Страница ${page} документа «${name}»`}
          decoding="async"
          style={status === "loaded" ? undefined : { display: "none" }}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
        />
      )}
      {status === "loaded" && (
        <p className="pdf-page-caption">Оригинал PDF · страница {page}</p>
      )}
      {status === "error" && (
        <div role="status">
          <Empty
            icon={FileText}
            title="Не удалось показать эту страницу"
            action={
              <div className="pdf-page-fallback">
                <Button
                  variant="secondary small"
                  onClick={() => {
                    setStatus("loading");
                    setAttempt((n) => n + 1);
                  }}
                >
                  Повторить загрузку
                </Button>
                <a
                  className="button secondary small"
                  href={fileUrl(pid, documentId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={14} />
                  Открыть исходный PDF
                </a>
              </div>
            }
          >
            Можно повторить загрузку, открыть исходный PDF или перейти на
            вкладку «Текст и аннотации».
          </Empty>
        </div>
      )}
    </div>
  );
}
export function DocumentViewer({
  target,
  onClose,
  ...props
}: ScreenProps & {
  target: {
    id: string;
    page: number;
    quote: string;
    start?: number;
    end?: number;
  };
  onClose: () => void;
}) {
  const { pid, state, mutate, onError } = props;
  const [doc, setDoc] = useState<Item | null>(null),
    [page, setPage] = useState(target.page),
    [tab, setTab] = useState("text"),
    [selection, setSelection] = useState<{
      start: number;
      end: number;
      quote: string;
    } | null>(null),
    [note, setNote] = useState(""),
    [kind, setKind] = useState("important"),
    [active, setActive] = useState(""),
    [analyzing, setAnalyzing] = useState(false),
    [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLDivElement>(null),
    scrollRef = useRef<HTMLDivElement>(null);
  const docVersion = state.documents.find(
    (d) => d.id === target.id,
  )?.updated_at;
  useEffect(() => {
    if (!doc) return;
    let live = true;
    api<Item>(`/projects/${pid}/documents/${target.id}`)
      .then((r) => {
        if (live) setDoc(r);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [pid, target.id, docVersion, onError]);
  useEffect(() => {
    let live = true;
    api<Item>(`/projects/${pid}/documents/${target.id}`)
      .then((r) => {
        if (live) {
          setDoc(r);
          setPage(target.page);
          setTab(
            r.mime_type?.startsWith("image/") && !target.quote
              ? "original"
              : "text",
          );
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [pid, target.id, target.page, onError]);
  const pages = doc?.pages || [];
  const pageText = pages.find((p: any) => p.number === page)?.text || "";
  const annotations = (state.annotations || []).filter(
    (a) => a.document_id === target.id,
  );
  const pageAnnotations = annotations.filter((a) => a.page === page);
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => {
      const mark = textRef.current?.querySelector('[data-search="true"]');
      if (mark) mark.scrollIntoView({ block: "center", behavior: "smooth" });
      else scrollRef.current?.scrollTo({ top: 0 });
    }, 80);
    return () => clearTimeout(timer);
  }, [doc?.id, page, target.quote]);
  function captureSelection() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !textRef.current || !s.rangeCount) return;
    const range = s.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) return;
    const before = range.cloneRange();
    before.selectNodeContents(textRef.current);
    before.setEnd(range.startContainer, range.startOffset);
    setSelection({
      start: Array.from(before.toString()).length,
      end:
        Array.from(before.toString()).length +
        Array.from(range.toString()).length,
      quote: range.toString(),
    });
    setNote("");
    setActive("");
  }
  async function annotate(e: React.FormEvent) {
    e.preventDefault();
    if (!selection) return;
    setSaving(true);
    try {
      await mutate("/annotations", {
        document_id: target.id,
        page,
        ...selection,
        note,
        type: kind,
      });
      setSelection(null);
      setNote("");
      window.getSelection()?.removeAllRanges();
    } catch {
    } finally {
      setSaving(false);
    }
  }
  function gotoAnnotation(a: Item) {
    setTab("text");
    setPage(a.page);
    setActive(a.id);
    setTimeout(
      () =>
        textRef.current
          ?.querySelector(`[data-annotation="${CSS.escape(a.id)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      100,
    );
  }
  function highlighted() {
    const characters = Array.from(pageText),
      length = characters.length;
    const slice = (start: number, end: number) =>
      characters.slice(start, end).join("");
    const pointIndex = (value: string) => {
      const index = pageText.indexOf(value);
      return index < 0 ? -1 : Array.from(pageText.slice(0, index)).length;
    };
    const boundaries = new Set([0, length]);
    const valid: Item[] = pageAnnotations
      .map((a) => {
        let start = a.start,
          end = a.end;
        if (slice(start, end) !== a.quote && a.quote) {
          start = pointIndex(a.quote);
          end = start + Array.from(a.quote).length;
        }
        return { ...a, start, end };
      })
      .filter((a) => a.start >= 0 && a.end > a.start && a.end <= length);
    valid.forEach((a) => {
      boundaries.add(a.start);
      boundaries.add(a.end);
    });
    const q = target.quote.trim();
    let qs =
        typeof target.start === "number" && page === target.page
          ? target.start
          : q
            ? pointIndex(q)
            : -1,
      qe =
        typeof target.end === "number" && page === target.page
          ? target.end
          : qs + Array.from(q).length;
    if (qs < 0 && q) {
      const index = pageText.toLowerCase().indexOf(q.toLowerCase());
      if (index >= 0) {
        qs = Array.from(pageText.slice(0, index)).length;
        qe = qs + Array.from(q).length;
      }
    }
    if (qs >= 0 && qe <= length && qe > qs) {
      boundaries.add(qs);
      boundaries.add(qe);
    } else {
      qs = -1;
      qe = -1;
    }
    const sorted = [...boundaries].sort((a, b) => a - b);
    return sorted.slice(0, -1).map((start, i) => {
      const end = sorted[i + 1],
        covering = valid.filter((a) => a.start <= start && a.end >= end),
        a = covering.find((a) => a.id === active) || covering[0],
        search = qs >= 0 && start >= qs && end <= qe;
      return (
        <span
          key={start}
          data-annotation={a?.id}
          data-search={search ? "true" : undefined}
          className={`${a ? `annotation-highlight annotation-${a.type} ${active === a.id ? "active" : ""}` : ""} ${search ? "search-highlight" : ""}`}
          onClick={a ? () => setActive(a.id) : undefined}
          title={a?.note || a?.quote}
        >
          {slice(start, end)}
        </span>
      );
    });
  }
  return (
    <Modal
      title={doc?.name || "Открываем материал…"}
      subtitle={
        doc
          ? `${doc.category || "Без категории"} · ${bytes(doc.size || 0)}`
          : undefined
      }
      onClose={onClose}
      wide
    >
      <div className="viewer-toolbar">
        <div className="segmented">
          <button
            className={tab === "text" ? "active" : ""}
            onClick={() => setTab("text")}
          >
            <FileText size={15} />
            Текст и аннотации
          </button>
          <button
            className={tab === "original" ? "active" : ""}
            onClick={() => setTab("original")}
          >
            <Image size={15} />
            Оригинал
          </button>
        </div>
        <a
          className="button secondary small"
          href={fileUrl(pid, target.id)}
          target="_blank"
          rel="noreferrer"
        >
          <Download size={14} />
          Открыть файл
        </a>
      </div>
      {doc &&
        (doc.warnings?.length > 0 ||
          doc.vision_error ||
          doc.vision_status === "pending_settings") && (
          <div
            className="document-notices"
            role="status"
            style={{
              padding: "10px 16px",
              fontSize: 12,
              color: "#8a592c",
              background: "#fff6e7",
            }}
          >
            {(doc.warnings || []).map((warning: string, i: number) => (
              <div key={i}>{warning}</div>
            ))}
            {doc.vision_error && <div>{doc.vision_error}</div>}
            {doc.vision_status === "pending_settings" && (
              <div>
                Для автоматического описания изображения выберите
                мультимодальную модель в настройках.
              </div>
            )}
          </div>
        )}
      <div className="viewer-layout">
        <div className="viewer-main">
          <div className="viewer-page" ref={scrollRef}>
            {!doc ? (
              <div className="loading-page">
                <Loader2 className="spin" />
              </div>
            ) : tab === "original" ? (
              doc.mime_type?.startsWith("image/") ? (
                <>
                  <img
                    className="original-image"
                    src={fileUrl(pid, target.id)}
                    alt={doc.description || doc.name}
                  />
                  <div className="image-description">
                    <div>
                      <h3>
                        Визуальный анализ
                        {["queued", "analyzing"].includes(
                          doc.vision_status,
                        ) && <small> · Анализируется…</small>}
                      </h3>
                      <Button
                        variant="secondary small"
                        busy={
                          analyzing ||
                          ["queued", "analyzing"].includes(doc.vision_status)
                        }
                        onClick={async () => {
                          setAnalyzing(true);
                          try {
                            const updated = await mutate(
                              `/documents/${target.id}/analyze`,
                              {},
                            );
                            setDoc(updated);
                          } catch {
                          } finally {
                            setAnalyzing(false);
                          }
                        }}
                      >
                        <Sparkles size={14} />
                        {doc.description
                          ? "Повторить анализ"
                          : "Описать изображение"}
                      </Button>
                    </div>
                    <p>
                      {doc.description ||
                        "Мультимодальная модель проанализирует объекты и сцену. Описание станет частью поиска и контекста проекта."}
                    </p>
                  </div>
                </>
              ) : doc.mime_type === "application/pdf" ? (
                <PdfPagePreview
                  key={`${pid}:${target.id}:${page}`}
                  pid={pid}
                  documentId={target.id}
                  page={page}
                  name={doc.name}
                />
              ) : (
                <Empty
                  icon={FileText}
                  title="Оригинал доступен в отдельном файле"
                  action={
                    <a
                      className="button secondary"
                      href={fileUrl(pid, target.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download size={15} />
                      Открыть оригинал
                    </a>
                  }
                >
                  Извлечённое содержимое можно читать и аннотировать на вкладке
                  «Текст».
                </Empty>
              )
            ) : pageText ? (
              <>
                <div className="page-paper-header">
                  <span>ИСТОЧНИК / {page.toString().padStart(2, "0")}</span>
                  <span>Выделите фрагмент, чтобы добавить аннотацию</span>
                </div>
                <div
                  className="document-text"
                  ref={textRef}
                  onMouseUp={captureSelection}
                  onTouchEnd={captureSelection}
                >
                  {highlighted()}
                </div>
              </>
            ) : (
              <Empty
                icon={FileText}
                title="На этой странице нет извлечённого текста"
              >
                Для изображений используйте визуальный анализ. Для
                сканированного PDF может понадобиться OCR на устройстве.
              </Empty>
            )}
          </div>
          {pages.length > 0 && (
            <div className="page-pagination">
              <IconButton
                disabled={page <= pages[0].number}
                onClick={() => {
                  setPage(
                    pages[
                      Math.max(
                        0,
                        pages.findIndex((p: any) => p.number === page) - 1,
                      )
                    ].number,
                  );
                  setSelection(null);
                }}
                aria-label="Предыдущая страница"
              >
                <ChevronLeft size={17} />
              </IconButton>
              <span>
                Страница{" "}
                <select
                  aria-label="Страница документа"
                  value={page}
                  onChange={(e) => {
                    setPage(Number(e.target.value));
                    setSelection(null);
                  }}
                >
                  {pages.map((p: any) => (
                    <option value={p.number} key={p.number}>
                      {p.number}
                    </option>
                  ))}
                </select>{" "}
                из {pages.length}
              </span>
              <IconButton
                disabled={page >= pages[pages.length - 1].number}
                onClick={() => {
                  setPage(
                    pages[
                      Math.min(
                        pages.length - 1,
                        pages.findIndex((p: any) => p.number === page) + 1,
                      )
                    ].number,
                  );
                  setSelection(null);
                }}
                aria-label="Следующая страница"
              >
                <ChevronRight size={17} />
              </IconButton>
            </div>
          )}
        </div>
        <aside className="annotation-sidebar">
          <h3>
            Аннотации <span>{annotations.length}</span>
          </h3>
          {selection && (
            <form className="annotation-form" onSubmit={annotate}>
              <div className="annotation-form-heading">
                <strong>Новая аннотация</strong>
                <IconButton
                  onClick={() => setSelection(null)}
                  type="button"
                  aria-label="Отменить выделение"
                >
                  <X size={14} />
                </IconButton>
              </div>
              <blockquote>{selection.quote.slice(0, 220)}</blockquote>
              <div className="annotation-kinds">
                {annotationKinds.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className={`annotation-${k.id} ${kind === k.id ? "selected" : ""}`}
                    onClick={() => setKind(k.id)}
                  >
                    <k.icon size={13} />
                    {k.label}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ваша заметка (необязательно)"
                rows={3}
              />
              <Button busy={saving} className="full-width" variant="small">
                Сохранить аннотацию
              </Button>
            </form>
          )}
          {annotations.map((a) => (
            <article
              className={`annotation-card annotation-${a.type} ${active === a.id ? "active" : ""}`}
              key={a.id}
            >
              <button
                className="annotation-content"
                onClick={() => gotoAnnotation(a)}
              >
                <div>
                  <strong>
                    {annotationKinds.find((k) => k.id === a.type)?.label ||
                      a.type}
                  </strong>
                  <span>стр. {a.page}</span>
                </div>
                <blockquote>{a.quote}</blockquote>
                {a.note && <p>{a.note}</p>}
              </button>
              <IconButton
                title="Удалить аннотацию"
                aria-label="Удалить аннотацию"
                onClick={() =>
                  mutate(`/annotations/${a.id}`, undefined, "DELETE").catch(
                    () => {},
                  )
                }
              >
                <Trash2 size={13} />
              </IconButton>
            </article>
          ))}
          {!annotations.length && !selection && (
            <div className="annotation-empty">
              <Bookmark size={24} strokeWidth={1.4} />
              <p>Замечайте важное</p>
              <small>
                Выделите текст в документе, чтобы сохранить мысль, отметить факт
                или вопрос для проверки.
              </small>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}
