import React, { useEffect, useRef, useState } from "react";
import {
  Plus,
  Users,
  Settings2,
  Pencil,
  Trash2,
  ChevronRight,
  ChevronDown,
  Check,
  FileText,
  Download,
  Save,
  Eye,
  Code,
  KeyRound,
  Server,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  BookOpen,
  Search,
  Calculator,
  Globe,
  GitBranch,
  ArrowRight,
  AlertCircle,
  Loader2,
  FolderOpen,
} from "lucide-react";
import { ScreenProps } from "./App";
import { api, date, Item, Provider, Settings } from "./api";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Markdown,
  Modal,
  Saved,
  SectionTitle,
  Tag,
} from "./ui";
const toolOptions = [
  ["search_knowledge", "Поиск по знаниям"],
  ["read_document", "Чтение документов"],
  ["read_working_document", "Чтение рабочих документов"],
  ["web_search", "Интернет-поиск"],
  ["read_web", "Чтение веб-источников"],
  ["calculate", "Расчёты"],
  ["write_document", "Создание документов"],
  ["save_claim", "Сохранение утверждений"],
  ["save_decision", "Инженерные решения"],
  ["report_conflict", "Поиск противоречий"],
  ["request_information", "Запрос недостающих данных"],
  ["remember", "Память проекта"],
  ["delegate_agent", "Привлечение специалистов"],
  ["link_entities", "Связи в графе"],
];
const roleNames: Record<string, string> = {
  engineer: "Конструкция и проектирование",
  analyst: "Анализ данных и выводов",
  researcher: "Поиск и изучение источников",
  critic: "Проверка слабых мест",
  fact_checker: "Достоверность и источники",
  technologist: "Технологии и производство",
  estimator: "Стоимость и ресурсы",
  pessimist: "Риски и ограничения",
  custom: "Ваш специалист",
};
export function AgentsScreen({ state, settings, mutate }: ScreenProps) {
  const [edit, setEdit] = useState<Item | null>(null),
    [remove, setRemove] = useState<Item | null>(null),
    [saving, setSaving] = useState(false);
  const newAgent = () =>
    setEdit({
      id: "",
      name: "",
      role: "custom",
      system_prompt: "",
      model: "",
      provider_id: settings?.default_provider_id || "",
      color: "#54776d",
      tools: toolOptions.map((t) => t[0]),
      enabled: true,
    });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      const body = {
        name: edit.name,
        role: edit.role,
        system_prompt: edit.system_prompt,
        model: edit.model || "",
        provider_id: edit.provider_id || "",
        color: edit.color || "#54776d",
        tools: edit.tools || [],
        enabled: edit.enabled !== false,
      };
      await mutate(
        edit.id ? `/agents/${edit.id}` : "/agents",
        body,
        edit.id ? "PATCH" : "POST",
      );
      setEdit(null);
    } catch {
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <SectionTitle
        eyebrow="РАЗНЫЕ ВЗГЛЯДЫ. ОБЩАЯ ЦЕЛЬ."
        title="Офис агентов"
        description="Соберите команду специалистов под задачи вашего проекта."
        action={
          <Button onClick={newAgent}>
            <Plus size={17} />
            Новый агент
          </Button>
        }
      />
      <div className="agents-intro">
        <div className="agents-intro-icon">
          <Users size={25} strokeWidth={1.5} />
        </div>
        <div>
          <strong>Команда, которая думает вместе</strong>
          <p>
            Оркестратор подключает специалистов по задаче. Вы определяете их
            роли, модели и доступные инструменты.
          </p>
        </div>
        <Tag tone="green">
          {state.agents.filter((a) => a.enabled).length} активных
        </Tag>
      </div>
      <div className="agents-grid">
        {state.agents.map((a, i) => (
          <article
            className={`agent-card panel ${!a.enabled ? "disabled-agent" : ""}`}
            key={a.id}
          >
            <div className="agent-card-top">
              <span
                className={`agent-avatar large avatar-${i % 5}`}
                style={{ borderColor: a.color || undefined }}
              >
                {a.name.slice(0, 1)}
              </span>
              <div className="agent-card-actions">
                <button
                  className={`toggle ${a.enabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={!!a.enabled}
                  aria-label={`${a.enabled ? "Отключить" : "Включить"} ${a.name}`}
                  onClick={() =>
                    mutate(
                      `/agents/${a.id}`,
                      { enabled: !a.enabled },
                      "PATCH",
                    ).catch(() => {})
                  }
                >
                  <span />
                </button>
                <IconButton
                  title="Настроить агента"
                  aria-label={`Настроить ${a.name}`}
                  onClick={() => setEdit({ ...a })}
                >
                  <Settings2 size={17} />
                </IconButton>
              </div>
            </div>
            <h2>{a.name}</h2>
            <span className="agent-role">{roleNames[a.role] || a.role}</span>
            <p>
              {a.system_prompt ||
                "Задайте системный промпт, чтобы определить подход и специализацию агента."}
            </p>
            <div className="agent-card-footer">
              <span>
                <span className="model-dot" />
                {a.model || "Модель оркестратора"}
              </span>
              <button onClick={() => setEdit({ ...a })}>
                {a.tools?.length || 0} инструментов
                <ChevronRight size={13} />
              </button>
            </div>
          </article>
        ))}
        <button className="new-agent-card" onClick={newAgent}>
          <span>
            <Plus size={26} strokeWidth={1.3} />
          </span>
          <h3>Место для нового взгляда</h3>
          <p>
            Добавьте специалиста со своей
            <br />
            ролью и подходом к работе.
          </p>
        </button>
      </div>
      {edit && (
        <Modal
          title={edit.id ? "Настройки специалиста" : "Новый специалист"}
          subtitle="Роль определяет, на что агент обращает внимание в общей работе."
          onClose={() => setEdit(null)}
          wide
        >
          <form onSubmit={save}>
            <div className="form-columns">
              <div>
                <div className="form-row">
                  <Field label="Имя агента">
                    <input
                      required
                      value={edit.name}
                      onChange={(e) =>
                        setEdit({ ...edit, name: e.target.value })
                      }
                      placeholder="Например, Специалист по электронике"
                    />
                  </Field>
                  <Field label="Цвет">
                    <input
                      type="color"
                      value={edit.color || "#54776d"}
                      onChange={(e) =>
                        setEdit({ ...edit, color: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <Field label="Специализация">
                  <select
                    value={edit.role}
                    onChange={(e) => setEdit({ ...edit, role: e.target.value })}
                  >
                    {Object.entries(roleNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Провайдер">
                  <select
                    value={edit.provider_id || ""}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        provider_id: e.target.value,
                        model: "",
                      })
                    }
                  >
                    <option value="">Провайдер по умолчанию</option>
                    {settings?.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Модель"
                  hint="Пустое поле — модель оркестратора. Можно указать ID вручную."
                >
                  <input
                    list="agent-models"
                    value={edit.model || ""}
                    onChange={(e) =>
                      setEdit({ ...edit, model: e.target.value })
                    }
                    placeholder={
                      settings?.orchestrator_model || "Модель по умолчанию"
                    }
                  />
                  <datalist id="agent-models">
                    {settings?.providers
                      .find(
                        (p) =>
                          p.id ===
                          (edit.provider_id || settings.default_provider_id),
                      )
                      ?.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id}
                        </option>
                      ))}
                  </datalist>
                </Field>
                <Field label="Инструменты">
                  <div className="tool-checklist">
                    {toolOptions.map(([id, label]) => (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={edit.tools?.includes(id) || false}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              tools: e.target.checked
                                ? [...(edit.tools || []), id]
                                : (edit.tools || []).filter(
                                    (t: string) => t !== id,
                                  ),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
              <Field
                label="Системный промпт"
                hint="Опишите задачи, подход, ограничения и формат результата."
              >
                <textarea
                  className="system-prompt"
                  required
                  value={edit.system_prompt}
                  onChange={(e) =>
                    setEdit({ ...edit, system_prompt: e.target.value })
                  }
                  placeholder="Ты — специалист по электронике. Проверяй…"
                />
              </Field>
            </div>
            <div className="modal-actions spread">
              {edit.id ? (
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => {
                    setRemove(edit);
                    setEdit(null);
                  }}
                >
                  <Trash2 size={14} />
                  Удалить агента
                </button>
              ) : (
                <span />
              )}
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEdit(null)}
                >
                  Отмена
                </Button>
                <Button busy={saving} disabled={!edit.name.trim()}>
                  Сохранить
                </Button>
              </div>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Удалить агента?" onClose={() => setRemove(null)}>
          <p className="modal-copy">
            «{remove.name}» будет удалён из команды. Его предыдущие сообщения
            останутся в истории.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await mutate(`/agents/${remove.id}`, undefined, "DELETE");
                  setRemove(null);
                } catch {}
              }}
            >
              Удалить
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
type WorkspaceDraft = { title: string; content: string };
const workspaceDraftKey = (pid: string, id: string) =>
  `science-hub-draft:${pid}:${id}`;
function readWorkspaceDraft(pid: string, id: string): WorkspaceDraft | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(workspaceDraftKey(pid, id)) || "null",
    );
    return value &&
      typeof value.title === "string" &&
      typeof value.content === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
function clearWorkspaceDraft(pid: string, id: string) {
  try {
    sessionStorage.removeItem(workspaceDraftKey(pid, id));
  } catch {}
}
export function WorkspaceScreen({ pid, state, mutate, onError }: ScreenProps) {
  const [selected, setSelected] = useState(() => {
      let preferred = "";
      try {
        preferred = sessionStorage.getItem(`science-hub-document:${pid}`) || "";
      } catch {}
      return state.workspace_documents.some((d) => d.id === preferred)
        ? preferred
        : state.workspace_documents[0]?.id || "";
    }),
    [title, setTitle] = useState(""),
    [content, setContent] = useState(""),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [preview, setPreview] = useState(false),
    [newOpen, setNewOpen] = useState(false),
    [newTitle, setNewTitle] = useState(""),
    [remove, setRemove] = useState<Item | null>(null),
    [query, setQuery] = useState(""),
    [pending, setPending] = useState<string | null>(null);
  const selectedDoc = state.workspace_documents.find((d) => d.id === selected),
    loadedKey = useRef(""),
    storageWarning = useRef(false),
    savingRef = useRef(false);
  const editor = useRef({
    pid,
    id: selected,
    title: "",
    content: "",
    dirty: false,
  });
  useEffect(() => {
    const key = `${pid}:${selected}`;
    if (loadedKey.current !== key) {
      const draft = readWorkspaceDraft(pid, selected),
        next = {
          title: draft?.title ?? selectedDoc?.title ?? "",
          content: draft?.content ?? selectedDoc?.content ?? "",
        };
      const changed =
        !!draft &&
        (next.title !== (selectedDoc?.title || "") ||
          next.content !== (selectedDoc?.content || ""));
      loadedKey.current = key;
      editor.current = { pid, id: selected, ...next, dirty: changed };
      setTitle(next.title);
      setContent(next.content);
      setDirty(changed);
      setSaved(false);
      if (!changed) clearWorkspaceDraft(pid, selected);
      try {
        sessionStorage.setItem(`science-hub-document:${pid}`, selected);
      } catch {}
    } else if (selectedDoc && !editor.current.dirty && !savingRef.current) {
      editor.current = {
        pid,
        id: selected,
        title: selectedDoc.title,
        content: selectedDoc.content || "",
        dirty: false,
      };
      setTitle(selectedDoc.title);
      setContent(selectedDoc.content || "");
    }
  }, [pid, selected, selectedDoc?.updated_at]);
  useEffect(() => {
    if (!state.workspace_documents.some((d) => d.id === selected))
      setSelected(state.workspace_documents[0]?.id || "");
  }, [state.workspace_documents, selected]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (editor.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  function changeDraft(changes: Partial<WorkspaceDraft>) {
    const next = { ...editor.current, ...changes, dirty: true };
    editor.current = next;
    setTitle(next.title);
    setContent(next.content);
    setDirty(true);
    setSaved(false);
    try {
      sessionStorage.setItem(
        workspaceDraftKey(next.pid, next.id),
        JSON.stringify({ title: next.title, content: next.content }),
      );
    } catch {
      if (!storageWarning.current) {
        storageWarning.current = true;
        onError(
          new Error(
            "Не удалось сохранить черновик в этой вкладке. Сохраните документ перед переходом в другой раздел.",
          ),
        );
      }
    }
  }
  async function save() {
    const snapshot = { ...editor.current };
    if (!snapshot.id || savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await mutate(
        `/workspace-documents/${snapshot.id}`,
        {
          title: snapshot.title.trim() || "Без названия",
          content: snapshot.content,
          format: "markdown",
        },
        "PATCH",
      );
      const current = editor.current,
        stored = readWorkspaceDraft(snapshot.pid, snapshot.id);
      if (
        stored?.title === snapshot.title &&
        stored?.content === snapshot.content
      )
        clearWorkspaceDraft(snapshot.pid, snapshot.id);
      if (
        current.pid === snapshot.pid &&
        current.id === snapshot.id &&
        current.title === snapshot.title &&
        current.content === snapshot.content
      ) {
        editor.current = {
          ...current,
          title: result.title,
          content: result.content,
          dirty: false,
        };
        setTitle(result.title);
        setContent(result.content);
        setDirty(false);
        setSaved(true);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const doc = await mutate("/workspace-documents", {
        title: newTitle.trim(),
        content: "",
        format: "markdown",
      });
      setNewOpen(false);
      setNewTitle("");
      setSelected(doc.id);
    } catch {
    } finally {
      setSaving(false);
    }
  }
  function select(id: string) {
    if (dirty && id !== selected) setPending(id);
    else setSelected(id);
  }
  async function exportDoc(format: string) {
    if (dirty && !(await save())) return;
    const a = document.createElement("a");
    a.href = `/api/projects/${pid}/workspace-documents/${selected}/export?format=${format}`;
    a.download = "";
    a.click();
  }
  return (
    <>
      <SectionTitle
        eyebrow="ОТ МЫСЛИ К РЕЗУЛЬТАТУ"
        title="Рабочие документы"
        description="Развивайте идеи, собирайте отчёты и сохраняйте результаты команды."
        action={
          <Button onClick={() => setNewOpen(true)}>
            <Plus size={17} />
            Создать документ
          </Button>
        }
      />
      <div className="workspace-layout panel">
        <aside className="workspace-list">
          <div className="search-box small">
            <Search size={16} />
            <input
              placeholder="Найти документ…"
              aria-label="Найти рабочий документ"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="workspace-list-heading">
            ДОКУМЕНТЫ <span>{state.workspace_documents.length}</span>
          </div>
          {state.workspace_documents
            .filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
            .map((d) => (
              <button
                className={selected === d.id ? "selected" : ""}
                key={d.id}
                onClick={() => select(d.id)}
              >
                <FileText size={19} />
                <span>
                  <strong>{d.title}</strong>
                  <small>{date(d.updated_at)}</small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          {!state.workspace_documents.length && (
            <p className="workspace-list-empty">
              Отчёты, исследования
              <br />и документация проекта
            </p>
          )}
        </aside>
        <div className="workspace-editor">
          {!selectedDoc ? (
            <Empty
              icon={FileText}
              title="Создайте место для ваших выводов"
              action={
                <Button variant="secondary" onClick={() => setNewOpen(true)}>
                  <Plus size={16} />
                  Первый документ
                </Button>
              }
            >
              Напишите заметку или сохраните ответ оркестратора. Документы
              команды тоже появятся здесь.
            </Empty>
          ) : (
            <>
              <div className="editor-toolbar">
                <div className="segmented compact">
                  <button
                    className={!preview ? "active" : ""}
                    onClick={() => setPreview(false)}
                  >
                    <Pencil size={14} />
                    Редактор
                  </button>
                  <button
                    className={preview ? "active" : ""}
                    onClick={() => setPreview(true)}
                  >
                    <Eye size={14} />
                    Просмотр
                  </button>
                </div>
                <div className="editor-actions">
                  {dirty ? (
                    <span
                      className="unsaved"
                      title="Черновик сохраняется в этой вкладке и восстанавливается при возвращении"
                    >
                      Черновик в этой вкладке
                    </span>
                  ) : (
                    <Saved show={saved} />
                  )}
                  <div className="export-menu">
                    <Button variant="secondary small">
                      <Download size={14} />
                      <span>Экспорт</span>
                      <ChevronDown size={12} />
                    </Button>
                    <div>
                      {[
                        ["md", "Markdown"],
                        ["txt", "Текст"],
                        ["docx", "Word · DOCX"],
                        ["pdf", "PDF"],
                      ].map(([format, label]) => (
                        <button key={format} onClick={() => exportDoc(format)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="small"
                    busy={saving}
                    onClick={save}
                    disabled={!dirty}
                  >
                    <Save size={14} />
                    Сохранить
                  </Button>
                  <IconButton
                    title="Удалить документ"
                    aria-label="Удалить документ"
                    onClick={() => setRemove(selectedDoc)}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </div>
              <div className="editor-paper">
                <input
                  className="document-title-input"
                  aria-label="Название рабочего документа"
                  value={title}
                  onChange={(e) => changeDraft({ title: e.target.value })}
                  placeholder="Название документа"
                />
                <div className="editor-meta">
                  <span>MARKDOWN</span>
                  <span>
                    {content.trim() ? content.trim().split(/\s+/).length : 0}{" "}
                    слов
                  </span>
                  <span>Изменён {date(selectedDoc.updated_at)}</span>
                </div>
                {preview ? (
                  <Markdown text={content || "Ваш текст появится здесь."} />
                ) : (
                  <textarea
                    className="markdown-editor"
                    aria-label="Содержимое рабочего документа"
                    value={content}
                    onChange={(e) => changeDraft({ content: e.target.value })}
                    placeholder="Начните писать. Здесь можно использовать Markdown…"
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                        e.preventDefault();
                        void save();
                      }
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {newOpen && (
        <Modal title="Новый рабочий документ" onClose={() => setNewOpen(false)}>
          <form onSubmit={create}>
            <Field label="Название">
              <input
                required
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Например, Исследование концепции"
              />
            </Field>
            <div className="modal-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setNewOpen(false)}
              >
                Отмена
              </Button>
              <Button busy={saving} disabled={!newTitle.trim()}>
                Создать документ
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal
          title="Удалить рабочий документ?"
          onClose={() => setRemove(null)}
        >
          <p className="modal-copy">
            «{remove.title}» будет удалён из проекта.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await mutate(
                    `/workspace-documents/${remove.id}`,
                    undefined,
                    "DELETE",
                  );
                  clearWorkspaceDraft(pid, remove.id);
                  setRemove(null);
                  setSelected("");
                  setDirty(false);
                } catch {}
              }}
            >
              Удалить
            </Button>
          </div>
        </Modal>
      )}
      {pending !== null && (
        <Modal title="Сохранить изменения?" onClose={() => setPending(null)}>
          <p className="modal-copy">
            В документе «{title}» есть несохранённые изменения.
          </p>
          <div className="modal-actions">
            <Button
              variant="secondary"
              onClick={() => {
                clearWorkspaceDraft(pid, selected);
                editor.current.dirty = false;
                setSelected(pending);
                setPending(null);
              }}
            >
              Продолжить без сохранения
            </Button>
            <Button
              busy={saving}
              onClick={async () => {
                if (await save()) {
                  setSelected(pending);
                  setPending(null);
                }
              }}
            >
              Сохранить и продолжить
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function SettingsScreen({
  settings,
  onSettings,
  onError,
  projects,
  pid,
  onProjectsChanged,
}: {
  settings: Settings | null;
  onSettings: (s: Settings) => void;
  onError: (e: unknown) => void;
  projects: Item[];
  pid: string;
  onProjectsChanged: () => Promise<Item[]>;
}) {
  const [form, setForm] = useState<Settings | null>(
      settings ? structuredClone(settings) : null,
    ),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [refreshing, setRefreshing] = useState(""),
    [deleteProject, setDeleteProject] = useState(false),
    [projectName, setProjectName] = useState(""),
    [projectDescription, setProjectDescription] = useState(""),
    [removingProvider, setRemovingProvider] = useState("");
  const project = projects.find((p) => p.id === pid);
  useEffect(() => {
    if (settings) setForm(structuredClone(settings));
  }, [settings]);
  useEffect(() => {
    setProjectName(project?.name || "");
    setProjectDescription(project?.description || "");
  }, [project?.id]);
  if (!form)
    return (
      <div className="loading-page">
        <Loader2 className="spin" />
        <p>Загружаем настройки…</p>
      </div>
    );
  function change(changes: Partial<Settings>) {
    setForm((f) => ({ ...f!, ...changes }));
    setSaved(false);
  }
  function providerChange(id: string, changes: Partial<Provider>) {
    setForm((f) => ({
      ...f!,
      providers: f!.providers.map((p) =>
        p.id === id ? { ...p, ...changes } : p,
      ),
    }));
    setSaved(false);
  }
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setSaving(true);
    try {
      const result = await api<Settings>("/settings", form, "PATCH");
      onSettings(result);
      setSaved(true);
      return result;
    } catch (e) {
      onError(e);
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function refreshModels(id: string) {
    setRefreshing(id);
    try {
      const current = await save();
      if (!current) return;
      const models = await api(`/providers/${id}/models`);
      const latest = {
        ...current,
        providers: current.providers.map((p) =>
          p.id === id ? { ...p, models } : p,
        ),
      };
      onSettings(latest);
      setSaved(true);
    } catch (e) {
      onError(e);
    } finally {
      setRefreshing("");
    }
  }
  const defaultModels =
    form.providers.find((p) => p.id === form.default_provider_id)?.models || [];
  return (
    <>
      <SectionTitle
        eyebrow="ВАША СРЕДА ПОД ВАШИ ЗАДАЧИ"
        title="Настройки"
        description="Подключите модели, настройте работу команды и управляйте проектом."
      />
      <div className="settings-layout">
        <form onSubmit={save}>
          <section className="settings-section panel">
            <div className="settings-heading">
              <div className="settings-heading-icon">
                <Server size={21} />
              </div>
              <div>
                <h2>AI-провайдеры</h2>
                <p>Совместимые с OpenAI API сервисы и шлюзы</p>
              </div>
              <Button
                type="button"
                variant="secondary small"
                onClick={() =>
                  change({
                    providers: [
                      ...form.providers,
                      {
                        id: `provider_${Date.now()}`,
                        name: "Новый провайдер",
                        base_url: "",
                        has_key: false,
                        models: [],
                      },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Добавить
              </Button>
            </div>
            {form.providers.map((p, index) => (
              <div className="provider-card" key={p.id}>
                <div className="provider-title">
                  <span>ПОДКЛЮЧЕНИЕ {String(index + 1).padStart(2, "0")}</span>
                  {form.default_provider_id === p.id ? (
                    <Tag tone="green">По умолчанию</Tag>
                  ) : (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => change({ default_provider_id: p.id })}
                    >
                      Использовать по умолчанию
                    </button>
                  )}
                  <IconButton
                    type="button"
                    title="Удалить провайдера"
                    aria-label="Удалить провайдера"
                    disabled={form.providers.length === 1}
                    onClick={() => setRemovingProvider(p.id)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                <div className="form-row">
                  <Field label="Название">
                    <input
                      required
                      value={p.name}
                      onChange={(e) =>
                        providerChange(p.id, { name: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Base URL">
                    <input
                      required
                      type="url"
                      value={p.base_url}
                      onChange={(e) =>
                        providerChange(p.id, { base_url: e.target.value })
                      }
                      placeholder="https://api.example.com/v1"
                    />
                  </Field>
                </div>
                <Field
                  label="API-ключ"
                  hint={
                    p.has_key
                      ? "Ключ сохранён на сервере. Оставьте поле пустым, чтобы его не менять."
                      : "Ключ хранится локально на сервере и не возвращается в браузер."
                  }
                >
                  <div className="key-input">
                    <KeyRound size={16} />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={p.api_key || ""}
                      onChange={(e) =>
                        providerChange(p.id, { api_key: e.target.value })
                      }
                      placeholder={
                        p.has_key
                          ? "•••••••••••••••• · ключ сохранён"
                          : "Вставьте API-ключ"
                      }
                    />
                    {p.has_key && <ShieldCheck size={18} />}
                  </div>
                </Field>
                <div className="provider-models">
                  <span>
                    <span className="model-dot" />
                    {p.models.length
                      ? `${p.models.length} моделей доступно`
                      : "Список моделей ещё не загружен"}
                  </span>
                  <Button
                    type="button"
                    variant="secondary small"
                    busy={refreshing === p.id}
                    disabled={!p.base_url}
                    onClick={() => refreshModels(p.id)}
                  >
                    <RefreshCw size={14} />
                    Обновить модели
                  </Button>
                </div>
              </div>
            ))}
          </section>
          <section className="settings-section panel">
            <div className="settings-heading">
              <div className="settings-heading-icon">
                <Settings2 size={21} />
              </div>
              <div>
                <h2>Оркестратор и выполнение</h2>
                <p>Настройки по умолчанию для новых задач</p>
              </div>
            </div>
            <div className="form-row">
              <Field label="Модель оркестратора">
                <input
                  list="settings-models"
                  value={form.orchestrator_model || ""}
                  onChange={(e) =>
                    change({ orchestrator_model: e.target.value })
                  }
                  placeholder="ID модели"
                />
              </Field>
              <Field
                label="Модель для изображений"
                hint="Выберите модель с поддержкой изображений."
              >
                <input
                  list="settings-models"
                  value={form.vision_model || ""}
                  onChange={(e) => change({ vision_model: e.target.value })}
                  placeholder="ID мультимодальной модели"
                />
              </Field>
            </div>
            <datalist id="settings-models">
              {defaultModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </datalist>
            <div className="form-row">
              <Field
                label="Автономная работа, минут"
                hint="По истечении времени команда получает указание завершить работу и сохранить результат."
              >
                <input
                  type="number"
                  required
                  min={0.5}
                  max={1440}
                  step={0.5}
                  value={(form.max_runtime_seconds ?? 600) / 60}
                  onChange={(e) => change({ max_runtime_seconds: Number(e.target.value) * 60 })}
                />
              </Field>
              <Field
                label="Время на завершение, секунд"
                hint="После этого периода оставшиеся запросы и агенты принудительно останавливаются."
              >
                <input
                  type="number"
                  required
                  min={5}
                  max={600}
                  value={form.shutdown_grace_seconds ?? 60}
                  onChange={(e) => change({ shutdown_grace_seconds: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="Токенов на ответ">
                <input
                  type="number"
                  min={128}
                  max={8192}
                  step={128}
                  value={form.max_tokens || 2048}
                  onChange={(e) =>
                    change({ max_tokens: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <div className="settings-save">
              <Saved show={saved} />
              <Button busy={saving}>
                <Save size={16} />
                Сохранить настройки
              </Button>
            </div>
          </section>
        </form>
        <aside className="settings-aside">
          <div className="privacy-card">
            <ShieldCheck size={29} strokeWidth={1.4} />
            <h3>
              Ваше пространство.
              <br />
              Ваши данные.
            </h3>
            <p>
              Файлы, история, настройки и база проекта хранятся локально на этом
              устройстве.
            </p>
            <p>
              При запуске AI-задач запрос и выбранный контекст передаются
              настроенному API-провайдеру. Интернет-поиск отправляет поисковые
              запросы внешним источникам.
            </p>
            <span>
              <span className="live-dot" />
              Доступ через локальный сервер
            </span>
          </div>
          {project && (
            <section className="settings-project panel">
              <h3>Текущий проект</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await api(
                      `/projects/${pid}`,
                      { name: projectName, description: projectDescription },
                      "PATCH",
                    );
                    await onProjectsChanged();
                  } catch (e) {
                    onError(e);
                  }
                }}
              >
                <Field label="Название">
                  <input
                    required
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </Field>
                <Field label="Описание">
                  <textarea
                    rows={4}
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                  />
                </Field>
                <Button variant="secondary small">Обновить проект</Button>
              </form>
              <hr />
              <button
                className="danger-link"
                onClick={() => setDeleteProject(true)}
              >
                <Trash2 size={14} />
                Удалить проект
              </button>
            </section>
          )}
        </aside>
      </div>
      {deleteProject && (
        <Modal
          title="Удалить проект и его данные?"
          onClose={() => setDeleteProject(false)}
        >
          <p className="modal-copy">
            Проект «{project?.name}», его материалы, аннотации, документы,
            агенты и история будут удалены. Это действие нельзя отменить.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setDeleteProject(false)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api(`/projects/${pid}`, undefined, "DELETE");
                  setDeleteProject(false);
                  await onProjectsChanged();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Удалить проект
            </Button>
          </div>
        </Modal>
      )}
      {removingProvider && (
        <Modal
          title="Удалить подключение?"
          onClose={() => setRemovingProvider("")}
        >
          <p className="modal-copy">
            Провайдер будет удалён после сохранения настроек. Агентам с этим
            провайдером потребуется другое подключение.
          </p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemovingProvider("")}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const next = form.providers.filter(
                  (p) => p.id !== removingProvider,
                );
                change({
                  providers: next,
                  default_provider_id:
                    form.default_provider_id === removingProvider
                      ? next[0].id
                      : form.default_provider_id,
                });
                setRemovingProvider("");
              }}
            >
              Удалить подключение
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
