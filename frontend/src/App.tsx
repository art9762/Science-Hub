import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Atom,
  LayoutDashboard,
  Library,
  Users,
  FileText,
  Network,
  StickyNote,
  Settings as SettingsIcon,
  Plus,
  ArrowRight,
  ChevronDown,
  Search,
  X,
  Menu,
  FolderOpen,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { api, Item, State, Settings } from "./api";
import { Button, Modal, Field, IconButton } from "./ui";
import { Overview } from "./Overview";
import { LibraryScreen, DocumentViewer } from "./Library";
import { AgentsScreen, WorkspaceScreen, SettingsScreen } from "./Editors";
import { GraphScreen, BoardScreen } from "./Visual";
export type Screen =
  | "overview"
  | "library"
  | "agents"
  | "documents"
  | "graph"
  | "board"
  | "settings";
export type ScreenProps = {
  pid: string;
  state: State;
  settings: Settings | null;
  refresh: () => Promise<void>;
  mutate: (path: string, data?: unknown, method?: string) => Promise<any>;
  onError: (error: unknown) => void;
  openDocument: (
    id: string,
    page?: number,
    quote?: string,
    start?: number,
    end?: number,
  ) => void;
  navigate: (screen: Screen) => void;
};
const nav = [
  { id: "overview", label: "Рабочий стол", icon: LayoutDashboard },
  { id: "library", label: "База знаний", icon: Library },
  { id: "agents", label: "Офис агентов", icon: Users },
  { id: "documents", label: "Документы", icon: FileText },
  { id: "graph", label: "Граф и решения", icon: Network },
  { id: "board", label: "Доска проекта", icon: StickyNote },
] as const;
export default function App() {
  const [projects, setProjects] = useState<Item[]>([]),
    [pid, setPid] = useState(localStorage.getItem("science-hub-project") || ""),
    [state, setState] = useState<State | null>(null),
    [settings, setSettings] = useState<Settings | null>(null),
    [screen, setScreen] = useState<Screen>("overview");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("science-hub-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("science-hub-theme", theme); } catch {}
  }, [theme]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [projectModal, setProjectModal] = useState(false),
    [projectName, setProjectName] = useState(""),
    [description, setDescription] = useState(""),
    [saving, setSaving] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [search, setSearch] = useState("");
  const [viewer, setViewer] = useState<{
    id: string;
    page: number;
    quote: string;
    start?: number;
    end?: number;
  } | null>(null);
  const currentPid = useRef(pid);
  currentPid.current = pid;
  const onError = useCallback(
    (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    [],
  );
  const loadProjects = useCallback(async () => {
    const list = await api<Item[]>("/projects");
    setProjects(list);
    setPid((current) =>
      list.some((p) => p.id === current) ? current : list[0]?.id || "",
    );
    return list;
  }, []);
  const refresh = useCallback(async () => {
    if (!pid) return;
    const result = await api<State>(`/projects/${pid}/state`);
    if (currentPid.current === pid) setState(result);
  }, [pid]);
  useEffect(() => {
    void loadProjects()
      .catch(onError)
      .finally(() => setLoading(false));
    void api<Settings>("/settings").then(setSettings).catch(onError);
  }, [loadProjects, onError]);
  useEffect(() => {
    localStorage.setItem("science-hub-project", pid);
    setState(null);
    setViewer(null);
    if (!pid) return;
    let alive = true;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        await refresh();
      } catch (e) {
        if (alive) onError(e);
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (!document.hidden) void poll();
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pid, refresh, onError]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 10000);
    return () => clearTimeout(timer);
  }, [error]);
  const mutate = useCallback(
    async (path: string, data?: unknown, method?: string) => {
      try {
        const result = await api(`/projects/${pid}${path}`, data, method);
        await refresh();
        return result;
      } catch (e) {
        onError(e);
        throw e;
      }
    },
    [pid, refresh, onError],
  );
  useEffect(() => { window.scrollTo(0, 0); }, [screen, pid]);
  const navigate = (next: Screen) => {
    setScreen(next);
    setSidebar(false);
  };
  const openDocument = (
    id: string,
    page = 1,
    quote = "",
    start?: number,
    end?: number,
  ) => setViewer({ id, page, quote, start, end });
  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await api<Item>("/projects", {
        name: projectName.trim(),
        description: description.trim(),
      });
      await loadProjects();
      setPid(created.id);
      setProjectModal(false);
      setProjectName("");
      setDescription("");
      setScreen("overview");
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }
  const activeRuns =
    state?.runs.filter((r) => ["queued", "running", "wrapping_up"].includes(r.status)) || [];
  const props: ScreenProps = {
    pid,
    state: state!,
    settings,
    refresh,
    mutate,
    onError,
    openDocument,
    navigate,
  };
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          onClick={() => setSidebar(false)}
          aria-label="Закрыть меню"
        />
      )}
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <Atom size={24} strokeWidth={1.6} />
          </span>
          <span>
            science<span className="brand-light">hub</span>

          </span>
        </a>
        <div className="project-switch">
          <span className="side-label">ВАШ ПРОЕКТ</span>
          <div className="project-select">
            <span className="project-symbol">
              {projects
                .find((p) => p.id === pid)
                ?.name.slice(0, 1)
                .toUpperCase() || "+"}
            </span>
            <select
              aria-label="Выбрать проект"
              value={pid}
              onChange={(e) => setPid(e.target.value)}
            >
              {!projects.length && <option value="">Нет проектов</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <button className="new-project" onClick={() => setProjectModal(true)}>
            <Plus size={14} />
            Новый проект
          </button>
        </div>
        <div className="side-label nav-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${screen === item.id ? "active" : ""}`}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} strokeWidth={1.6} />
              <span>{item.label}</span>
              {item.id === "library" && !!state?.documents.length && (
                <span className="nav-count">{state.documents.length}</span>
              )}
              {item.id === "agents" && !!activeRuns.length && (
                <span className="live-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${screen === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <SettingsIcon size={19} />
            <span>Настройки</span>
          </button>

        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              onClick={() => setSidebar(true)}
              className="mobile-menu"
              aria-label="Открыть меню"
            >
              <Menu size={20} />
            </IconButton>
            <span className="desktop-only">Пространство</span>
            <ChevronRight size={13} />
            <strong>
              {screen === "settings"
                ? "Настройки"
                : nav.find((n) => n.id === screen)?.label}
            </strong>
          </div>
          <div className="topbar-right">
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate("library");
              }}
            >
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Найти в проекте…"
                aria-label="Поиск в проекте"
              />
              <kbd>↵</kbd>
            </form>
            <span
              className={`connection-status ${activeRuns.length ? "running" : ""}`}
            >
              <span />
              {activeRuns.length ? "Команда работает" : "Локально"}
            </span>
            <IconButton
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
              aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
            </IconButton>
          </div>
        </header>
        <main className={`content content-${screen}`}>
          {screen === "settings" ? (
            <SettingsScreen
              settings={settings}
              onSettings={setSettings}
              onError={onError}
              projects={projects}
              pid={pid}
              onProjectsChanged={loadProjects}
            />
          ) : loading ? (
            <div className="loading-page">
              <Atom className="spin" size={32} />
              <p>Открываем лабораторию…</p>
            </div>
          ) : !pid ? (
            <div className="welcome workspace-welcome">
              <FolderOpen size={36} strokeWidth={1.5} />
              <h1>Создайте проект</h1>
              <p>В проекте хранятся источники, переписка с оркестратором и результаты работы агентов.</p>
              <Button onClick={() => setProjectModal(true)}>
                <Plus size={18} /> Создать проект
              </Button>
            </div>
          ) : !state ? (
            <div className="loading-page">
              <Atom className="spin" size={32} />
              <p>Загружаем проект…</p>
            </div>
          ) : screen === "overview" ? (
            <Overview {...props} />
          ) : screen === "library" ? (
            <LibraryScreen {...props} globalQuery={search} />
          ) : screen === "agents" ? (
            <AgentsScreen {...props} />
          ) : screen === "documents" ? (
            <WorkspaceScreen {...props} />
          ) : screen === "graph" ? (
            <GraphScreen {...props} />
          ) : (
            <BoardScreen {...props} />
          )}
        </main>

      </div>
      {error && (
        <div className="toast" role="alert">
          <div>
            <strong>Не удалось выполнить действие</strong>
            <p>{error}</p>
          </div>
          <IconButton
            onClick={() => setError("")}
            aria-label="Закрыть уведомление"
          >
            <X size={17} />
          </IconButton>
        </div>
      )}
      {projectModal && (
        <Modal
          title="Новое исследование начинается здесь"
          subtitle="Каждый проект — отдельная база знаний, команда и история."
          onClose={() => setProjectModal(false)}
        >
          <form onSubmit={createProject}>
            <Field label="Название проекта">
              <input
                autoFocus
                required
                maxLength={120}
                placeholder="Например, Автономная метеостанция"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </Field>
            <Field label="О чём этот проект?">
              <textarea
                rows={4}
                placeholder="Задача, ограничения и ожидаемый результат…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setProjectModal(false)}
              >
                Отмена
              </Button>
              <Button busy={saving} disabled={!projectName.trim()}>
                Создать проект
                <ArrowRight size={16} />
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {viewer && state && (
        <DocumentViewer
          {...props}
          target={viewer}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}
