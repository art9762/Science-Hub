import React, { useMemo, useRef, useState } from "react";
import {
  Network,
  GitBranch,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize,
  FileText,
  Users,
  Lightbulb,
  Link2,
  Trash2,
  Pencil,
  Check,
  ShieldCheck,
  AlertTriangle,
  ChevronRight,
  ArrowUpRight,
  StickyNote,
  GripHorizontal,
  Image,
  Globe,
  ExternalLink,
  Move,
  MousePointer2,
  X,
  CornerDownRight,
} from "lucide-react";
import { ScreenProps } from "./App";
import { Item, fileUrl, safeUrl, date } from "./api";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Modal,
  SectionTitle,
  Tag,
  Markdown,
} from "./ui";
type GraphNode = {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  item: Item;
};
const typeNames: Record<string, string> = {
  document: "Источник",
  workspace: "Документ",
  agent: "Агент",
  decision: "Решение",
  claim: "Утверждение",
  board: "Карточка доски",
  project: "Проект",
};
const kindIcons: Record<string, any> = {
  document: FileText,
  workspace: FileText,
  agent: Users,
  decision: Lightbulb,
  claim: ShieldCheck,
  board: StickyNote,
  project: Network,
};
const decisionStatuses: Record<string, string> = {
  proposed: "Предложено",
  accepted: "Принято",
  rejected: "Отклонено",
};
const claimStatuses: Record<string, string> = {
  unverified: "Не проверено",
  supported: "Подтверждено",
  disputed: "Оспаривается",
};
export function GraphScreen({
  pid,
  state,
  mutate,
  openDocument,
  navigate,
}: ScreenProps) {
  const [tab, setTab] = useState("graph"),
    [scale, setScale] = useState(0.75),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [selected, setSelected] = useState(""),
    [filter, setFilter] = useState("all"),
    [edit, setEdit] = useState<(Item & { editType: string }) | null>(null),
    [remove, setRemove] = useState<{ item: Item; kind: string } | null>(null),
    [linkOpen, setLinkOpen] = useState(false),
    [newLink, setNewLink] = useState({ source: "", target: "", label: "" }),
    [saving, setSaving] = useState(false),
    [alternatives, setAlternatives] = useState("");
  const drag = useRef<{
      x: number;
      y: number;
      panX: number;
      panY: number;
    } | null>(null),
    canvas = useRef<HTMLDivElement>(null);
  const nodes = useMemo<GraphNode[]>(() => {
    const all = [
      ...state.documents.map((item) => ({
        id: item.id,
        label: item.name,
        type: "document",
        item,
      })),
      ...state.workspace_documents.map((item) => ({
        id: item.id,
        label: item.title,
        type: "workspace",
        item,
      })),
      ...state.agents.map((item) => ({
        id: item.id,
        label: item.name,
        type: "agent",
        item,
      })),
      ...state.decisions.map((item) => ({
        id: item.id,
        label: item.title,
        type: "decision",
        item,
      })),
      ...state.claims.map((item) => ({
        id: item.id,
        label: item.text.slice(0, 55),
        type: "claim",
        item,
      })),
      ...state.board_items.map((item) => ({
        id: item.id,
        label: String(
          item.text ||
            state.documents.find((d) => d.id === item.reference_id)?.name ||
            (
              {
                note: "Заметка",
                document: "Материал",
                image: "Изображение",
                research: "Исследование",
              } as Record<string, string>
            )[item.type] ||
            "Карточка доски",
        )
          .split("\n")[0]
          .slice(0, 55),
        type: "board",
        item,
      })),
    ].filter((n) => filter === "all" || n.type === filter);
    return all.map((n, i) => {
      const angle = (i / Math.max(all.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const radius = all.length <= 8 ? 320 : 430 + Math.floor(i / 18) * 180;
      return {
        ...n,
        x: 640 + Math.cos(angle) * radius,
        y: 460 + Math.sin(angle) * radius * 0.73,
      };
    });
  }, [
    state.documents,
    state.workspace_documents,
    state.agents,
    state.decisions,
    state.claims,
    state.board_items,
    filter,
  ]);
  function openWorkspace(id: string) {
    try {
      sessionStorage.setItem(`science-hub-document:${pid}`, id);
    } catch {}
    navigate("documents");
  }
  function nodeIcon(node: GraphNode) {
    return node.type === "board"
      ? (
          {
            note: StickyNote,
            document: FileText,
            image: Image,
            research: Globe,
          } as Record<string, any>
        )[node.item.type] || StickyNote
      : kindIcons[node.type];
  }
  const activeNode = nodes.find((n) => n.id === selected);
  const links = state.links.filter(
    (l) =>
      nodes.some((n) => n.id === l.source) &&
      nodes.some((n) => n.id === l.target),
  );
  const allSources = [
    ...state.documents.map((d) => ({ id: d.id, name: d.name })),
    ...state.workspace_documents.map((d) => ({ id: d.id, name: d.title })),
  ];
  const startEdit = (type: string, item?: Item) => {
    setEdit(
      item
        ? { ...item, editType: type }
        : {
            id: "",
            editType: type,
            ...(type === "decision"
              ? {
                  title: "",
                  description: "",
                  rationale: "",
                  status: "proposed",
                  parent_id: "",
                  source_ids: [],
                  confidence: null,
                }
              : {
                  text: "",
                  reason: "",
                  status: "unverified",
                  source_ids: [],
                  confidence: null,
                }),
          },
    );
    setAlternatives(
      item?.alternatives
        ?.map((a: any) => `${a.title} | ${a.reason || ""}`)
        .join("\n") || "",
    );
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      const editType = edit.editType;
      const fields =
        editType === "decision"
          ? [
              "title",
              "description",
              "status",
              "parent_id",
              "rationale",
              "source_ids",
              "confidence",
            ]
          : ["text", "reason", "status", "source_ids", "confidence"];
      const body: any = Object.fromEntries(
        fields.map((key) => [key, edit[key]]),
      );
      if (editType === "decision") {
        body.alternatives = alternatives
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [title, ...reason] = s.split("|");
            return { title: title.trim(), reason: reason.join("|").trim() };
          });
        body.parent_id = body.parent_id || null;
      }
      await mutate(
        `/${editType === "decision" ? "decisions" : "claims"}${edit.id ? `/${edit.id}` : ""}`,
        body,
        edit.id ? "PATCH" : "POST",
      );
      setEdit(null);
    } catch {
    } finally {
      setSaving(false);
    }
  }
  function depth(d: Item) {
    let n = 0,
      parent = d.parent_id;
    const seen = new Set([d.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      n++;
      parent = state.decisions.find((x) => x.id === parent)?.parent_id;
    }
    return Math.min(n, 4);
  }
  return (
    <>
      <SectionTitle
        eyebrow="ПОЛНАЯ КАРТИНА ИССЛЕДОВАНИЯ"
        title="Граф и решения"
        description="Связывайте источники, сохраняйте аргументы и проверяйте выводы."
        action={
          tab === "graph" ? (
            <Button
              onClick={() => {
                setNewLink({
                  source: nodes[0]?.id || "",
                  target: nodes[1]?.id || "",
                  label: "",
                });
                setLinkOpen(true);
              }}
              disabled={nodes.length < 2}
            >
              <Link2 size={16} />
              Добавить связь
            </Button>
          ) : (
            <Button
              onClick={() =>
                startEdit(tab === "decisions" ? "decision" : "claim")
              }
            >
              <Plus size={17} />
              {tab === "decisions" ? "Новое решение" : "Добавить утверждение"}
            </Button>
          )
        }
      />
      <div className="library-tabs">
        <button
          className={tab === "graph" ? "active" : ""}
          onClick={() => setTab("graph")}
        >
          <Network size={16} />
          Canvas проекта
        </button>
        <button
          className={tab === "decisions" ? "active" : ""}
          onClick={() => setTab("decisions")}
        >
          <GitBranch size={16} />
          Дерево решений<span>{state.decisions.length}</span>
        </button>
        <button
          className={tab === "claims" ? "active" : ""}
          onClick={() => setTab("claims")}
        >
          <ShieldCheck size={16} />
          Факты и противоречия<span>{state.claims.length}</span>
        </button>
      </div>
      {tab === "graph" ? (
        <div className="graph-layout panel">
          <div
            className="graph-canvas"
            ref={canvas}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button,select")) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                panX: pan.x,
                panY: pan.y,
              };
            }}
            onPointerMove={(e) => {
              if (drag.current)
                setPan({
                  x: drag.current.panX + e.clientX - drag.current.x,
                  y: drag.current.panY + e.clientY - drag.current.y,
                });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey)
                setScale((s) =>
                  Math.max(0.3, Math.min(1.5, s - e.deltaY * 0.002)),
                );
            }}
          >
            <div className="graph-filter">
              <select
                aria-label="Тип объектов графа"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setSelected("");
                }}
              >
                <option value="all">
                  Все объекты ·{" "}
                  {state.documents.length +
                    state.workspace_documents.length +
                    state.agents.length +
                    state.decisions.length +
                    state.claims.length +
                    state.board_items.length}
                </option>
                {Object.entries(typeNames)
                  .filter(([t]) => t !== "project")
                  .map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
              </select>
              <span>
                <span className="graph-legend-line" />
                Связи проекта
              </span>
            </div>
            <div
              className="graph-world"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              }}
            >
              <svg width="1500" height="1100" className="graph-connections">
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 7 3.5, 0 7" fill="#789389" />
                  </marker>
                </defs>
                {nodes.map((n) => (
                  <line
                    key={`root-${n.id}`}
                    x1={640}
                    y1={460}
                    x2={n.x}
                    y2={n.y}
                    stroke="#d9dfd9"
                    strokeWidth="1.5"
                    strokeDasharray="4 5"
                  />
                ))}
                {links.map((l) => {
                  const a = nodes.find((n) => n.id === l.source)!,
                    b = nodes.find((n) => n.id === l.target)!;
                  return (
                    <g key={l.id}>
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke="#789389"
                        strokeWidth="2"
                        markerEnd="url(#arrowhead)"
                      />
                      {l.label && (
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2 - 7}
                          textAnchor="middle"
                          fontSize="12"
                          fill="#4e695e"
                        >
                          {l.label.slice(0, 35)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              <div className="graph-root" style={{ left: 640, top: 460 }}>
                <Network size={26} />
                <strong>{state.project.name}</strong>
                <small>ПРОЕКТ</small>
              </div>
              {nodes.map((n) => {
                const Icon = nodeIcon(n);
                return (
                  <button
                    key={n.id}
                    className={`graph-node node-${n.type} ${selected === n.id ? "selected" : ""}`}
                    style={{ left: n.x, top: n.y }}
                    onClick={() => {
                      setSelected(n.id);
                      if (n.type === "workspace") openWorkspace(n.id);
                    }}
                  >
                    <span>
                      <Icon size={19} />
                    </span>
                    <div>
                      <small>{typeNames[n.type]}</small>
                      <strong>{n.label}</strong>
                    </div>
                  </button>
                );
              })}
            </div>
            {!nodes.length && (
              <div className="graph-empty">
                <Empty icon={Network} title="Связи начинаются с объектов">
                  Добавьте источники, документы или решения — они появятся на
                  графе.
                </Empty>
              </div>
            )}
            <div className="canvas-controls">
              <IconButton
                aria-label="Уменьшить граф"
                onClick={() => setScale((s) => Math.max(0.3, s - 0.1))}
              >
                <ZoomOut size={17} />
              </IconButton>
              <span>{Math.round(scale * 100)}%</span>
              <IconButton
                aria-label="Увеличить граф"
                onClick={() => setScale((s) => Math.min(1.5, s + 0.1))}
              >
                <ZoomIn size={17} />
              </IconButton>
              <span className="control-divider" />
              <IconButton
                aria-label="Центрировать граф"
                onClick={() => {
                  setScale(0.75);
                  setPan({ x: 0, y: 0 });
                }}
              >
                <Maximize size={17} />
              </IconButton>
            </div>
            <div className="canvas-help">
              <Move size={13} />
              Перетаскивайте фон для перемещения
            </div>
          </div>
          <aside className="graph-inspector">
            <span className="eyebrow">ОБЪЕКТЫ И СВЯЗИ</span>
            {activeNode ? (
              <>
                <div className={`inspector-icon node-${activeNode.type}`}>
                  {React.createElement(nodeIcon(activeNode), { size: 25 })}
                </div>
                <Tag>{typeNames[activeNode.type]}</Tag>
                <h3>{activeNode.label}</h3>
                <p>
                  {activeNode.item.description ||
                    activeNode.item.reason ||
                    activeNode.item.rationale ||
                    activeNode.item.system_prompt ||
                    activeNode.item.text ||
                    "Добавляйте связи с другими объектами, чтобы сохранить контекст."}
                </p>
                {activeNode.type === "document" && (
                  <Button
                    variant="secondary small"
                    onClick={() => openDocument(activeNode.id)}
                  >
                    Открыть источник
                    <ArrowUpRight size={14} />
                  </Button>
                )}
                {activeNode.type === "workspace" && (
                  <Button
                    variant="secondary small"
                    onClick={() => openWorkspace(activeNode.id)}
                  >
                    Открыть документ
                    <ArrowUpRight size={14} />
                  </Button>
                )}
                {activeNode.type === "board" && (
                  <>
                    <Tag>
                      {(
                        {
                          note: "Заметка",
                          document: "Материал",
                          image: "Изображение",
                          research: "Исследование",
                        } as Record<string, string>
                      )[activeNode.item.type] || activeNode.item.type}
                    </Tag>
                    {activeNode.item.reference_id &&
                      state.documents.some(
                        (d) => d.id === activeNode.item.reference_id,
                      ) && (
                        <p>
                          <button
                            className="source-chip"
                            onClick={() =>
                              openDocument(activeNode.item.reference_id)
                            }
                          >
                            <FileText size={12} />
                            {
                              state.documents.find(
                                (d) => d.id === activeNode.item.reference_id,
                              )?.name
                            }
                          </button>
                        </p>
                      )}
                    <p>
                      <Button
                        variant="secondary small"
                        onClick={() => navigate("board")}
                      >
                        Открыть доску
                        <ArrowUpRight size={14} />
                      </Button>
                    </p>
                  </>
                )}
                {["decision", "claim"].includes(activeNode.type) && (
                  <Button
                    variant="secondary small"
                    onClick={() => startEdit(activeNode.type, activeNode.item)}
                  >
                    <Pencil size={14} />
                    Редактировать
                  </Button>
                )}
                <h4>Связи объекта</h4>
                {state.links
                  .filter((l) => l.source === selected || l.target === selected)
                  .map((l) => (
                    <div className="inspector-link" key={l.id}>
                      <Link2 size={13} />
                      <span>
                        <strong>{l.label || "Связано с"}</strong>
                        <small>
                          {nodes.find(
                            (n) =>
                              n.id ===
                              (l.source === selected ? l.target : l.source),
                          )?.label || "Объект проекта"}
                        </small>
                      </span>
                      <IconButton
                        aria-label="Удалить связь"
                        onClick={() =>
                          mutate(`/links/${l.id}`, undefined, "DELETE").catch(
                            () => {},
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  ))}
                <button
                  className="text-link"
                  onClick={() => {
                    setNewLink({
                      source: selected,
                      target: nodes.find((n) => n.id !== selected)?.id || "",
                      label: "",
                    });
                    setLinkOpen(true);
                  }}
                >
                  Новая связь
                  <Plus size={13} />
                </button>
              </>
            ) : (
              <>
                <Network
                  size={37}
                  strokeWidth={1.1}
                  className="inspector-empty-icon"
                />
                <h3>Знания обретают форму</h3>
                <p>
                  Нажмите на объект, чтобы увидеть детали и связанные материалы.
                </p>
                <div className="graph-legend">
                  {Object.entries(typeNames)
                    .filter(([t]) => t !== "project")
                    .map(([t, label]) => (
                      <span key={t}>
                        <i className={`legend-dot node-${t}`} />
                        {label}
                      </span>
                    ))}
                </div>
                <small className="muted">
                  Пунктир показывает принадлежность проекту. Сплошные линии —
                  сохранённые связи.
                </small>
              </>
            )}
          </aside>
        </div>
      ) : tab === "decisions" ? (
        <div className="decisions-page">
          {!state.decisions.length ? (
            <Empty
              icon={GitBranch}
              title="Сохраните логику ваших решений"
              action={
                <Button
                  variant="secondary"
                  onClick={() => startEdit("decision")}
                >
                  <Plus size={16} />
                  Первое решение
                </Button>
              }
            >
              Почему выбран именно этот вариант? Что рассматривали ещё?
              <br />
              Запишите аргументы, пока они свежи.
            </Empty>
          ) : (
            state.decisions.map((d) => (
              <article
                className="decision-card panel"
                key={d.id}
                style={{ marginLeft: depth(d) * 30 }}
              >
                {d.parent_id && (
                  <div className="decision-parent">
                    <CornerDownRight size={14} />
                    {state.decisions.find((x) => x.id === d.parent_id)?.title ||
                      "Родительское решение"}
                  </div>
                )}
                <div className="decision-card-heading">
                  <span className="decision-icon">
                    <Lightbulb size={20} />
                  </span>
                  <div>
                    <Tag
                      tone={
                        d.status === "accepted"
                          ? "green"
                          : d.status === "rejected"
                            ? "red"
                            : "orange"
                      }
                    >
                      {decisionStatuses[d.status] || d.status}
                    </Tag>
                    <h3>{d.title}</h3>
                  </div>
                  <IconButton
                    title="Редактировать решение"
                    aria-label="Редактировать решение"
                    onClick={() => startEdit("decision", d)}
                  >
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton
                    title="Удалить решение"
                    aria-label="Удалить решение"
                    onClick={() => setRemove({ item: d, kind: "decisions" })}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
                {d.description && <p>{d.description}</p>}
                {d.rationale && (
                  <div className="decision-rationale">
                    <strong>Аргументация</strong>
                    <p>{d.rationale}</p>
                  </div>
                )}
                {d.alternatives?.length > 0 && (
                  <div className="alternatives">
                    <strong>Рассмотренные альтернативы</strong>
                    {d.alternatives.map((a: any, i: number) => (
                      <div key={i}>
                        <GitBranch size={14} />
                        <span>
                          <b>{a.title}</b>
                          <small>{a.reason || "Причина не указана"}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="decision-bottom">
                  <div className="source-chips">
                    {d.source_ids?.map((id: string) => {
                      const doc = state.documents.find((s) => s.id === id);
                      return doc ? (
                        <button
                          key={id}
                          className="source-chip"
                          onClick={() => openDocument(id)}
                        >
                          <FileText size={12} />
                          {doc.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                  <span className="confidence">
                    {d.confidence != null
                      ? `Оценка доверия: ${Math.round(d.confidence * 100)}%`
                      : "Доверие не оценено"}
                  </span>
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="claims-page">
          <div className="claims-disclaimer">
            <ShieldCheck size={19} />
            <p>
              Уровень доверия — оценка автора или агента. Статус и проценты сами
              по себе не заменяют проверку источников.
            </p>
          </div>
          {state.events
            .filter(
              (e) => e.type === "conflict" || e.type === "missing_information",
            )
            .slice()
            .reverse()
            .map((event) => (
              <article className="claim-card panel disputed" key={event.id}>
                <div className="claim-status-icon">
                  <AlertTriangle size={22} />
                </div>
                <div className="claim-main">
                  <div className="claim-tags">
                    <Tag tone="orange">
                      {event.type === "conflict"
                        ? "Обнаружено противоречие"
                        : "Недостаточно данных"}
                    </Tag>
                    <span className="confidence">{date(event.created_at)}</span>
                  </div>
                  <h3>{event.message}</h3>
                  {(event.verification || event.reason) && (
                    <p>{event.verification || event.reason}</p>
                  )}
                  <div className="source-chips">
                    {event.source_ids?.map((id: string) => {
                      const doc = state.documents.find((d) => d.id === id);
                      return doc ? (
                        <button
                          key={id}
                          className="source-chip"
                          onClick={() => openDocument(id)}
                        >
                          <FileText size={12} />
                          {doc.name}
                        </button>
                      ) : (
                        <span className="tag" key={id}>
                          {allSources.find((s) => s.id === id)?.name || id}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </article>
            ))}
          {!state.claims.length &&
          !state.events.some((e) =>
            ["conflict", "missing_information"].includes(e.type),
          ) ? (
            <Empty
              icon={ShieldCheck}
              title="Отделяйте факты от предположений"
              action={
                <Button variant="secondary" onClick={() => startEdit("claim")}>
                  <Plus size={16} />
                  Добавить утверждение
                </Button>
              }
            >
              Здесь появятся утверждения команды, их источники и обнаруженные
              противоречия.
            </Empty>
          ) : (
            state.claims.map((c) => (
              <article
                className={`claim-card panel ${c.status === "disputed" ? "disputed" : ""}`}
                key={c.id}
              >
                <div className="claim-status-icon">
                  {c.status === "disputed" ? (
                    <AlertTriangle size={22} />
                  ) : (
                    <ShieldCheck size={22} />
                  )}
                </div>
                <div className="claim-main">
                  <div className="claim-tags">
                    <Tag
                      tone={
                        c.status === "supported"
                          ? "green"
                          : c.status === "disputed"
                            ? "red"
                            : ""
                      }
                    >
                      {claimStatuses[c.status] || c.status}
                    </Tag>
                    <span className="confidence">
                      {c.confidence != null
                        ? `${Math.round(c.confidence * 100)}% доверия`
                        : "Доверие не оценено"}
                    </span>
                  </div>
                  <h3>{c.text}</h3>
                  {c.reason && <p>{c.reason}</p>}
                  <div className="source-chips">
                    {c.source_ids?.map((id: string) => {
                      const doc = state.documents.find((d) => d.id === id);
                      return doc ? (
                        <button
                          className="source-chip"
                          key={id}
                          onClick={() => openDocument(id)}
                        >
                          <FileText size={12} />
                          {doc.name}
                        </button>
                      ) : (
                        <span className="tag" key={id}>
                          {allSources.find((s) => s.id === id)?.name || id}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <IconButton
                  aria-label="Редактировать утверждение"
                  onClick={() => startEdit("claim", c)}
                >
                  <Pencil size={16} />
                </IconButton>
                <IconButton
                  aria-label="Удалить утверждение"
                  onClick={() => setRemove({ item: c, kind: "claims" })}
                >
                  <Trash2 size={16} />
                </IconButton>
              </article>
            ))
          )}
        </div>
      )}
      {edit && (
        <Modal
          title={
            edit.editType === "decision"
              ? edit.id
                ? "Изменить решение"
                : "Новое инженерное решение"
              : edit.id
                ? "Изменить утверждение"
                : "Новое утверждение"
          }
          onClose={() => setEdit(null)}
          wide
        >
          <form onSubmit={save}>
            <div className="form-columns">
              <div>
                {edit.editType === "decision" ? (
                  <>
                    <Field label="Название решения">
                      <input
                        required
                        value={edit.title}
                        onChange={(e) =>
                          setEdit({ ...edit, title: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Описание">
                      <textarea
                        rows={3}
                        value={edit.description || ""}
                        onChange={(e) =>
                          setEdit({ ...edit, description: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Аргументация">
                      <textarea
                        rows={4}
                        value={edit.rationale || ""}
                        onChange={(e) =>
                          setEdit({ ...edit, rationale: e.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="Альтернативы"
                      hint="Одна на строку: название | причина отказа или замечание"
                    >
                      <textarea
                        rows={4}
                        value={alternatives}
                        onChange={(e) => setAlternatives(e.target.value)}
                        placeholder="Вариант A | Слишком высокая стоимость"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Утверждение">
                      <textarea
                        required
                        rows={5}
                        value={edit.text}
                        onChange={(e) =>
                          setEdit({ ...edit, text: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Обоснование и замечания">
                      <textarea
                        rows={5}
                        value={edit.reason || ""}
                        onChange={(e) =>
                          setEdit({ ...edit, reason: e.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
              <div>
                <Field label="Статус">
                  <select
                    value={edit.status}
                    onChange={(e) =>
                      setEdit({ ...edit, status: e.target.value })
                    }
                  >
                    {Object.entries(
                      edit.editType === "decision"
                        ? decisionStatuses
                        : claimStatuses,
                    ).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                {edit.editType === "decision" && (
                  <Field label="Родительское решение">
                    <select
                      value={edit.parent_id || ""}
                      onChange={(e) =>
                        setEdit({ ...edit, parent_id: e.target.value })
                      }
                    >
                      <option value="">Самостоятельное решение</option>
                      {state.decisions
                        .filter((d) => d.id !== edit.id)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <Field
                  label="Ваша оценка доверия, %"
                  hint="Оставьте пустым, если данных для оценки недостаточно."
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={
                      edit.confidence == null
                        ? ""
                        : Math.round(edit.confidence * 100)
                    }
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        confidence:
                          e.target.value === ""
                            ? null
                            : Number(e.target.value) / 100,
                      })
                    }
                  />
                </Field>
                <Field label="Источники">
                  <div className="tool-checklist source-checklist">
                    {allSources.map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={edit.source_ids?.includes(s.id) || false}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              source_ids: e.target.checked
                                ? [...(edit.source_ids || []), s.id]
                                : (edit.source_ids || []).filter(
                                    (id: string) => id !== s.id,
                                  ),
                            })
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                    {!allSources.length && (
                      <p className="muted">Пока нет материалов проекта.</p>
                    )}
                  </div>
                </Field>
              </div>
            </div>
            <div className="modal-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setEdit(null)}
              >
                Отмена
              </Button>
              <Button busy={saving}>Сохранить</Button>
            </div>
          </form>
        </Modal>
      )}
      {linkOpen && (
        <Modal
          title="Связать объекты"
          subtitle="Опишите, как один объект помогает понять другой."
          onClose={() => setLinkOpen(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSaving(true);
              try {
                await mutate("/links", newLink);
                setLinkOpen(false);
              } catch {
              } finally {
                setSaving(false);
              }
            }}
          >
            <Field label="Откуда">
              <select
                required
                value={newLink.source}
                onChange={(e) =>
                  setNewLink({ ...newLink, source: e.target.value })
                }
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {typeNames[n.type]} · {n.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Куда">
              <select
                required
                value={newLink.target}
                onChange={(e) =>
                  setNewLink({ ...newLink, target: e.target.value })
                }
              >
                {nodes
                  .filter((n) => n.id !== newLink.source)
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {typeNames[n.type]} · {n.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Что связывает эти объекты?">
              <input
                required
                value={newLink.label}
                onChange={(e) =>
                  setNewLink({ ...newLink, label: e.target.value })
                }
                placeholder="Например, подтверждает гипотезу"
              />
            </Field>
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setLinkOpen(false)}
              >
                Отмена
              </Button>
              <Button
                busy={saving}
                disabled={
                  !newLink.source ||
                  !newLink.target ||
                  newLink.source === newLink.target
                }
              >
                Сохранить связь
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Удалить запись?" onClose={() => setRemove(null)}>
          <p className="modal-copy">{remove.item.title || remove.item.text}</p>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setRemove(null)}>
              Отмена
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await mutate(
                    `/${remove.kind}/${remove.item.id}`,
                    undefined,
                    "DELETE",
                  );
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
const boardColors = [
  "#fff0bf",
  "#e5eee5",
  "#e4ebf7",
  "#f4e6f0",
  "#fae5d9",
  "#ffffff",
];
export function BoardScreen({ pid, state, mutate, openDocument }: ScreenProps) {
  const [edit, setEdit] = useState<Item | null>(null),
    [remove, setRemove] = useState<Item | null>(null),
    [saving, setSaving] = useState(false),
    [scale, setScale] = useState(1),
    [positions, setPositions] = useState<
      Record<string, { x: number; y: number }>
    >({}),
    [selected, setSelected] = useState("");
  const drag = useRef<{
      id: string;
      clientX: number;
      clientY: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      moved: boolean;
    } | null>(null),
    scroll = useRef<HTMLDivElement>(null);
  function add(type = "note") {
    setEdit({
      id: "",
      type,
      text: "",
      x: 70 + (state.board_items.length % 4) * 50,
      y: 70 + (state.board_items.length % 4) * 40,
      width: 270,
      height: type === "image" ? 290 : 220,
      color: boardColors[state.board_items.length % boardColors.length],
      reference_id: "",
    });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      await mutate(
        `/board-items${edit.id ? `/${edit.id}` : ""}`,
        Object.fromEntries(
          [
            "type",
            "text",
            "x",
            "y",
            "width",
            "height",
            "color",
            "reference_id",
          ].map((key) => [
            key,
            key === "reference_id" ? edit[key] || null : edit[key],
          ]),
        ),
        edit.id ? "PATCH" : "POST",
      );
      setEdit(null);
    } catch {
    } finally {
      setSaving(false);
    }
  }
  async function endDrag() {
    const current = drag.current;
    drag.current = null;
    if (current?.moved) {
      try {
        await mutate(
          `/board-items/${current.id}`,
          { x: Math.round(current.x), y: Math.round(current.y) },
          "PATCH",
        );
      } catch {
        setPositions((p) => {
          const next = { ...p };
          delete next[current.id];
          return next;
        });
      }
    }
  }
  return (
    <>
      <SectionTitle
        eyebrow="МЕСТО ДЛЯ СВОБОДНЫХ МЫСЛЕЙ"
        title="Доска проекта"
        description="Разложите идеи, материалы и результаты так, как удобно вам."
        action={
          <div className="heading-actions">
            <Button variant="secondary" onClick={() => add("document")}>
              <FileText size={16} />
              Материал
            </Button>
            <Button onClick={() => add()}>
              <Plus size={17} />
              Новая заметка
            </Button>
          </div>
        }
      />
      <div className="board-shell panel">
        <div className="board-toolbar">
          <div className="board-tools">
            <button onClick={() => add()}>
              <StickyNote size={17} />
              Заметка
            </button>
            <button onClick={() => add("document")}>
              <FileText size={17} />
              Документ
            </button>
            <button onClick={() => add("image")}>
              <Image size={17} />
              Изображение
            </button>
            <button onClick={() => add("research")}>
              <Globe size={17} />
              Исследование
            </button>
          </div>
          <span>
            {state.board_items.length} объектов · Сохраняется локально
          </span>
        </div>
        <div className="board-viewport" ref={scroll}>
          <div
            className="board-extent"
            style={{ width: 2200 * scale, height: 1600 * scale }}
          >
            <div
              className="board-world"
              style={{ transform: `scale(${scale})` }}
            >
              {state.board_items.map((item) => {
                const position = positions[item.id] || {
                  x: item.x || 0,
                  y: item.y || 0,
                };
                const doc = state.documents.find(
                  (d) => d.id === item.reference_id,
                );
                return (
                  <article
                    key={item.id}
                    className={`board-card ${selected === item.id ? "selected" : ""}`}
                    style={{
                      left: position.x,
                      top: position.y,
                      width: item.width || 270,
                      minHeight: item.height || 220,
                      background: item.color || "#fff0bf",
                      zIndex: selected === item.id ? 10 : 1,
                    }}
                    onClick={() => setSelected(item.id)}
                  >
                    <div
                      className="board-card-handle"
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).closest("button")) return;
                        e.preventDefault();
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setSelected(item.id);
                        drag.current = {
                          id: item.id,
                          clientX: e.clientX,
                          clientY: e.clientY,
                          startX: position.x,
                          startY: position.y,
                          x: position.x,
                          y: position.y,
                          moved: false,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current;
                        if (d && d.id === item.id) {
                          d.x = Math.max(
                            0,
                            Math.min(
                              1900,
                              d.startX + (e.clientX - d.clientX) / scale,
                            ),
                          );
                          d.y = Math.max(
                            0,
                            Math.min(
                              1300,
                              d.startY + (e.clientY - d.clientY) / scale,
                            ),
                          );
                          d.moved = true;
                          setPositions((p) => ({
                            ...p,
                            [item.id]: { x: d.x, y: d.y },
                          }));
                        }
                      }}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    >
                      <span>
                        {item.type === "note" ? (
                          <StickyNote size={14} />
                        ) : item.type === "image" ? (
                          <Image size={14} />
                        ) : item.type === "research" ? (
                          <Globe size={14} />
                        ) : (
                          <FileText size={14} />
                        )}
                        <strong>
                          {
                            (
                              {
                                note: "ЗАМЕТКА",
                                document: "МАТЕРИАЛ",
                                image: "ИЗОБРАЖЕНИЕ",
                                research: "ИССЛЕДОВАНИЕ",
                              } as any
                            )[item.type]
                          }
                        </strong>
                      </span>
                      <GripHorizontal size={18} />
                      <div>
                        <IconButton
                          aria-label="Редактировать карточку"
                          onClick={() => setEdit({ ...item })}
                        >
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          aria-label="Удалить карточку"
                          onClick={() => setRemove(item)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </div>
                    {item.type === "image" && doc && (
                      <button
                        className="board-image-button"
                        onClick={() => openDocument(doc.id)}
                      >
                        <img src={fileUrl(pid, doc.id)} alt={doc.name} />
                      </button>
                    )}
                    {doc && (
                      <button
                        className="board-doc-link"
                        onClick={() => openDocument(doc.id)}
                      >
                        <FileText size={16} />
                        <strong>{doc.name}</strong>
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                    <div
                      className="board-card-text"
                      onDoubleClick={() => setEdit({ ...item })}
                    >
                      {String(item.text || "")
                        .split("\n")
                        .map((line, i) =>
                          /^https?:\/\//.test(line.trim()) ? (
                            <a
                              href={safeUrl(line.trim())}
                              target="_blank"
                              rel="noreferrer"
                              key={i}
                            >
                              <ExternalLink size={12} />
                              {line.trim()}
                            </a>
                          ) : (
                            <p key={i}>{line || "\u00a0"}</p>
                          ),
                        )}
                    </div>
                    <span className="board-card-date">
                      {date(item.updated_at)}
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
          {!state.board_items.length && (
            <div className="board-empty">
              <div className="board-empty-note note-a" />
              <div className="board-empty-note note-b" />
              <span>
                <StickyNote size={31} strokeWidth={1.3} />
              </span>
              <h2>Дайте идеям немного пространства</h2>
              <p>
                Добавляйте заметки, связывайте мысли и держите
                <br />
                важные материалы перед глазами.
              </p>
              <Button variant="secondary" onClick={() => add()}>
                <Plus size={15} />
                Первый объект на доске
              </Button>
            </div>
          )}
        </div>
        <div className="canvas-controls">
          <IconButton
            aria-label="Уменьшить доску"
            onClick={() => setScale((s) => Math.max(0.4, s - 0.1))}
          >
            <ZoomOut size={17} />
          </IconButton>
          <span>{Math.round(scale * 100)}%</span>
          <IconButton
            aria-label="Увеличить доску"
            onClick={() => setScale((s) => Math.min(1.4, s + 0.1))}
          >
            <ZoomIn size={17} />
          </IconButton>
          <span className="control-divider" />
          <IconButton
            aria-label="Начало доски"
            onClick={() => {
              setScale(1);
              scroll.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
            }}
          >
            <Maximize size={17} />
          </IconButton>
        </div>
        <div className="canvas-help">
          <Move size={13} />
          Перетаскивайте карточки за верхнюю часть
        </div>
      </div>
      {edit && (
        <Modal
          title={edit.id ? "Изменить карточку" : "Новая карточка"}
          onClose={() => setEdit(null)}
        >
          <form onSubmit={save}>
            <Field label="Тип объекта">
              <select
                value={edit.type}
                onChange={(e) =>
                  setEdit({ ...edit, type: e.target.value, reference_id: "" })
                }
              >
                <option value="note">Заметка</option>
                <option value="document">Документ</option>
                <option value="image">Изображение</option>
                <option value="research">Исследование</option>
              </select>
            </Field>
            {["document", "image"].includes(edit.type) && (
              <Field label="Материал из базы знаний">
                <select
                  required
                  value={edit.reference_id || ""}
                  onChange={(e) =>
                    setEdit({ ...edit, reference_id: e.target.value })
                  }
                >
                  <option value="">Выберите материал</option>
                  {state.documents
                    .filter(
                      (d) =>
                        edit.type !== "image" ||
                        d.mime_type?.startsWith("image/"),
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field
              label={edit.type === "note" ? "Текст заметки" : "Комментарий"}
            >
              <textarea
                required={edit.type === "note" || edit.type === "research"}
                rows={6}
                value={edit.text || ""}
                onChange={(e) => setEdit({ ...edit, text: e.target.value })}
                placeholder="Мысль, вопрос или следующий шаг…"
              />
            </Field>
            <Field label="Цвет карточки">
              <div className="color-options">
                {boardColors.map((c) => (
                  <button
                    key={c}
                    type="button"
                    style={{ background: c }}
                    className={edit.color === c ? "selected" : ""}
                    aria-label={`Цвет ${c}`}
                    onClick={() => setEdit({ ...edit, color: c })}
                  >
                    {edit.color === c && <Check size={17} />}
                  </button>
                ))}
              </div>
            </Field>
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEdit(null)}
              >
                Отмена
              </Button>
              <Button busy={saving}>Сохранить на доске</Button>
            </div>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Убрать карточку с доски?" onClose={() => setRemove(null)}>
          <p className="modal-copy">
            Связанный материал останется в базе знаний.
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
                    `/board-items/${remove.id}`,
                    undefined,
                    "DELETE",
                  );
                  setRemove(null);
                } catch {}
              }}
            >
              Убрать карточку
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
