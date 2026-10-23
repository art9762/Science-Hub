export type Item = Record<string, any> & { id: string };
export type State = {
  project: Item;
  documents: Item[];
  folders: Item[];
  annotations: Item[];
  agents: Item[];
  messages: Item[];
  runs: Item[];
  events: Item[];
  workspace_documents: Item[];
  decisions: Item[];
  claims: Item[];
  board_items: Item[];
  links: Item[];
};
export type Provider = {
  id: string;
  name: string;
  base_url: string;
  has_key: boolean;
  models: { id: string; name?: string }[];
  api_key?: string;
};
export type Settings = {
  providers: Provider[];
  default_provider_id: string;
  orchestrator_model: string;
  vision_model: string;
  max_runtime_seconds: number;
  shutdown_grace_seconds: number;
  max_tokens: number;
};
export async function api<T = any>(
  path: string,
  data?: unknown,
  method?: string,
): Promise<T> {
  const options: RequestInit = {
    method: method || (data === undefined ? "GET" : "POST"),
  };
  if (data instanceof FormData) options.body = data;
  else if (data !== undefined) {
    options.body = JSON.stringify(data);
    options.headers = { "Content-Type": "application/json" };
  }
  const response = await fetch("/api" + path, options);
  const body = await response.text();
  let parsed: any;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok)
    throw new Error(
      parsed?.error?.message ||
        parsed?.detail ||
        `Ошибка запроса (${response.status})`,
    );
  return parsed as T;
}
export function fileUrl(pid: string, id: string) {
  return `/api/projects/${encodeURIComponent(pid)}/documents/${encodeURIComponent(id)}/file`;
}
export function date(value?: string) {
  return value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
export function bytes(value: number) {
  return value < 1024
    ? `${value} Б`
    : value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} КБ`
      : `${(value / 1024 / 1024).toFixed(1)} МБ`;
}
export function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}
