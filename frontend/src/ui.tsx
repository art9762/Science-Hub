import React, { useEffect, useRef } from "react";
import {
  X,
  ArrowRight,
  Loader2,
  FileText,
  Image as ImageIcon,
  FolderOpen,
  Check,
  ExternalLink,
} from "lucide-react";
import { safeUrl } from "./api";
export function Button({
  children,
  variant = "",
  className = "",
  busy = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  busy?: boolean;
}) {
  return (
    <button
      className={`button ${variant} ${className}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy ? <Loader2 size={16} className="spin" /> : null}
      {children}
    </button>
  );
}
export function IconButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="icon-button" {...props}>
      {children}
    </button>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const node = ref.current;
    const first =
      node?.querySelector<HTMLElement>(
        "input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
      ) || node?.querySelector<HTMLElement>("button:not([disabled])");
    if (!node?.contains(document.activeElement)) first?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab" && node) {
        const items = [
          ...node.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
          ),
        ].filter((item) => item.getClientRects().length > 0);
        if (!items.length) {
          e.preventDefault();
          node.focus();
        } else if (!node.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? items[items.length - 1] : items[0]).focus();
        } else if (e.shiftKey && document.activeElement === items[0]) {
          e.preventDefault();
          items[items.length - 1].focus();
        } else if (
          !e.shiftKey &&
          document.activeElement === items[items.length - 1]
        ) {
          e.preventDefault();
          items[0].focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton onClick={onClose} aria-label="Закрыть">
            <X size={20} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  icon: Icon = FolderOpen,
  title,
  children,
  action,
}: {
  icon?: any;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={28} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Tag({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
export function DocIcon({
  mime = "",
  name = "",
}: {
  mime?: string;
  name?: string;
}) {
  return (
    <div className={`doc-icon ${mime.startsWith("image/") ? "picture" : ""}`}>
      {mime.startsWith("image/") ? (
        <ImageIcon size={20} />
      ) : (
        <FileText size={20} />
      )}
      <span>
        {mime.startsWith("image/")
          ? "IMG"
          : name.split(".").pop()?.slice(0, 4).toUpperCase() || "DOC"}
      </span>
    </div>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
function markdownInline(text: string) {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g)
    .map((part, index) => {
      if (part.startsWith("**") && part.endsWith("**"))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`"))
        return <code key={index}>{part.slice(1, -1)}</code>;
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      return link ? (
        <a key={index} href={safeUrl(link[2])} target="_blank" rel="noreferrer">
          {link[1]} <ExternalLink size={11} />
        </a>
      ) : part;
    });
}

function markdownTableCells(line: string) {
  let input = line.trim();
  if (input.startsWith("|")) input = input.slice(1);
  if (input.endsWith("|") && !input.endsWith("\\|")) input = input.slice(0, -1);
  const cells: string[] = [];
  let cell = "", codeTicks = 0;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === "\\" && input[index + 1] === "|") {
      cell += "|";
      index++;
    } else if (character === "`") {
      let count = 1;
      while (input[index + count] === "`") count++;
      codeTicks = codeTicks === count ? 0 : codeTicks || count;
      cell += "`".repeat(count);
      index += count - 1;
    } else if (character === "|" && !codeTicks) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const key = index;
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code: string[] = [];
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (++index < lines.length && !closing.test(lines[index])) code.push(lines[index]);
      const language = fence[2].trim().split(/\s+/)[0];
      blocks.push(
        <div className="markdown-code-block" key={key}>
          {language && <span className="markdown-code-language">{language}</span>}
          <pre tabIndex={0} aria-label={language ? `Код: ${language}` : "Блок кода"}><code>{code.join("\n")}</code></pre>
        </div>,
      );
      continue;
    }
    const nextLine = lines[index + 1] || "";
    const header = markdownTableCells(line);
    const separators = markdownTableCells(nextLine);
    if (line.includes("|") && nextLine.includes("|") && header.length === separators.length && separators.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const alignments: ("left" | "center" | "right")[] = separators.map((cell) =>
        cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left",
      );
      const rows: string[][] = [];
      index++;
      while (index + 1 < lines.length && lines[index + 1].trim() && lines[index + 1].includes("|") && !/^ {0,3}(`{3,}|~{3,})/.test(lines[index + 1])) {
        rows.push(markdownTableCells(lines[++index]));
      }
      blocks.push(
        <div className="markdown-table-wrap" key={key} role="region" aria-label="Таблица" tabIndex={0}>
          <table>
            <thead><tr>{header.map((cell, column) => <th key={column} scope="col" style={{ textAlign: alignments[column] }}>{markdownInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, column) => <td key={column} style={{ textAlign: alignments[column] }}>{markdownInline(row[column] || "")}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (line.startsWith("### ")) blocks.push(<h4 key={key}>{markdownInline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) blocks.push(<h3 key={key}>{markdownInline(line.slice(3))}</h3>);
    else if (line.startsWith("# ")) blocks.push(<h2 key={key}>{markdownInline(line.slice(2))}</h2>);
    else if (/^[-*] /.test(line)) blocks.push(<div className="markdown-bullet" key={key}>• {markdownInline(line.slice(2))}</div>);
    else blocks.push(<p key={key}>{line ? markdownInline(line) : "\u00a0"}</p>);
  }
  return <div className="markdown">{blocks}</div>;
}
export function Saved({ show }: { show: boolean }) {
  return show ? (
    <span className="saved">
      <Check size={14} />
      Сохранено
    </span>
  ) : null;
}
