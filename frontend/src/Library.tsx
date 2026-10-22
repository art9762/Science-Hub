import React, { useEffect, useRef, useState } from "react";
import {
  Upload,
  Search,
  Plus,
  FileText,
  Image,
  FolderOpen,
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
export function LibraryScreen(props: ScreenProps & { globalQuery: string }) {
  const { pid, state, mutate, onError, openDocument } = props;
  const [query, setQuery] = useState(props.globalQuery),
    [category, setCategory] = useState("Все материалы"),
    [sort, setSort] = useState("newest"),
    [view, setView] = useState("list"),
    [uploading, setUploading] = useState(false),
    [drag, setDrag] = useState(false),
    [results, setResults] = useState<any[] | null>(null),
    [searching, setSearching] = useState(false),
    [edit, setEdit] = useState<Item | null>(null),
    [remove, setRemove] = useState<Item | null>(null),
    [tab, setTab] = useState("local"),
    [webResults, setWebResults] = useState<any[] | null>(null),
    [source, setSource] = useState("auto"),
    [webBusy, setWebBusy] = useState(false),
    [webSaved, setWebSaved] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setQuery(props.globalQuery), [props.globalQuery]);
  useEffect(() => {
    if (!query.trim() || tab !== "local") {
      setResults(null);
      setSearching(false);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(
      () =>
        api(`/projects/${pid}/search?q=${encodeURIComponent(query)}`)
          .then((r) => {
            if (live) setResults(r);
          })
          .catch((e) => {
            if (live) onError(e);
          })
          .finally(() => {
            if (live) setSearching(false);
          }),
      300,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    query,
    pid,
    tab,
    onError,
    state.documents.length,
    state.annotations?.length,
  ]);
  const categories = [
    "Все материалы",
    ...Array.from(
      new Set(state.documents.map((d) => d.category || "Без категории")),
    ),
  ];
  const docs = state.documents
    .filter(
      (d) =>
        category === "Все материалы" ||
        (d.category || "Без категории") === category,
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "oldest"
          ? String(a.created_at).localeCompare(b.created_at)
          : String(b.created_at).localeCompare(a.created_at),
    );
  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return;
    setUploading(true);
    const data = new FormData();
    Array.from(files).forEach((f) => data.append("files", f));
    if (category !== "Все материалы") data.append("category", category);
    try {
      await mutate("/documents", data);
    } catch {
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  async function searchWeb(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setWebBusy(true);
    try {
      setWebResults(
        await api(
          `/search/web?q=${encodeURIComponent(query)}&source=${source}`,
        ),
      );
    } catch (e) {
      onError(e);
    } finally {
      setWebBusy(false);
    }
  }
  return (
    <>
      <SectionTitle
        eyebrow="ИСТОЧНИКИ И КОНТЕКСТ"
        title="База знаний"
        description="Все материалы проекта, связанные одним исследованием."
        action={
          <Button onClick={() => input.current?.click()} busy={uploading}>
            <Plus size={17} />
            Добавить материалы
          </Button>
        }
      />
      <input
        type="file"
        ref={input}
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
        accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv,.json,.xml,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.bmp"
      />
      <div className="library-tabs">
        <button
          className={tab === "local" ? "active" : ""}
          onClick={() => setTab("local")}
        >
          <FolderOpen size={16} />
          Материалы проекта<span>{state.documents.length}</span>
        </button>
        <button
          className={tab === "web" ? "active" : ""}
          onClick={() => setTab("web")}
        >
          <Globe size={16} />
          Поиск в интернете
          <ArrowUpRight size={13} />
        </button>
      </div>
      <div className="library-toolbar">
        <form
          className="search-box"
          onSubmit={tab === "web" ? searchWeb : (e) => e.preventDefault()}
        >
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === "local"
                ? "Поиск по тексту, описаниям, аннотациям…"
                : "Статьи, техническая документация, репозитории…"
            }
            aria-label="Поиск материалов"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Очистить поиск"
            >
              <X size={15} />
            </button>
          )}
          {tab === "web" && (
            <Button busy={webBusy} disabled={!query.trim()}>
              Найти
            </Button>
          )}
        </form>
        {tab === "local" ? (
          <>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Сортировка"
            >
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
              <option value="name">По названию</option>
            </select>
            <div className="segmented compact">
              <button
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
                aria-label="Список"
              >
                <List size={17} />
              </button>
              <button
                className={view === "grid" ? "active" : ""}
                onClick={() => setView("grid")}
                aria-label="Карточки"
              >
                <Grid2X2 size={17} />
              </button>
            </div>
          </>
        ) : (
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Источник поиска"
          >
            <option value="auto">Автовыбор источника</option>
            <option value="arxiv">arXiv</option>
            <option value="github">GitHub</option>
            <option value="duckduckgo">DuckDuckGo</option>
          </select>
        )}
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
        <div className="library-body">
          <aside className="category-list">
            <span className="eyebrow">КОЛЛЕКЦИИ</span>
            {categories.map((c) => (
              <button
                key={c}
                className={category === c ? "active" : ""}
                onClick={() => setCategory(c)}
                onDragOver={(e) => {
                  if (c !== "Все материалы") e.preventDefault();
                }}
                onDrop={async (e) => {
                  const id = e.dataTransfer.getData(
                    "application/science-document",
                  );
                  if (id && c !== "Все материалы") {
                    e.preventDefault();
                    try {
                      await mutate(
                        `/documents/${id}`,
                        { category: c },
                        "PATCH",
                      );
                    } catch {}
                  }
                }}
              >
                <FolderOpen size={16} />
                <span>{c}</span>
                <small>
                  {c === "Все материалы"
                    ? state.documents.length
                    : state.documents.filter(
                        (d) => (d.category || "Без категории") === c,
                      ).length}
                </small>
              </button>
            ))}
            <div className="category-hint">
              Категорию можно указать
              <br />в свойствах материала.
            </div>
            <div className="storage-summary">
              <span>
                <FileCheck size={16} />
                Хранятся локально
              </span>
              <strong>
                {bytes(state.documents.reduce((n, d) => n + (d.size || 0), 0))}
              </strong>
              <small>{state.documents.length} материалов в проекте</small>
            </div>
          </aside>
          <section
            className={`library-files ${drag ? "dragging" : ""}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setDrag(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDrag(false);
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                setDrag(false);
                void upload(e.dataTransfer.files);
              }
            }}
          >
            {drag && (
              <div className="drop-overlay">
                <Upload size={40} />
                <h3>Отпустите файлы здесь</h3>
                <p>Добавим их в базу знаний проекта</p>
              </div>
            )}
            {uploading && (
              <div className="upload-progress">
                <Loader2 size={16} className="spin" />
                Загружаем и извлекаем содержимое файлов…
              </div>
            )}
            {results !== null ? (
              <>
                <div className="result-count">
                  {searching
                    ? "Ищем…"
                    : `Найдено фрагментов: ${results.length}`}
                </div>
                {results.length ? (
                  results
                    .filter(
                      (r) =>
                        category === "Все материалы" ||
                        state.documents.find((d) => d.id === r.document_id)
                          ?.category === category,
                    )
                    .map((r, i) => (
                      <button
                        className="search-result"
                        key={i}
                        onClick={() =>
                          openDocument(
                            r.document_id,
                            r.page || 1,
                            r.quote || r.text || "",
                            ["text", "annotation"].includes(r.source)
                              ? r.start
                              : undefined,
                            ["text", "annotation"].includes(r.source)
                              ? r.end
                              : undefined,
                          )
                        }
                      >
                        <div>
                          <FileText size={17} />
                          <strong>{r.document_name}</strong>
                          <Tag>Страница {r.page || 1}</Tag>
                          {r.source === "annotation" && (
                            <Tag tone="orange">Аннотация</Tag>
                          )}
                        </div>
                        <p>{r.text}</p>
                        <span>
                          Открыть фрагмент
                          <ArrowUpRight size={13} />
                        </span>
                      </button>
                    ))
                ) : (
                  <Empty icon={Search} title="Совпадений пока нет">
                    Попробуйте другое слово или более короткий запрос.
                  </Empty>
                )}
              </>
            ) : !docs.length ? (
              <div className="upload-empty">
                <div className="file-stack">
                  <div />
                  <div />
                  <div>
                    <Upload size={30} strokeWidth={1.3} />
                  </div>
                </div>
                <h2>Положите знания в основу проекта</h2>
                <p>
                  Перетащите файлы сюда или выберите их на устройстве.
                  <br />
                  Команда сможет использовать каждый источник отдельно.
                </p>
                <Button
                  variant="secondary"
                  busy={uploading}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={16} />
                  Выбрать файлы
                </Button>
                <div className="file-types">
                  <span>PDF</span>
                  <span>DOCX</span>
                  <span>TXT / MD</span>
                  <span>HTML</span>
                  <span>Изображения</span>
                </div>
              </div>
            ) : (
              <>
                <div className="files-caption">
                  <h3>{category}</h3>
                  <span>{docs.length} материалов</span>
                </div>
                <div
                  className={`document-list ${view === "grid" ? "document-grid" : ""}`}
                >
                  {view === "list" && (
                    <div className="document-table-head">
                      <span>МАТЕРИАЛ</span>
                      <span>КАТЕГОРИЯ</span>
                      <span>ДОБАВЛЕН</span>
                      <span />
                    </div>
                  )}
                  {docs.map((d) => (
                    <article
                      className="document-row"
                      key={d.id}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/science-document",
                          d.id,
                        )
                      }
                    >
                      <button
                        className="document-main"
                        onClick={() => openDocument(d.id)}
                      >
                        <DocIcon mime={d.mime_type} name={d.name} />
                        <span>
                          <strong>{d.name}</strong>
                          <small>
                            {bytes(d.size || 0)} ·{" "}
                            {d.page_count
                              ? `${d.page_count} стр.`
                              : d.mime_type?.startsWith("image/")
                                ? "Изображение"
                                : "Документ"}
                            {d.status && d.status !== "ready"
                              ? ` · ${({ processed: "Обработан", uploaded: "Загружен", error: "Ошибка", needs_ocr: "Нужен OCR", unsupported: "Без извлечения текста" } as any)[d.status] || d.status}`
                              : ""}
                          </small>
                        </span>
                      </button>
                      <Tag>{d.category || "Без категории"}</Tag>
                      <time>{date(d.created_at)}</time>
                      <div className="document-actions">
                        <IconButton
                          title="Свойства материала"
                          aria-label={`Свойства ${d.name}`}
                          onClick={() => setEdit({ ...d })}
                        >
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton
                          title="Удалить"
                          aria-label={`Удалить ${d.name}`}
                          onClick={() => setRemove(d)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </div>
                    </article>
                  ))}
                </div>
                <button
                  className="drop-hint"
                  onClick={() => input.current?.click()}
                >
                  <Upload size={17} />
                  <span>
                    Перетащите ещё файлы сюда или{" "}
                    <strong>выберите на устройстве</strong>
                  </span>
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {edit && (
        <Modal title="Свойства материала" onClose={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await mutate(
                  `/documents/${edit.id}`,
                  {
                    name: edit.name,
                    category: edit.category,
                    description: edit.description,
                  },
                  "PATCH",
                );
                setEdit(null);
              } catch {}
            }}
          >
            <Field label="Название">
              <input
                required
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </Field>
            <Field label="Категория">
              <input
                list="categories"
                placeholder="Без категории"
                value={edit.category || ""}
                onChange={(e) => setEdit({ ...edit, category: e.target.value })}
              />
              <datalist id="categories">
                {categories.slice(1).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Описание">
              <textarea
                rows={5}
                value={edit.description || ""}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </Field>
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEdit(null)}
              >
                Отмена
              </Button>
              <Button>Сохранить</Button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Удалить материал?" onClose={() => setRemove(null)}>
          <p className="modal-copy">
            «{remove.name}» и его аннотации будут удалены из проекта. Исходный
            файл на вашем устройстве останется на месте.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await mutate(`/documents/${remove.id}`, undefined, "DELETE");
                  setRemove(null);
                } catch {}
              }}
            >
              Удалить материал
            </Button>
          </div>
        </Modal>
      )}
    </>
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
