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
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {text.split("\n").map((line, i) => {
        const inline = (s: string) =>
          s
            .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g)
            .map((part, j) => {
              if (part.startsWith("**") && part.endsWith("**"))
                return <strong key={j}>{part.slice(2, -2)}</strong>;
              if (part.startsWith("`") && part.endsWith("`"))
                return <code key={j}>{part.slice(1, -1)}</code>;
              const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
              return link ? (
                <a
                  key={j}
                  href={safeUrl(link[2])}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link[1]} <ExternalLink size={11} />
                </a>
              ) : (
                part
              );
            });
        if (line.startsWith("### "))
          return <h4 key={i}>{inline(line.slice(4))}</h4>;
        if (line.startsWith("## "))
          return <h3 key={i}>{inline(line.slice(3))}</h3>;
        if (line.startsWith("# "))
          return <h2 key={i}>{inline(line.slice(2))}</h2>;
        if (/^[-*] /.test(line))
          return (
            <div className="markdown-bullet" key={i}>
              • {inline(line.slice(2))}
            </div>
          );
        return <p key={i}>{inline(line) || "\u00a0"}</p>;
      })}
    </div>
  );
}
export function Saved({ show }: { show: boolean }) {
  return show ? (
    <span className="saved">
      <Check size={14} />
      Сохранено
    </span>
  ) : null;
}
