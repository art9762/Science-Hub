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
  Sparkles,
  Activity,
  Square,
  Check,
  Clock,
  ArrowRight,
  Layers,
  Lightbulb,
  Target,
  Globe,
  ExternalLink,
  Save,
  Filter,
  MessageSquare,
} from "lucide-react";
import { ScreenProps } from "./App";
import { date, Item, safeUrl } from "./api";
import { Button, IconButton, Tag, Markdown } from "./ui";
const statusNames: Record<string, string> = {
  queued: "В очереди",
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
    ["queued", "running"].includes(r.status),
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
  const recentEvents = state.events.slice(-6).reverse();
  const toggle = (
    list: string[],
    id: string,
    set: React.Dispatch<React.SetStateAction<string[]>>,
  ) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <>
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">
            ОБЗОР ПРОЕКТА <span className="eyebrow-line" />
          </span>
          <h1>
            {state.project.name}
            <span className="title-dot">.</span>
          </h1>
          <p>
            {state.project.description ||
              "Собирайте знания. Задавайте вопросы. Создавайте вместе."}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate("library")}>
          <Paperclip size={16} />
          Добавить материалы
          <ArrowUpRight size={16} />
        </Button>
      </div>
      <div className="stats-grid">
        {[
          {
            label: "Источников в базе",
            value: state.documents.length,
            icon: BookOpen,
            tone: "peach",
            screen: "library" as const,
            small: "Ваш исследовательский контекст",
          },
          {
            label: "Агентов в команде",
            value: state.agents.filter((a) => a.enabled).length,
            icon: Users,
            tone: "mint",
            screen: "agents" as const,
            small: `${running.length ? `${running.length} задач в работе` : "Готовы к следующей задаче"}`,
          },
          {
            label: "Рабочих документов",
            value: state.workspace_documents.length,
            icon: FileText,
            tone: "lavender",
            screen: "documents" as const,
            small: "От идеи до готового отчёта",
          },
          {
            label: "Решений в проекте",
            value: state.decisions.length,
            icon: Layers,
            tone: "sand",
            screen: "graph" as const,
            small: "Аргументы, альтернативы и связи",
          },
        ].map((card) => (
          <button
            className="stat-card"
            key={card.label}
            onClick={() => navigate(card.screen)}
          >
            <div className={`stat-icon ${card.tone}`}>
              <card.icon size={21} strokeWidth={1.6} />
            </div>
            <ArrowUpRight className="stat-arrow" size={16} />
            <div className="stat-number">
              {card.value.toString().padStart(2, "0")}
            </div>
            <strong>{card.label}</strong>
            <small>{card.small}</small>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
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
                    "Один вопрос — вся команда в деле"
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
                        ? "Лимит шагов · требуется продолжение"
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
              <div className="chat-empty">
                <div className="sparkle-illustration">
                  <span />
                  <Sparkles size={29} strokeWidth={1.3} />
                  <span />
                </div>
                <span className="eyebrow">
                  БОЛЬШИЕ ИДЕИ НАЧИНАЮТСЯ С ВОПРОСА
                </span>
                <h2>Над чем поработаем сегодня?</h2>
                <p>
                  Поставьте задачу. Я соберу контекст, подключу специалистов
                  <br className="desktop-only" /> и помогу разобраться — от
                  гипотезы до решения.
                </p>
                <div className="suggestions">
                  <button
                    onClick={() =>
                      setPrompt(
                        "Проанализируй материалы проекта. Выдели ключевые факты, противоречия и вопросы, на которые пока нет ответа.",
                      )
                    }
                  >
                    <BookOpen size={17} />
                    <span>
                      Разобрать материалы
                      <small>Найти главное в источниках</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                  <button
                    onClick={() =>
                      setPrompt(
                        "Помоги спланировать исследование проекта. Сначала определи, каких исходных данных не хватает, затем предложи этапы работы команды.",
                      )
                    }
                  >
                    <Lightbulb size={17} />
                    <span>
                      Исследовать идею
                      <small>От гипотезы к плану действий</small>
                    </span>
                    <ArrowUpRight size={15} />
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
            {state.runs
              .filter((r) => r.needs_followup || r.outcome === "budget_limited")
              .slice(-1)
              .map((r) => (
                <div className="limit-banner" key={r.id}>
                  <Clock size={14} />
                  <span>
                    Достигнут лимит шагов. Результат требует продолжения.
                  </span>
                  <button
                    className="text-link"
                    onClick={() =>
                      setPrompt(
                        `Продолжи исследование по предыдущей задаче: ${r.prompt}. Учти уже найденные результаты, незавершённые шаги и ограничения.`,
                      )
                    }
                  >
                    Продолжить
                    <ArrowRight size={12} />
                  </button>
                </div>
              ))}
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
                    Выбрать всё
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
        <aside className="dashboard-right">
          <section className="panel team-panel">
            <div className="small-panel-heading">
              <h2>Ваша команда</h2>
              <button
                onClick={() => navigate("agents")}
                aria-label="Открыть офис агентов"
              >
                <ArrowUpRight size={17} />
              </button>
            </div>
            <p className="panel-subtitle">
              Специалисты с разными точками зрения
            </p>
            <div className="team-list">
              {state.agents.slice(0, 5).map((a, i) => {
                const isActive = running.some((r) =>
                  state.events
                    .slice(-4)
                    .some((e) => e.run_id === r.id && e.agent_id === a.id),
                );
                return (
                  <button key={a.id} onClick={() => navigate("agents")}>
                    <span
                      className={`agent-avatar avatar-${i % 5}`}
                      style={{ borderColor: a.color || undefined }}
                    >
                      {a.name.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{a.name}</strong>
                      <small>{a.model || "Модель оркестратора"}</small>
                    </span>
                    <span
                      className={`agent-state ${isActive ? "working" : ""}`}
                    >
                      {isActive ? "Работает" : a.enabled ? "Готов" : "Пауза"}
                    </span>
                  </button>
                );
              })}
            </div>
            {state.agents.length > 5 && (
              <button className="text-link" onClick={() => navigate("agents")}>
                Вся команда · {state.agents.length} агентов
                <ArrowRight size={14} />
              </button>
            )}
            {!state.agents.length && (
              <p className="muted">
                Создайте первого специалиста в офисе агентов.
              </p>
            )}
          </section>
          <section className="project-pulse panel">
            <div className="small-panel-heading">
              <h2>Фокус проекта</h2>
              <Target size={17} />
            </div>
            <div className="focus-copy">
              <span className="focus-icon">
                <Lightbulb size={20} />
              </span>
              <strong>
                {!state.documents.length
                  ? "Начните с контекста"
                  : !state.messages.length
                    ? "Время задать первый вопрос"
                    : state.claims.some((c) => c.status === "disputed")
                      ? "Есть спорные утверждения"
                      : "Следующий шаг — за вами"}
              </strong>
              <p>
                {!state.documents.length
                  ? "Добавьте исходные материалы. Это поможет команде опираться на факты вашего проекта."
                  : !state.messages.length
                    ? "Материалы на месте. Попросите команду выделить главное и найти пробелы в данных."
                    : state.claims.some((c) => c.status === "disputed")
                      ? "Посмотрите источники и аргументы в графе, затем поручите команде дополнительную проверку."
                      : "Продолжайте исследование, уточняйте решения и сохраняйте полезные результаты."}
              </p>
            </div>
            <button
              className="text-link"
              onClick={() =>
                navigate(!state.documents.length ? "library" : "graph")
              }
            >
              {!state.documents.length
                ? "Добавить источники"
                : "Открыть граф проекта"}
              <ArrowRight size={14} />
            </button>
          </section>
          <section className="activity-panel">
            <div className="small-panel-heading">
              <h2>Ход работы</h2>
              <Activity size={16} />
            </div>
            {recentEvents.length ? (
              <div className="event-list">
                {recentEvents.map((e) => (
                  <div key={e.id}>
                    <span
                      className={`event-dot ${e.type === "error" ? "error" : ""}`}
                    />
                    <p>{e.message}</p>
                    <time>{date(e.created_at)}</time>
                  </div>
                ))}
              </div>
            ) : (
              <div className="activity-empty">
                <span className="event-dot" />
                <p>
                  Здесь появятся действия команды
                  <small>История начинается с первой задачи</small>
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
