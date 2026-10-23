import React, { useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, BookOpen, ChevronDown, Clock,
  Compass, ExternalLink, FileText, MoreHorizontal, Paperclip, Pencil, PanelLeft,
  Save, Square, SquarePen, SlidersHorizontal, Sun, Moon, Trash2, Users,
} from "lucide-react";
import { ScreenProps } from "./App";
import { date, Item, safeUrl } from "./api";
import { Button, Field, IconButton, Markdown, Modal } from "./ui";

const activeStatuses = ["queued", "running", "wrapping_up"];
const statusNames: Record<string, string> = {
  queued: "В очереди", wrapping_up: "Сохраняет результаты", timed_out: "Время истекло",
  running: "В работе", completed: "Завершено", failed: "Ошибка", cancelled: "Остановлено",
};
const duration = (seconds: number) => `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;

export function Overview({
  state, settings, mutate, navigate, openDocument, activeChatId, selectChat, newChat,
  toggleSidebar, sidebarExpanded, theme, toggleTheme,
}: ScreenProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("team");
  const [model, setModel] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"documents" | "agents" | "settings" | "activity" | null>(null);
  const [runId, setRunId] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [chatDialog, setChatDialog] = useState<"rename" | "delete" | null>(null);
  const [chatTitle, setChatTitle] = useState("");
  const [savingChat, setSavingChat] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollEnd = useRef(true);
  const chat = (state.chats || []).find((item) => item.id === activeChatId);
  const chatRuns = state.runs.filter((run) => run.chat_id === activeChatId);
  const projectRunning = state.runs.filter((run) => activeStatuses.includes(run.status));
  const running = projectRunning.filter((run) => run.chat_id === activeChatId);
  const otherRunning = projectRunning.filter((run) => run.chat_id !== activeChatId);
  const runIds = new Set(chatRuns.map((run) => run.id));
  const messages = state.messages.filter((message) =>
    message.chat_id ? message.chat_id === activeChatId : runIds.has(message.run_id),
  );
  const selectedRun = chatRuns.find((run) => run.id === runId) || chatRuns.at(-1);
  const recentEvents = state.events.filter((event) => event.run_id === selectedRun?.id).slice(-60);
  const followupRun = selectedRun?.needs_followup ? selectedRun : null;
  const elapsed = selectedRun?.started_at
    ? Math.max(0, Math.floor(((selectedRun.finished_at ? Date.parse(selectedRun.finished_at) : Date.now()) - Date.parse(selectedRun.started_at)) / 1000)) : 0;
  const enabledAgents = state.agents.filter((agent) => agent.enabled);
  const models = settings?.providers.find((provider) => provider.id === settings.default_provider_id)?.models || [];

  useEffect(() => {
    if (scrollEnd.current && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages.length, activeChatId]);
  useEffect(() => {
    setDocs([]); setAgents([]); setPrompt(""); setScope(null); setRunId("");
    setAtBottom(true); scrollEnd.current = true;
  }, [state.project.id, activeChatId]);
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [prompt]);
  useEffect(() => {
    setChatDialog(null);
  }, [activeChatId]);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy || otherRunning.length > 0) return;
    setBusy(true);
    try {
      const targetChat = activeChatId || (await newChat())?.id;
      if (!targetChat) return;
      await mutate("/runs", {
        prompt: text, chat_id: targetChat, mode, model: model || undefined,
        document_ids: docs, agent_ids: agents,
      });
      setPrompt(""); setScope(null); setRunId("");
      scrollEnd.current = true; setAtBottom(true);
      inputRef.current?.focus();
    } catch {} finally { setBusy(false); }
  }
  async function saveMessage(message: Item) {
    try {
      await mutate("/workspace-documents", {
        title: `Результат · ${date(message.created_at)}`, content: message.content,
        format: "markdown", source_run_id: message.run_id,
      });
      navigate("documents");
    } catch {}
  }
  async function updateChat(event: React.FormEvent) {
    event.preventDefault();
    if (!chat || savingChat) return;
    setSavingChat(true);
    try {
      await mutate(`/chats/${chat.id}`, chatDialog === "rename" ? { title: chatTitle.trim() } : undefined, chatDialog === "rename" ? "PATCH" : "DELETE");
      setChatDialog(null);
    } catch {} finally { setSavingChat(false); }
  }
  function toggle(list: string[], id: string, set: React.Dispatch<React.SetStateAction<string[]>>) {
    set(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }
  function agentStatus(agent: Item) {
    const events = state.events.filter((event) => event.agent_id === agent.id && projectRunning.some((run) => run.id === event.run_id));
    const last = events.at(-1);
    if (!last) return { label: "Готов", tone: "ready" };
    if (["agent_completed", "completed"].includes(last.type)) return { label: "Готово", tone: "ready" };
    if (["agent_failed", "tool_error", "error"].includes(last.type)) return { label: "Ошибка", tone: "error" };
    return { label: "Работает", tone: "working" };
  }
  function jumpToBottom() {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
    scrollEnd.current = true; setAtBottom(true);
  }

  const scopeTitles = { documents: "Источники", agents: "Команда", settings: "Параметры", activity: "Ход работы" };
  const empty = messages.length === 0;

  return (
    <div className={`chat-workspace ${empty ? "is-empty" : "has-messages"}`}>
      <header className="chat-header">
        <div className="chat-header-leading">
          <IconButton className="icon-button chat-sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarExpanded ? "Свернуть боковую панель" : "Открыть боковую панель"} aria-controls="project-sidebar" title={sidebarExpanded ? "Свернуть боковую панель" : "Открыть боковую панель"}><PanelLeft size={20} /></IconButton>
          <button className="chat-model-trigger" onClick={() => setScope("settings")} title="Модель и параметры">
            <span>Science Hub</span><ChevronDown size={14} />
          </button>
          <span className="chat-header-divider" />
          <span className="chat-header-title" title={chat?.title || state.project.name}>{chat?.title || state.project.name}</span>
        </div>
        <div className="chat-header-actions">
          <IconButton onClick={toggleTheme} aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"} title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</IconButton>
          <IconButton className={`icon-button chat-activity-trigger ${running.length ? "is-running" : ""}`} onClick={() => setScope("activity")} aria-label="Ход работы" title="Ход работы"><Activity size={18} /></IconButton>
          {chat && <details className="chat-actions-menu">
            <summary aria-label="Действия с чатом" title="Действия с чатом"><MoreHorizontal size={20} /></summary>
            <div className="chat-menu-items">
              <button onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setChatTitle(chat.title || ""); setChatDialog("rename"); }}><Pencil size={15} />Переименовать</button>
              <button disabled={running.length > 0} title={running.length ? "Сначала остановите задачу" : undefined} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setChatDialog("delete"); }}><Trash2 size={15} />Удалить чат</button>
            </div>
          </details>}
          <IconButton className="icon-button chat-new-shortcut" onClick={() => void newChat()} aria-label="Новый чат" title="Новый чат"><SquarePen size={19} /></IconButton>
        </div>
      </header>

      <section className="chat-conversation" aria-label="Чат с оркестратором">
        <div className="chat-scroll" ref={messagesRef} onScroll={() => {
          const element = messagesRef.current;
          if (!element) return;
          const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          scrollEnd.current = bottom; setAtBottom(bottom);
        }}>
          {empty ? <div className="chat-welcome">
            <Compass size={29} strokeWidth={1.4} aria-hidden="true" />
            <h1>Что исследуем сегодня?</h1>
            <p>От первого вопроса до нового открытия.</p>
          </div> : <div className="chat-thread" aria-live="polite" aria-relevant="additions">
            {messages.map((message) => {
              const kind = message.role === "user" ? "user" : message.role === "system" ? "system" : message.role === "agent" ? "agent" : "orchestrator";
              const name = kind === "user" ? "Вы" : kind === "system" ? "Система" : kind === "agent" ? message.agent_name || "Агент" : "Science Hub";
              return <article key={message.id} className={`chat-message chat-message-${kind}`} aria-label={`Сообщение: ${name}`}>
                {kind !== "user" && <div className="chat-message-author"><span>{kind === "agent" ? <Users size={17} /> : <Compass size={18} />}</span><strong>{name}</strong></div>}
                <div className="chat-message-content"><Markdown text={message.content || ""} /></div>
                {!!message.sources?.length && <details className="chat-message-sources">
                  <summary><BookOpen size={14} />Источники · {message.sources.length}<ChevronDown size={13} /></summary>
                  <div>{message.sources.map((source: any, index: number) => typeof source === "string" ? <span key={index} className="source-chip">{source}</span> : source.document_id || (source.type === "document" && source.id) ? (
                    <button key={index} className="source-chip" onClick={() => openDocument(source.document_id || source.id, source.page || 1, source.quote || source.text || "")}><FileText size={12} />{source.document_name || source.name || source.title || "Источник"} · {source.page || 1}</button>
                  ) : source.url ? (
                    <a key={index} className="source-chip" target="_blank" rel="noreferrer" href={safeUrl(source.url)}><ExternalLink size={12} />{source.title || source.url}</a>
                  ) : <span className="source-chip" key={index}>{source.title || source.name || ({ calculation: "Расчёт", agent_statement: "Вывод специалиста", workspace_document: "Рабочий документ" } as Record<string, string>)[source.type] || "Материал проекта"}</span>)}</div>
                </details>}
                {kind !== "user" && <div className="chat-message-footer">
                  {["orchestrator", "agent"].includes(kind) && <IconButton title="Сохранить в документы" aria-label="Сохранить ответ в документы" onClick={() => void saveMessage(message)}><Save size={15} /></IconButton>}
                  <time dateTime={message.created_at}>{date(message.created_at)}</time>
                </div>}
              </article>;
            })}
            {running.length > 0 && <button className="chat-thinking" onClick={() => setScope("activity")}><span className="chat-working-dot" />Команда работает над задачей<ChevronDown size={13} /></button>}
          </div>}
        </div>
        {!atBottom && <button className="chat-scroll-bottom" onClick={jumpToBottom} aria-label="К новым сообщениям"><ArrowDown size={18} /></button>}

        <div className="chat-composer-wrap">
          {otherRunning.length > 0 && <div className="chat-notice" role="status"><Activity size={16} /><span>Команда работает в другом чате.</span><button onClick={() => selectChat(otherRunning[0].chat_id)}>Открыть <ArrowRight size={13} /></button></div>}
          {followupRun && <div className="chat-notice"><Clock size={16} /><span>Промежуточный результат сохранён.</span><button onClick={() => { setPrompt(`Продолжи исследование по предыдущей задаче: ${followupRun.prompt}. Учти сохранённые результаты и укажи, что осталось выполнить.`); inputRef.current?.focus(); }}>Продолжить <ArrowRight size={13} /></button></div>}
          {running.map((run) => <div className="chat-notice" key={run.id} role="status"><span className="chat-working-dot" /><button className="chat-run-status" onClick={() => setScope("activity")}>{statusNames[run.status]}</button><button onClick={() => mutate(`/runs/${run.id}/cancel`, {}).catch(() => {})}><Square size={12} />Остановить</button></div>)}
          <form className="chat-composer" onSubmit={submit} aria-label="Новое сообщение">
            <textarea ref={inputRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Задайте вопрос или опишите идею…" rows={1} aria-label="Сообщение оркестратору" onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            }} />
            <div className="chat-composer-toolbar">
              <div className="chat-composer-tools">
                <button type="button" className={docs.length ? "is-selected" : ""} onClick={() => setScope("documents")} aria-label="Выбрать источники" title="Источники проекта"><Paperclip size={19} />{!!docs.length && <span>{docs.length}</span>}</button>
                <button type="button" className={agents.length ? "is-selected" : ""} onClick={() => setScope("agents")} aria-label="Выбрать команду" title="Команда"><Users size={19} />{!!agents.length && <span>{agents.length}</span>}</button>
                <button type="button" onClick={() => setScope("settings")} aria-label="Параметры чата" title="Параметры чата"><SlidersHorizontal size={18} /></button>
              </div>
              <button type="button" className="chat-mode-trigger" onClick={() => setScope("settings")}>{mode === "team" ? "Исследование" : "Быстрый ответ"}<ChevronDown size={12} /></button>
              <button className="chat-send" type="submit" disabled={busy || !prompt.trim() || otherRunning.length > 0} aria-label="Отправить сообщение" aria-busy={busy}>{busy ? <span className="chat-sending" /> : <ArrowUp size={21} />}</button>
            </div>
          </form>
          {empty && <div className="chat-starters" aria-label="С чего начать">
            <button onClick={() => { setPrompt("Проанализируй материалы и доску проекта. Выдели ключевые факты, противоречия и вопросы, на которые пока нет ответа."); inputRef.current?.focus(); }}><BookOpen size={15} />Разобрать материалы</button>
            <button onClick={() => { setPrompt("Составь план исследования проекта: уточни исходные данные, предложи этапы и распредели задачи между специалистами."); inputRef.current?.focus(); }}><Compass size={15} />Составить план</button>
          </div>}
          {!empty && <p className="chat-disclaimer">Проверяйте важные выводы по первоисточникам.</p>}
        </div>
      </section>
      {empty && <div className="chat-empty-footer"><span />Материалы и история остаются в вашем проекте</div>}

      {scope && <Modal title="Контекст чата" onClose={() => setScope(null)}>
        <div className="chat-details">
          <div className="chat-details-tabs" aria-label="Разделы контекста">
            {(Object.keys(scopeTitles) as Array<keyof typeof scopeTitles>).map((tab) => <button key={tab} aria-pressed={scope === tab} onClick={() => setScope(tab)}>{scopeTitles[tab]}</button>)}
          </div>
          <div className="chat-details-content">
            <h3>{scopeTitles[scope]}</h3>
            {(scope === "documents" || scope === "agents") && <>
              <p>{scope === "documents" ? "Выберите материалы, на которых нужно сфокусироваться. Без выбора доступны все источники проекта." : "Выберите специалистов для задачи. Без выбора оркестратор сам подключит нужных агентов."}</p>
              {scope === "agents" && <div className="chat-orchestrator"><Compass size={20} /><div><strong>Оркестратор</strong><small>{otherRunning.length ? "Работает в другом чате" : running.length ? statusNames[running.at(-1)!.status] : "Готов к работе"}</small></div><span className={projectRunning.length ? "chat-working-dot" : "chat-ready-dot"} /></div>}
              <div className="chat-selection-heading"><span>{scope === "documents" ? `Материалы · ${state.documents.length}` : `Специалисты · ${enabledAgents.length}`}</span><button onClick={() => scope === "documents" ? setDocs([]) : setAgents([])}>Сбросить</button></div>
              <div className="chat-selection-list">
                {(scope === "documents" ? state.documents : enabledAgents).map((item) => <label key={item.id}>
                  <input type="checkbox" checked={(scope === "documents" ? docs : agents).includes(item.id)} onChange={() => scope === "documents" ? toggle(docs, item.id, setDocs) : toggle(agents, item.id, setAgents)} />
                  <span><strong>{item.name}</strong>{scope === "agents" && <small>{agentStatus(item).label}{item.role ? ` · ${item.role}` : ""}</small>}</span>
                </label>)}
                {!(scope === "documents" ? state.documents : enabledAgents).length && <div className="chat-details-empty">{scope === "documents" ? <BookOpen size={28} strokeWidth={1.3} /> : <Users size={28} strokeWidth={1.3} />}<p>{scope === "documents" ? "Добавьте материалы, чтобы исследовать их вместе." : "Добавьте специалистов для командной работы."}</p></div>}
              </div>
              <button className="chat-details-link" onClick={() => navigate(scope === "documents" ? "library" : "agents")}>{scope === "documents" ? "Открыть базу знаний" : "Настроить команду"}<ArrowRight size={15} /></button>
            </>}
            {scope === "settings" && <>
              <p>Выберите подходящий режим и модель. Параметры применятся к следующему сообщению.</p>
              <Field label="Режим работы"><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="team">Исследование с командой</option><option value="chat">Быстрый ответ</option></select></Field>
              <Field label="Модель"><select value={model} onChange={(event) => setModel(event.target.value)}><option value="">{settings?.orchestrator_model || "Модель из настроек"}</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></Field>
              <button className="chat-details-link" onClick={() => navigate("settings")}>Все настройки<ArrowRight size={15} /></button>
            </>}
            {scope === "activity" && <>
              <p>Обращения к источникам, действия команды и сохранённые результаты.</p>
              {chatRuns.length > 1 && <Field label="Задача"><select value={selectedRun?.id || ""} onChange={(event) => setRunId(event.target.value)}>{chatRuns.slice().reverse().map((run) => <option key={run.id} value={run.id}>{String(run.prompt).slice(0, 80)}</option>)}</select></Field>}
              {selectedRun && <div className="chat-run-summary"><span>{statusNames[selectedRun.status] || selectedRun.status}</span><span><Clock size={13} />{duration(elapsed)}</span><small>{selectedRun.usage?.calls || 0} вызовов модели</small></div>}
              {selectedRun?.status === "wrapping_up" && <p className="chat-notice">Время исследования истекло. Команда сохраняет результаты.</p>}
              <div className="chat-events" role="log" aria-label="Действия команды">{recentEvents.map((event) => <div key={event.id} className={["error", "tool_error", "timed_out", "agent_failed"].includes(event.type) ? "has-error" : ""}><span /><p>{event.message}<time>{date(event.created_at)}</time></p></div>)}</div>
              {!recentEvents.length && <div className="chat-details-empty"><Activity size={28} strokeWidth={1.3} /><p>{selectedRun ? "Задача ожидает запуска." : "Ход работы появится здесь после первого сообщения."}</p></div>}
            </>}
          </div>
          <Button variant="secondary" onClick={() => setScope(null)}>Вернуться к чату</Button>
        </div>
      </Modal>}
      {chatDialog && <Modal title={chatDialog === "rename" ? "Название чата" : "Удалить чат?"} onClose={() => !savingChat && setChatDialog(null)}>
        <form onSubmit={updateChat}>
          {chatDialog === "rename" ? <Field label="Название"><input autoFocus required maxLength={160} value={chatTitle} onChange={(event) => setChatTitle(event.target.value)} /></Field> : <p className="chat-delete-explanation">Чат «{chat?.title}» и его переписка будут удалены. Материалы проекта и сохранённые документы останутся доступны.</p>}
          <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setChatDialog(null)} disabled={savingChat}>Отмена</Button><Button busy={savingChat} disabled={chatDialog === "rename" && !chatTitle.trim()} variant={chatDialog === "delete" ? "danger" : ""}>{chatDialog === "rename" ? "Сохранить" : "Удалить чат"}</Button></div>
        </form>
      </Modal>}
    </div>
  );
}
