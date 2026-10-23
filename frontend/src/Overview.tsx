import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  Paperclip,
  ChevronDown,
  Users,
  Compass,
  FileText,
  BookOpen,
  Activity,
  Square,
  Clock,
  ArrowRight,
  ExternalLink,
  Save,
} from "lucide-react";
import { ScreenProps } from "./App";
import { date, Item, safeUrl } from "./api";
import { Button, IconButton, Tag, Markdown } from "./ui";
const statusNames: Record<string, string> = {
  queued: "В очереди",
  wrapping_up: "Завершает работу",
  timed_out: "Время истекло",
  running: "В работе",
  completed: "Завершено",
  failed: "Ошибка",
  cancelled: "Остановлено",
};
export function Overview({
  state,
  settings,
  mutate,
  onError,
  navigate,
  openDocument,
}: ScreenProps) {
  const [prompt, setPrompt] = useState(""),
    [mode, setMode] = useState("team"),
    [model, setModel] = useState(""),
    [docs, setDocs] = useState<string[]>([]),
    [agents, setAgents] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [scope, setScope] = useState<"documents" | "agents" | null>(null),
    [history, setHistory] = useState("all");
  const messagesRef = useRef<HTMLDivElement>(null);
  const scrollEnd = useRef(true);
  const running = state.runs.filter((r) =>
    ["queued", "running", "wrapping_up"].includes(r.status),
  );
  const messages =
    history === "all"
      ? state.messages
      : state.messages.filter((m) => m.run_id === history);
  const models =
    settings?.providers.find((p) => p.id === settings.default_provider_id)
      ?.models || [];
  useEffect(() => {
    if (scrollEnd.current && messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages.length]);
  useEffect(() => {
    setDocs([]);
    setAgents([]);
    setHistory("all");
    setPrompt("");
  }, [state.project.id]);
  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await mutate("/runs", {
        prompt: prompt.trim(),
        mode,
        model: model || undefined,
        document_ids: docs,
        agent_ids: agents,
      });
      setPrompt("");
      setScope(null);
      setHistory("all");
      scrollEnd.current = true;
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function saveMessage(message: Item) {
    try {
      await mutate("/workspace-documents", {
        title: `Результат · ${date(message.created_at)}`,
        content: message.content,
        format: "markdown",
        source_run_id: message.run_id,
      });
      navigate("documents");
    } catch {}
  }
  const selectedRun = history === "all" ? state.runs.at(-1) : state.runs.find((r) => r.id === history);
  const recentEvents = state.events.filter((e) => e.run_id === selectedRun?.id).slice(-60).reverse();
  const followupRun = selectedRun?.needs_followup ? selectedRun : null;
  const elapsed = selectedRun?.started_at
    ? Math.max(0, Math.floor(((selectedRun.finished_at ? Date.parse(selectedRun.finished_at) : Date.now()) - Date.parse(selectedRun.started_at)) / 1000)) : 0;
  const duration = (seconds: number) => `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
  const toggle = (
    list: string[],
    id: string,
    set: React.Dispatch<React.SetStateAction<string[]>>,
  ) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <>
      <div className="workbench-heading">
        <div>
          <h1>{state.project.name}</h1>
          {state.project.description && <p>{state.project.description}</p>}
        </div>
        <div className="workbench-counts">
          <button onClick={() => navigate("library")}><BookOpen size={16} /> {state.documents.length} источников</button>
          <button onClick={() => navigate("documents")}><FileText size={16} /> {state.workspace_documents.length} документов</button>
          <button onClick={() => navigate("agents")}><Users size={16} /> {state.agents.filter((a) => a.enabled).length} агентов</button>
        </div>
      </div>
      <div className="workbench-grid">
        <section className="chat-panel panel">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="orchestrator-icon">
                <Compass size={21} />
              </span>
              <div>
                <h2>Чат с оркестратором</h2>
                <span>
                  {running.length ? (
                    <>
                      <span className="live-dot" />
                      Команда исследует вашу задачу
                    </>
                  ) : (
                    "Задачи, ответы и результаты команды"
                  )}
                </span>
              </div>
            </div>
            <div className="chat-heading-actions">
              <select
                aria-label="История задач"
                value={history}
                onChange={(e) => setHistory(e.target.value)}
              >
                <option value="all">Вся история</option>
                {state.runs
                  .slice()
                  .reverse()
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {String(r.prompt).slice(0, 40)} ·{" "}
                      {r.needs_followup || r.outcome === "budget_limited"
                        ? "Требуется продолжение"
                        : statusNames[r.status]}
                    </option>
                  ))}
              </select>
              <Tag tone={running.length ? "orange" : "green"}>
                {running.length ? "В работе" : "Готов к работе"}
              </Tag>
            </div>
          </div>
          <div
            className="messages"
            ref={messagesRef}
            onScroll={() => {
              const el = messagesRef.current;
              if (el)
                scrollEnd.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
          >
            {!messages.length ? (
              <div className="chat-empty workbench-empty">
                <Compass size={32} strokeWidth={1.5} />
                <h2>Задача оркестратору</h2>
                <p>Опишите, что нужно исследовать или подготовить. Источники и состав команды можно выбрать под полем ввода.</p>
                <div className="workbench-suggestions">
                  <button onClick={() => setPrompt("Проанализируй материалы проекта. Выдели ключевые факты, противоречия и вопросы, на которые пока нет ответа.")}>
                    <BookOpen size={16} /> Разобрать материалы
                  </button>
                  <button onClick={() => setPrompt("Составь план исследования проекта: уточни исходные данные, предложи этапы и распредели задачи между специалистами.")}>
                    <Users size={16} /> Составить план
                  </button>
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <article
                  key={m.id}
                  className={`message ${m.role === "user" ? "user-message" : ""} ${m.role === "system" ? "system-message" : ""}`}
                >
                  <div className="message-head">
                    <span
                      className={`message-avatar ${m.role === "user" ? "human" : ""}`}
                    >
                      {m.role === "user" ? (
                        "ВЫ"
                      ) : m.role === "agent" ? (
                        <Users size={15} />
                      ) : (
                        <Compass size={16} />
                      )}
                    </span>
                    <strong>
                      {m.role === "user" ? "Вы" : m.agent_name || "Оркестратор"}
                    </strong>
                    <small>{date(m.created_at)}</small>
                    {m.role !== "user" && m.role !== "system" && (
                      <IconButton
                        title="Сохранить в документы"
                        aria-label="Сохранить ответ в документы"
                        onClick={() => saveMessage(m)}
                      >
                        <Save size={14} />
                      </IconButton>
                    )}
                  </div>
                  <Markdown text={m.content || ""} />
                  {m.sources?.length > 0 && (
                    <div className="message-sources">
                      {m.sources.map((source: any, i: number) =>
                        typeof source === "string" ? (
                          <span key={i} className="tag">
                            {source}
                          </span>
                        ) : source.document_id ||
                          (source.type === "document" && source.id) ? (
                          <button
                            key={i}
                            className="source-chip"
                            onClick={() =>
                              openDocument(
                                source.document_id || source.id,
                                source.page || 1,
                                source.quote || source.text || "",
                              )
                            }
                          >
                            <FileText size={12} />
                            {source.document_name ||
                              source.name ||
                              source.title ||
                              "Источник"}{" "}
                            · {source.page || 1}
                          </button>
                        ) : source.url ? (
                          <a
                            key={i}
                            className="source-chip"
                            target="_blank"
                            rel="noreferrer"
                            href={safeUrl(source.url)}
                          >
                            <ExternalLink size={12} />
                            {source.title || source.url}
                          </a>
                        ) : (
                          <span className="source-chip" key={i}>
                            {source.title ||
                              source.name ||
                              (
                                {
                                  calculation: "Расчёт",
                                  agent_statement: "Вывод специалиста",
                                  workspace_document: "Рабочий документ",
                                } as any
                              )[source.type] ||
                              "Материал проекта"}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
            {running.length > 0 && (
              <div className="thinking">
                <span />
                <span />
                <span />
                Оркестратор и агенты работают. Результаты появятся здесь.
              </div>
            )}
          </div>
          <div className="composer-wrap">
            {followupRun && (
              <div className="limit-banner">
                <Clock size={16} />
                <span>Задача завершилась с ограничениями. Сохранён промежуточный результат.</span>
                <button className="text-link" onClick={() => setPrompt(`Продолжи исследование по предыдущей задаче: ${followupRun.prompt}. Учти сохранённые результаты и укажи, что осталось выполнить.`)}>
                  Продолжить <ArrowRight size={14} />
                </button>
              </div>
            )}
            {running.map((r) => (
              <div className="running-banner" key={r.id}>
                <Activity size={15} className="pulse" />
                <span>
                  {statusNames[r.status]} · {String(r.prompt).slice(0, 70)}
                </span>
                <button
                  onClick={() =>
                    mutate(`/runs/${r.id}/cancel`, {}).catch(() => {})
                  }
                >
                  <Square size={12} />
                  Остановить
                </button>
              </div>
            ))}
            {scope && (
              <div className="scope-popover">
                <div className="scope-heading">
                  <strong>
                    {scope === "documents"
                      ? "Контекст задачи"
                      : "Состав команды"}
                  </strong>
                  <button
                    onClick={() =>
                      scope === "documents" ? setDocs([]) : setAgents([])
                    }
                  >
                    Сбросить выбор
                  </button>
                </div>
                <p>
                  {scope === "documents"
                    ? "Без выбора используется вся база знаний."
                    : "Без выбора оркестратор сам подключит нужных агентов."}
                </p>
                <div className="scope-list">
                  {(scope === "documents"
                    ? state.documents
                    : state.agents.filter((a) => a.enabled)
                  ).map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={(scope === "documents"
                          ? docs
                          : agents
                        ).includes(item.id)}
                        onChange={() =>
                          scope === "documents"
                            ? toggle(docs, item.id, setDocs)
                            : toggle(agents, item.id, setAgents)
                        }
                      />
                      <span>{item.name}</span>
                    </label>
                  ))}
                  {!(scope === "documents" ? state.documents : state.agents)
                    .length && <small>Пока ничего не добавлено.</small>}
                </div>
              </div>
            )}
            <form className="composer" onSubmit={submit}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Опишите задачу или задайте вопрос по проекту…"
                rows={3}
                aria-label="Задача оркестратору"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
              <div className="composer-toolbar">
                <div className="composer-controls">
                  <button
                    type="button"
                    className={scope === "documents" ? "selected" : ""}
                    title="Выбрать документы"
                    onClick={() =>
                      setScope(scope === "documents" ? null : "documents")
                    }
                  >
                    <Paperclip size={16} />
                    <span>
                      {docs.length ? `${docs.length} ист.` : "Вся база"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={scope === "agents" ? "selected" : ""}
                    onClick={() =>
                      setScope(scope === "agents" ? null : "agents")
                    }
                  >
                    <Users size={16} />
                    <span>
                      {agents.length ? `${agents.length} аг.` : "Команда"}
                    </span>
                  </button>
                  <select
                    aria-label="Режим работы"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="team">Командная работа</option>
                    <option value="chat">Быстрый ответ</option>
                  </select>
                </div>
                <button
                  className="send-button"
                  type="submit"
                  disabled={busy || !prompt.trim()}
                  aria-label="Отправить задачу"
                >
                  <ArrowUp size={21} />
                </button>
              </div>
            </form>
            <div className="composer-bottom">
              <label>
                <span className="model-dot" />
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  aria-label="Модель для задачи"
                >
                  <option value="">
                    {settings?.orchestrator_model || "Модель из настроек"}
                  </option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} />
              </label>
              <span>⌘ / Ctrl + Enter · отправить</span>
            </div>
          </div>
        </section>
        <aside className="workbench-side">
          <section className="panel workbench-activity" aria-label="Ход решений">
            <div className="small-panel-heading">
              <h2><Activity size={18} /> Ход решений</h2>
              {selectedRun && <Tag tone={selectedRun.status === "failed" ? "red" : "green"}>{statusNames[selectedRun.status] || selectedRun.status}</Tag>}
            </div>
            {selectedRun ? (
              <>
                <p className="activity-task">{selectedRun.prompt}</p>
                <div className="run-metrics">
                  <span><Clock size={14} /> {duration(elapsed)}</span>
                  <span>{selectedRun.usage?.calls || 0} API-вызовов</span>
                </div>
                {selectedRun.status === "wrapping_up" && <p className="run-deadline">Время исследования истекло. Команда сохраняет результаты перед остановкой.</p>}
                <div className="workbench-events" role="log" aria-label="События задачи">
                  {recentEvents.map((e) => (
                    <div key={e.id} className={`workbench-event ${["error", "tool_error", "timed_out"].includes(e.type) ? "error" : ""}`}>
                      <span className="event-dot" />
                      <div>
                        <p>{e.message}</p>
                        <time>{date(e.created_at)}</time>
                      </div>
                    </div>
                  ))}
                  {!recentEvents.length && <p className="muted">Задача ожидает запуска.</p>}
                </div>
              </>
            ) : <p className="workbench-placeholder">После запуска здесь будут видны действия агентов, обращения к источникам, сохранения и ошибки.</p>}
          </section>
          <section className="panel workbench-library">
            <div className="small-panel-heading">
              <h2><BookOpen size={18} /> База знаний</h2>
              <IconButton onClick={() => navigate("library")} aria-label="Открыть базу знаний"><ArrowUpRight size={18} /></IconButton>
            </div>
            <div className="workbench-files">
              {state.documents.slice(-4).reverse().map((doc) => (
                <button key={doc.id} onClick={() => openDocument(doc.id)} title={doc.name}>
                  <FileText size={25} strokeWidth={1.5} />
                  <strong>{doc.name}</strong>
                  <span>{String(doc.name?.split(".").at(-1) || "Источник").toUpperCase()}</span>
                </button>
              ))}
            </div>
            {!state.documents.length && <p className="workbench-placeholder">Добавьте файлы, на которые должна опираться команда.</p>}
            <Button variant="secondary full-width" onClick={() => navigate("library")}><Paperclip size={16} /> Файлы и папки</Button>
          </section>
        </aside>
      </div>
    </>
  );
}
