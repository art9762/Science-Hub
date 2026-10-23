import React, { useEffect, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, BookOpen, ChevronDown, Clock,
  Compass, ExternalLink, FileText, Info, Paperclip, Pencil, Plus,
  Save, Square, Trash2, UserRound, Users, X,
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
}: ScreenProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("team");
  const [model, setModel] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"documents" | "agents" | null>(null);
  const [runId, setRunId] = useState("");
  const [logOpen, setLogOpen] = useState(false);
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
    setLogOpen(false); setAtBottom(true); scrollEnd.current = true;
  }, [state.project.id, activeChatId]);
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [prompt]);
  useEffect(() => {
    if (!scope) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setScope(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [scope]);

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

  return (
    <div className="conversation-workspace">
      <header className="conversation-heading">
        <div className="conversation-title">
          <p>{state.project.name}</p>
          <h1>{chat?.title || "Новый чат"}</h1>
        </div>
        <div className="conversation-actions">
          {chat && <>
            <IconButton onClick={() => { setChatTitle(chat.title || ""); setChatDialog("rename"); }} aria-label="Переименовать чат" title="Переименовать чат"><Pencil size={17} /></IconButton>
            <IconButton onClick={() => setChatDialog("delete")} aria-label="Удалить чат" title={running.length ? "Остановите задачи, чтобы удалить чат" : "Удалить чат"} disabled={running.length > 0}><Trash2 size={17} /></IconButton>
          </>}
          <Button variant="secondary small" onClick={() => void newChat()}><Plus size={16} /><span>Новый чат</span></Button>
        </div>
      </header>

      <section className="team-status-strip" aria-label="Статусы команды">
        <div className={`team-status-member orchestrator-status ${projectRunning.length ? "working" : "ready"}`}>
          <Compass size={17} /><strong>Оркестратор</strong>
          <span className="team-status-dot" />
          <span>{otherRunning.length ? "В другом чате" : running.length ? statusNames[running.at(-1)!.status] : "Готов"}</span>
        </div>
        {enabledAgents.map((agent) => {
          const status = agentStatus(agent);
          return <div key={agent.id} className={`team-status-member ${status.tone}`} title={agent.role || agent.name}>
            <Users size={15} /><strong>{agent.name}</strong><span className="team-status-dot" /><span>{status.label}</span>
          </div>;
        })}
        {!enabledAgents.length && <button className="team-add-agent" onClick={() => navigate("agents")}><Plus size={14} /> Добавить агента</button>}
      </section>

      <section className="conversation-panel panel" aria-label="Чат с оркестратором">
        <div className="conversation-scroll-area">
        <div className="conversation-messages messages" ref={messagesRef} onScroll={() => {
          const element = messagesRef.current;
          if (!element) return;
          const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
          scrollEnd.current = bottom; setAtBottom(bottom);
        }}>
          {!messages.length ? (
            <div className="chat-empty conversation-empty">
              <span className="conversation-empty-icon"><Compass size={32} strokeWidth={1.5} /></span>
              <h2>Что исследуем сегодня?</h2>
              <p>Обсудите задачу с оркестратором. Команда работает с материалами, документами и доской этого проекта.</p>
              <div className="workbench-suggestions">
                <button onClick={() => { setPrompt("Проанализируй материалы и доску проекта. Выдели ключевые факты, противоречия и вопросы, на которые пока нет ответа."); inputRef.current?.focus(); }}><BookOpen size={16} /> Разобрать проект</button>
                <button onClick={() => { setPrompt("Составь план исследования проекта: уточни исходные данные, предложи этапы и распредели задачи между специалистами."); inputRef.current?.focus(); }}><Users size={16} /> Составить план</button>
              </div>
              <small>У каждого чата своя переписка. Материалы проекта общие.</small>
            </div>
          ) : <div className="conversation-thread">
            {messages.map((message) => {
              const kind = message.role === "user" ? "user" : message.role === "system" ? "system" : message.role === "agent" ? "agent" : "orchestrator";
              const name = kind === "user" ? "Вы" : kind === "system" ? "Система" : kind === "agent" ? message.agent_name || "Агент" : "Оркестратор";
              return <article key={message.id} className={`message conversation-message ${kind}-message`} aria-label={`Сообщение: ${name}`}>
                <div className="message-head">
                  <span className={`message-avatar ${kind}`}>
                    {kind === "user" ? <UserRound size={17} /> : kind === "system" ? <Info size={17} /> : kind === "agent" ? <Users size={17} /> : <Compass size={18} />}
                  </span>
                  <strong>{name}</strong>
                  {kind === "agent" && <span className="message-role-label">Агент</span>}
                  <time dateTime={message.created_at}>{date(message.created_at)}</time>
                  {["orchestrator", "agent"].includes(kind) && <IconButton title="Сохранить в документы" aria-label="Сохранить ответ в документы" onClick={() => void saveMessage(message)}><Save size={15} /></IconButton>}
                </div>
                <div className="message-body"><Markdown text={message.content || ""} /></div>
                {!!message.sources?.length && <div className="message-sources">
                  {message.sources.map((source: any, index: number) => typeof source === "string" ? <span key={index} className="source-chip">{source}</span> : source.document_id || (source.type === "document" && source.id) ? (
                    <button key={index} className="source-chip" onClick={() => openDocument(source.document_id || source.id, source.page || 1, source.quote || source.text || "")}><FileText size={12} />{source.document_name || source.name || source.title || "Источник"} · {source.page || 1}</button>
                  ) : source.url ? (
                    <a key={index} className="source-chip" target="_blank" rel="noreferrer" href={safeUrl(source.url)}><ExternalLink size={12} />{source.title || source.url}</a>
                  ) : <span className="source-chip" key={index}>{source.title || source.name || ({ calculation: "Расчёт", agent_statement: "Вывод специалиста", workspace_document: "Рабочий документ" } as Record<string, string>)[source.type] || "Материал проекта"}</span>)}
                </div>}
              </article>;
            })}
            {running.length > 0 && <div className="thinking" role="status"><span /><span /><span />Команда работает над задачей…</div>}
          </div>}
        </div>
        {!atBottom && <button className="conversation-scroll-bottom" onClick={jumpToBottom}><ArrowDown size={16} /> К новым сообщениям</button>}
        </div>

        <div className="conversation-composer composer-wrap">
          {otherRunning.length > 0 && <div className="running-banner conversation-other-chat"><Activity size={15} className="pulse" /><span>Команда работает в другом чате. Новую задачу можно отправить после завершения.</span><button onClick={() => selectChat(otherRunning[0].chat_id)}>Открыть чат <ArrowRight size={13} /></button></div>}
          {followupRun && <div className="limit-banner"><Clock size={16} /><span>Сохранён промежуточный результат. Исследование можно продолжить.</span><button className="text-link" onClick={() => { setPrompt(`Продолжи исследование по предыдущей задаче: ${followupRun.prompt}. Учти сохранённые результаты и укажи, что осталось выполнить.`); inputRef.current?.focus(); }}>Продолжить <ArrowRight size={14} /></button></div>}
          {running.map((run) => <div className="running-banner" key={run.id}><Activity size={15} className="pulse" /><span>{statusNames[run.status]} · {String(run.prompt).slice(0, 85)}</span><button onClick={() => mutate(`/runs/${run.id}/cancel`, {}).catch(() => {})}><Square size={12} /> Остановить</button></div>)}
          {scope && <div className="scope-popover">
            <div className="scope-heading"><strong>{scope === "documents" ? "Источники для этой задачи" : "Состав команды"}</strong><div><button onClick={() => scope === "documents" ? setDocs([]) : setAgents([])}>Сбросить</button><IconButton onClick={() => setScope(null)} aria-label="Закрыть выбор"><X size={16} /></IconButton></div></div>
            <p>{scope === "documents" ? "Выбранные источники будут в фокусе. Все материалы проекта остаются доступны команде." : "Без выбора оркестратор сам подключит нужных агентов."}</p>
            <div className="scope-list">
              {(scope === "documents" ? state.documents : enabledAgents).map((item) => <label key={item.id}><input type="checkbox" checked={(scope === "documents" ? docs : agents).includes(item.id)} onChange={() => scope === "documents" ? toggle(docs, item.id, setDocs) : toggle(agents, item.id, setAgents)} /><span>{item.name}</span></label>)}
              {!(scope === "documents" ? state.documents : enabledAgents).length && <small>Пока ничего не добавлено.</small>}
            </div>
          </div>}
          <form className="composer" onSubmit={submit}>
            <textarea ref={inputRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Задайте вопрос или опишите задачу…" rows={2} aria-label="Сообщение оркестратору" onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
            }} />
            <div className="composer-toolbar"><div className="composer-controls">
              <button type="button" className={scope === "documents" ? "selected" : ""} aria-expanded={scope === "documents"} onClick={() => setScope(scope === "documents" ? null : "documents")}><Paperclip size={16} /><span>{docs.length ? `${docs.length} источников` : "Весь проект"}</span></button>
              <button type="button" className={scope === "agents" ? "selected" : ""} aria-expanded={scope === "agents"} onClick={() => setScope(scope === "agents" ? null : "agents")}><Users size={16} /><span>{agents.length ? `${agents.length} агентов` : "Команда"}</span></button>
              <select aria-label="Режим работы" value={mode} onChange={(event) => setMode(event.target.value)}><option value="team">Командная работа</option><option value="chat">Быстрый ответ</option></select>
            </div><button className="send-button" type="submit" disabled={busy || !prompt.trim() || otherRunning.length > 0} aria-label="Отправить сообщение"><ArrowUp size={21} /></button></div>
          </form>
          <div className="composer-bottom"><label><span className="model-dot" /><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="Модель для задачи"><option value="">{settings?.orchestrator_model || "Модель из настроек"}</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select><ChevronDown size={11} /></label><span>Enter · отправить &nbsp; Shift + Enter · новая строка</span></div>
        </div>

        <section className={`conversation-progress ${logOpen ? "expanded" : ""}`} aria-label="Ход решения">
          <div className="conversation-progress-heading">
            <button className="progress-toggle" onClick={() => setLogOpen(!logOpen)} aria-expanded={logOpen}><Activity size={16} /><strong>Ход решения</strong>{selectedRun && <span>{statusNames[selectedRun.status] || selectedRun.status}</span>}<ChevronDown size={15} /></button>
            {selectedRun && <span className="progress-summary"><Clock size={13} />{duration(elapsed)}<span>· {selectedRun.usage?.calls || 0} вызовов</span></span>}
          </div>
          {logOpen && <div className="conversation-progress-body">
            {chatRuns.length > 1 && <select value={selectedRun?.id || ""} onChange={(event) => setRunId(event.target.value)} aria-label="Задача для просмотра хода решения">{chatRuns.slice().reverse().map((run) => <option key={run.id} value={run.id}>{String(run.prompt).slice(0, 80)}</option>)}</select>}
            {selectedRun?.status === "wrapping_up" && <p className="run-deadline">Время исследования истекло. Команда сохраняет результаты перед остановкой.</p>}
            <div className="conversation-events" role="log" aria-label="Действия команды">
              {recentEvents.map((event) => <div key={event.id} className={`workbench-event ${["error", "tool_error", "timed_out", "agent_failed"].includes(event.type) ? "error" : ""}`}><span className="event-dot" /><p>{event.message}</p><time>{date(event.created_at)}</time></div>)}
              {!recentEvents.length && <p className="workbench-placeholder">{selectedRun ? "Задача ожидает запуска." : "Здесь появятся действия команды, обращения к источникам и сохранённые результаты."}</p>}
            </div>
          </div>}
        </section>
      </section>
      {chatDialog && <Modal title={chatDialog === "rename" ? "Название чата" : "Удалить чат?"} onClose={() => !savingChat && setChatDialog(null)}>
        <form onSubmit={updateChat}>
          {chatDialog === "rename" ? <Field label="Название"><input autoFocus required maxLength={160} value={chatTitle} onChange={(event) => setChatTitle(event.target.value)} /></Field> : <p className="chat-delete-explanation">Чат «{chat?.title}» и его переписка будут удалены. Материалы проекта и сохранённые документы останутся доступны.</p>}
          <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setChatDialog(null)} disabled={savingChat}>Отмена</Button><Button busy={savingChat} disabled={chatDialog === "rename" && !chatTitle.trim()} variant={chatDialog === "delete" ? "danger" : ""}>{chatDialog === "rename" ? "Сохранить" : "Удалить чат"}</Button></div>
        </form>
      </Modal>}
    </div>
  );
}
