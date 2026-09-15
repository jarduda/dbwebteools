let token = "";
export async function csrf() {
  const r = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  token = (await r.json()).token;
}
export async function api<T = unknown>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (method !== "GET" && !token) await csrf();
  const r = await fetch("/api" + url, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    let title =
      r.status === 401 ? "Please sign in." : `Request failed (${r.status})`;
    try {
      title = (await r.json()).title || title;
    } catch {
      /* empty response */
    }
    throw new Error(title);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
export type User = {
  id: number;
  username: string;
  isAdmin: boolean;
  enabled: boolean;
};
export type Connection = {
  id: number;
  name: string;
  database: string;
  host?: string;
  port?: number;
  username?: string;
  verifyTls?: boolean;
};
export type Column = {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  generated: boolean;
  autoIncrement: boolean;
  default: string | null;
};
export type Row = {
  values: Record<string, unknown>;
  version: string;
  displayValues?: Record<string, string | null>;
  joinedValues?: Record<string, unknown>;
};
export type Page = {
  total: number;
  page: number;
  size: number;
  columns: Column[];
  rows: Row[];
  joinedColumns?: Column[];
};
export type Field = {
  name: string;
  label: string;
  section: string;
  order: number;
  hidden: boolean;
  readOnly: boolean;
  widget: string;
  lookup?: Lookup | null;
  options?: DropdownOption[] | null;
  showInList?: boolean;
  listOrder?: number | null;
  join?: Join | null;
  required?: boolean;
};
export type Grant = {
  userId: number;
  connectionId: number;
  table: string;
  read: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type Lookup = {
  table: string;
  keyColumn: string;
  displayColumn: string;
  searchColumns: string[];
};

export type DropdownOption = { key: string; display: string };

export type Join = {
  sourceColumn: string;
  table: string;
  keyColumn: string;
  valueColumn: string;
};
