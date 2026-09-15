import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Database,
  Table2,
  Users,
  ShieldCheck,
  Settings2,
  Plus,
  Search,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  RefreshCw,
  Activity,
  X,
  ArrowUpDown,
} from "lucide-react";
import {
  api,
  csrf,
  type User,
  type Connection,
  type Column,
  type Row,
  type Page,
  type Field,
  type Grant,
  type ListView,
} from "./api";
import "./style.css";
import { JoinConfiguration, listColumns } from "./layout-fields";
import { ListViewEditor, filterSummary } from "./list-view";
import {
  DropdownConfiguration,
  dropdownError,
  widgetFor,
  temporalInput,
  cellText,
} from "./field-controls";
import { LookupConfiguration, LookupInput } from "./lookups";
function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [view, setView] = useState("records"),
    [connections, setConnections] = useState<Connection[]>([]),
    [connection, setConnection] = useState(0),
    [tables, setTables] = useState<string[]>([]),
    [table, setTable] = useState(""),
    [error, setError] = useState("");
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const loadConnections = () =>
    api<Connection[]>("/connections")
      .then((c) => {
        setConnections(c);
        setConnection((old) =>
          c.some((x) => x.id === old) ? old : c[0]?.id || 0,
        );
      })
      .catch(fail);
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (user) loadConnections();
  }, [user]);
  useEffect(() => {
    let active = true;
    setTables([]);
    setTable("");
    if (connection)
      api<string[]>(`/connections/${connection}/tables`)
        .then((t) => {
          if (!active) return;
          setTables(t);
          setTable(t[0] || "");
        })
        .catch((e) => {
          if (active) fail(e);
        });
    return () => {
      active = false;
    };
  }, [connection]);
  if (!ready) return <div className="loading">Opening your workspace…</div>;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          csrf();
        }}
      />
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Database size={22} />
          </span>
          TableSpace<span className="brand-dot">●</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button
          className={"nav " + (view === "records" ? "active" : "")}
          onClick={() => setView("records")}
        >
          <Table2 size={18} />
          Data browser
        </button>
        {user.isAdmin && (
          <>
            <div className="workspace-label">ADMINISTRATION</div>
            {[
              ["users", "Users & roles", Users],
              ["connections", "Connections", Database],
              ["permissions", "Table access", ShieldCheck],
              ["layouts", "Editor layouts", Settings2],
              ["audit", "Activity log", Activity],
            ].map(([key, label, Icon]) => (
              <button
                key={String(key)}
                className={"nav " + (view === key ? "active" : "")}
                onClick={() => setView(String(key))}
              >
                {React.createElement(Icon, { size: 18 })}
                {String(label)}
              </button>
            ))}
          </>
        )}
        <div className="sidebar-bottom">
          <span className="avatar">
            {user.username.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <strong>{user.username}</strong>
            <small>{user.isAdmin ? "Administrator" : "Workspace member"}</small>
          </div>
          <button
            aria-label="Sign out"
            className="icon-btn"
            onClick={() =>
              api("/auth/logout", "POST")
                .then(() => {
                  setUser(null);
                  csrf();
                })
                .catch(fail)
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span>{" "}
            {view === "records" ? "Data browser" : "Administration"}
          </span>
          <span className="badge">
            <span className="green-dot" /> MariaDB workspace
          </span>
        </header>
        <div className="content">
          {error && (
            <div className="alert" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {view === "records" ? (
            <>
              <div className="heading">
                <div className="eyebrow">YOUR DATA, CLEARLY ORGANIZED</div>
                <h1>Data browser</h1>
                <p>Explore your tables. Keep every record in order.</p>
              </div>
              <div className="selectors">
                <label>
                  Connection
                  <select
                    value={connection}
                    onChange={(e) => {
                      if (connection !== Number(e.target.value)) {
                        setTables([]);
                        setTable("");
                        setConnection(Number(e.target.value));
                      }
                    }}
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.database}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Table
                  <select
                    value={table}
                    onChange={(e) => setTable(e.target.value)}
                  >
                    {tables.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>
              {table ? (
                <Records
                  key={`${connection}/${table}`}
                  connection={connection}
                  table={table}
                  fail={fail}
                />
              ) : (
                <Empty
                  title="Your workspace starts here"
                  text={
                    user.isAdmin
                      ? "Add a MariaDB connection in Administration to browse your tables."
                      : "Ask an administrator to grant access to database tables."
                  }
                />
              )}
            </>
          ) : (
            <Admin
              view={view}
              connections={connections}
              refresh={loadConnections}
              fail={fail}
            />
          )}
        </div>
        <footer>
          TableSpace <span>Purpose-built for your data.</span>
        </footer>
      </main>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <div className="login-story">
        <span className="brand">
          <Database /> TableSpace
        </span>
        <div>
          <span className="eyebrow">A LITTLE STRUCTURE. A LOT OF CLARITY.</span>
          <h1>
            Your databases.
            <br />
            One beautiful
            <br />
            <em>workspace.</em>
          </h1>
          <p>
            Manage records, connect your team, and make room for the work that
            matters.
          </p>
        </div>
        <small>SECURE ACCESS · FLEXIBLE EDITORS · MARIADB</small>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const f = new FormData(e.currentTarget);
          try {
            await csrf();
            onLogin(
              await api<User>("/auth/login", "POST", Object.fromEntries(f)),
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">WELCOME BACK</span>
        <h2>Sign in to your workspace</h2>
        <p>Use the account provided by your administrator.</p>
        {error && (
          <div role="alert" className="alert">
            {error}
          </div>
        )}
        <label>
          Username
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in →"}
        </button>
        <small>Your session is protected with secure, HTTP-only cookies.</small>
      </form>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Database size={38} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Records({
  connection,
  table,
  fail,
}: {
  connection: number;
  table: string;
  fail: (e: unknown) => void;
}) {
  const [data, setData] = useState<Page | null>(null),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState(""),
    [desc, setDesc] = useState(false),
    [settings, setSettings] = useState<{
      grant: Grant;
      fields: Field[];
      view: ListView;
    } | null>(null),
    [editing, setEditing] = useState<Row | null | undefined>(undefined),
    [deleting, setDeleting] = useState<Row | null>(null),
    [busy, setBusy] = useState(false);
  const base = `/connections/${connection}/tables/${encodeURIComponent(table)}`;
  const load = () => {
    setBusy(true);
    return api<Page>(
      `${base}/records?page=${page}&size=25&search=${encodeURIComponent(query)}${sort ? "&sort=" + encodeURIComponent(sort) + "&descending=" + desc : ""}`,
    )
      .then(setData)
      .catch(fail)
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    load();
    api<{ grant: Grant; fields: Field[]; view: ListView }>(base + "/settings")
      .then(setSettings)
      .catch(fail);
  }, [page, query, sort, desc]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const keyFor = (r: Row) =>
    Object.fromEntries(
      data!.columns
        .filter((c) => c.primaryKey)
        .map((c) => [c.name, r.values[c.name]]),
    );
  const mutable = !!data?.columns.some((c) => c.primaryKey);
  const displayColumns =
    settings && data
      ? listColumns(
          [...data.columns, ...(data.joinedColumns || [])],
          settings.fields,
        )
      : [];
  const joined = (name: string) =>
    settings?.fields.some((f) => f.name === name && f.widget === "join");
  return (
    <>
      <section className="card">
        <div className="card-title">
          <div className="table-title">
            <span className="table-icon">
              <Table2 size={20} />
            </span>
            <h2>{settings?.view?.label || table}</h2>
            <span className="count">{data?.total ?? "…"} records</span>
          </div>
          {settings?.grant.create && mutable && (
            <button className="primary" onClick={() => setEditing(null)}>
              <Plus size={16} />
              Add record
            </button>
          )}
        </div>
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search records"
              placeholder="Search text fields…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="secondary" onClick={load} disabled={busy}>
            <RefreshCw size={16} className={busy ? "spin" : ""} />
            Refresh
          </button>
        </div>
        {!!settings?.view?.filters?.length && (
          <div className="notice" role="note">
            Layout filter: {filterSummary(settings.view, settings.fields)}
          </div>
        )}
        {sort && (
          <button
            className="reset-sort"
            onClick={() => {
              setSort("");
              setDesc(false);
              setPage(1);
            }}
          >
            Use default sorting
          </button>
        )}
        {!mutable && data && (
          <div className="notice">
            This table has no primary key and is read-only.
          </div>
        )}
        {settings && data && displayColumns.length === 0 && (
          <div className="notice">
            No list fields selected. Configure visible fields in Editor layouts.
          </div>
        )}
        <div className="table-scroll" aria-busy={busy}>
          <table>
            <thead>
              <tr>
                {displayColumns.map((c) => (
                  <th
                    key={c.name}
                    aria-sort={
                      data?.sort === c.name
                        ? data.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button
                      disabled={joined(c.name)}
                      title={
                        joined(c.name) ? "Read-only joined field" : undefined
                      }
                      onClick={() => {
                        setSort(c.name);
                        setDesc(
                          data?.sort === c.name ? !data.descending : false,
                        );
                        setPage(1);
                      }}
                    >
                      {settings?.fields.find((f) => f.name === c.name)?.label ||
                        c.name}
                      {c.primaryKey && <span className="key">PK</span>}
                      {!joined(c.name) && <ArrowUpDown size={12} />}
                    </button>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((r, i) => (
                <tr key={i}>
                  {displayColumns.map((c) => (
                    <td key={c.name}>
                      {joined(c.name) ? (
                        !(c.name in (r.joinedValues || {})) ? (
                          <span className="null">Unavailable</span>
                        ) : r.joinedValues?.[c.name] == null ? (
                          <span className="null">NULL</span>
                        ) : (
                          cellText(r.joinedValues[c.name], c)
                        )
                      ) : r.values[c.name] == null ? (
                        <span className="null">NULL</span>
                      ) : (
                        (r.displayValues?.[c.name] ??
                        cellText(
                          r.values[c.name],
                          c,
                          settings?.fields.find((f) => f.name === c.name),
                        ))
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="actions">
                      {settings?.grant.update && mutable && (
                        <button
                          className="icon-btn"
                          aria-label={`Edit record ${i + 1}`}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      {settings?.grant.delete && mutable && (
                        <button
                          className="icon-btn danger"
                          aria-label={`Delete record ${i + 1}`}
                          onClick={() => setDeleting(r)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.rows.length === 0 && (
            <Empty
              title="No records found"
              text={
                query
                  ? "Try a different search."
                  : "Add your first record to this table."
              }
            />
          )}
        </div>
        <div className="pagination">
          <span>
            {data
              ? `${data.total} records · Page ${page} of ${Math.max(1, Math.ceil(data.total / 25))}`
              : "Loading records…"}
          </span>
          <div>
            <button
              aria-label="Previous page"
              disabled={page === 1 || busy}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              aria-label="Next page"
              disabled={!data || page * 25 >= data.total || busy}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>
      {editing !== undefined && data && (
        <RecordEditor
          base={base}
          columns={[...data.columns, ...(data.joinedColumns || [])]}
          fields={settings?.fields || []}
          row={editing}
          close={() => setEditing(undefined)}
          save={async (values) => {
            await api(base + (editing ? "/update" : "/create"), "POST", {
              values,
              key: editing ? keyFor(editing) : null,
              version: editing?.version,
            });
            setEditing(undefined);
            await load();
          }}
        />
      )}
      {deleting && (
        <Modal title="Delete this record?" close={() => setDeleting(null)}>
          <p>
            This permanently removes the record from MariaDB. This action cannot
            be undone.
          </p>
          <div className="form-actions">
            <button onClick={() => setDeleting(null)}>Cancel</button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(base + "/delete", "POST", {
                    values: {},
                    key: keyFor(deleting),
                    version: deleting.version,
                  });
                  setDeleting(null);
                  await load();
                } catch (e) {
                  fail(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete record
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
export function RecordEditor({
  base = "",
  columns,
  fields,
  row,
  close,
  save,
}: {
  base?: string;
  columns: Column[];
  fields: Field[];
  row: Row | null;
  close: () => void;
  save: (v: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(
      row
        ? { ...row.values }
        : Object.fromEntries(
            fields
              .filter(
                (f) =>
                  f.required &&
                  f.widget === "checkbox" &&
                  !f.hidden &&
                  !f.readOnly,
              )
              .map((f) => [f.name, false]),
          ),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [joinedValues, setJoinedValues] = useState<Record<string, unknown>>(
    row?.joinedValues || {},
  );
  const [joinBusy, setJoinBusy] = useState(false),
    [joinError, setJoinError] = useState("");
  const joinConfig = JSON.stringify(
    fields.filter((f) => f.widget === "join" && f.join),
  );
  const joinRequest = JSON.stringify(
    Object.fromEntries(
      fields
        .filter((f) => f.widget === "join" && f.join)
        .map((f) => [
          f.join!.sourceColumn,
          values[f.join!.sourceColumn] ?? null,
        ]),
    ),
  );
  useEffect(() => {
    let active = true;
    if (joinConfig === "[]" || !base) return;
    setJoinBusy(true);
    setJoinError("");
    setJoinedValues({});
    const timer = setTimeout(() => {
      api<{ values: Record<string, unknown> }>(
        base + "/joins/resolve",
        "POST",
        { values: JSON.parse(joinRequest) },
      )
        .then((r) => {
          if (active) setJoinedValues(r.values);
        })
        .catch((e) => {
          if (active) setJoinError(e.message);
        })
        .finally(() => {
          if (active) setJoinBusy(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, joinConfig, joinRequest]);
  const layout = (c: Column) => fields.find((f) => f.name === c.name);
  const writable = columns.filter(
    (c) =>
      !c.generated &&
      !c.autoIncrement &&
      !(row && c.primaryKey) &&
      layout(c)?.widget !== "join",
  );
  const emptyRequired = (c: Column) =>
    layout(c)?.required &&
    (values[c.name] == null ||
      (typeof values[c.name] === "string" && !String(values[c.name]).trim()));
  return (
    <Modal title={row ? "Edit record" : "Add a record"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            for (const c of columns) {
              if (emptyRequired(c))
                throw new Error(`${layout(c)?.label || c.name} is required.`);
            }
            for (const c of writable) {
              if (
                layout(c)?.widget === "lookup" &&
                !layout(c)?.hidden &&
                !layout(c)?.readOnly &&
                !c.nullable &&
                c.default == null &&
                (values[c.name] == null || values[c.name] === "")
              )
                throw new Error(
                  `Select a related record for ${layout(c)?.label || c.name}.`,
                );
            }
            const payload = Object.fromEntries(
              writable
                .filter(
                  (c) =>
                    !(layout(c)?.readOnly || layout(c)?.hidden) &&
                    c.name in values &&
                    (!row || values[c.name] !== row.values[c.name]),
                )
                .map((c) => [c.name, values[c.name]]),
            );
            if (row && Object.keys(payload).length === 0) close();
            else await save(payload);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        {joinError && (
          <div className="alert" role="alert">
            Related fields: {joinError}
          </div>
        )}
        <div className="editor-grid">
          {[...columns]
            .sort(
              (a, b) =>
                (layout(a)?.order ?? columns.indexOf(a)) -
                (layout(b)?.order ?? columns.indexOf(b)),
            )
            .filter((c) => !layout(c)?.hidden)
            .map((c) => {
              const l = layout(c),
                widget = widgetFor(c, l),
                disabled =
                  c.generated ||
                  c.autoIncrement ||
                  !!(row && c.primaryKey) ||
                  l?.readOnly;
              return (
                <label
                  key={c.name}
                  className={l?.widget === "textarea" ? "wide" : ""}
                >
                  {l?.section && <span className="eyebrow">{l.section}</span>}
                  <span>
                    {l?.label || c.name}{" "}
                    <small>
                      {c.type}
                      {c.primaryKey ? " · Primary key" : ""}
                      {l?.required ? " · Required" : ""}
                    </small>
                  </span>
                  {l?.widget === "join" ? (
                    <input
                      aria-label={l.label || c.name}
                      readOnly
                      aria-readonly="true"
                      value={
                        joinBusy
                          ? "Loading…"
                          : !(c.name in joinedValues)
                            ? "Unavailable"
                            : joinedValues[c.name] == null
                              ? "NULL"
                              : cellText(joinedValues[c.name], c)
                      }
                    />
                  ) : l?.widget === "lookup" && l.lookup ? (
                    <LookupInput
                      base={base}
                      name={c.name}
                      label={l.label || c.name}
                      lookup={l.lookup}
                      value={values[c.name]}
                      disabled={disabled}
                      nullable={c.nullable && !l.required}
                      change={(key) =>
                        setValues((v) => ({ ...v, [c.name]: key }))
                      }
                    />
                  ) : widget === "dropdown" ? (
                    <select
                      aria-label={l?.label || c.name}
                      disabled={disabled}
                      value={String(values[c.name] ?? "")}
                      required={
                        !disabled &&
                        (!!l?.required ||
                          (!c.nullable && (row != null || c.default == null)))
                      }
                      onChange={(e) =>
                        setValues((old) => {
                          const next = { ...old };
                          if (e.target.value !== "")
                            next[c.name] = e.target.value;
                          else if (c.nullable) next[c.name] = null;
                          else delete next[c.name];
                          return next;
                        })
                      }
                    >
                      <option value="">
                        {l?.required
                          ? "Choose a value…"
                          : c.nullable
                            ? "No value (NULL)"
                            : !row && c.default != null
                              ? "Use database default"
                              : "Choose a value…"}
                      </option>
                      {values[c.name] != null &&
                        values[c.name] !== "" &&
                        !l?.options?.some((o) => o.key === values[c.name]) && (
                          <option value={String(values[c.name])}>
                            {String(values[c.name])} (not in configured list)
                          </option>
                        )}
                      {l?.options?.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.display}
                        </option>
                      ))}
                    </select>
                  ) : l?.widget === "textarea" ? (
                    <textarea
                      aria-label={l?.label || c.name}
                      required={
                        !disabled &&
                        (!!l?.required || (!c.nullable && c.default == null))
                      }
                      disabled={disabled}
                      value={String(values[c.name] ?? "")}
                      onChange={(e) =>
                        setValues({ ...values, [c.name]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      aria-label={l?.label || c.name}
                      disabled={disabled}
                      type={
                        widget === "date"
                          ? "date"
                          : widget === "datetime"
                            ? "datetime-local"
                            : l?.widget === "number"
                              ? "number"
                              : l?.widget === "checkbox"
                                ? "checkbox"
                                : "text"
                      }
                      step="any"
                      checked={
                        l?.widget === "checkbox"
                          ? Boolean(values[c.name])
                          : undefined
                      }
                      value={
                        l?.widget === "checkbox"
                          ? undefined
                          : ["date", "datetime"].includes(widget)
                            ? temporalInput(values[c.name], widget)
                            : String(values[c.name] ?? "")
                      }
                      placeholder={
                        c.autoIncrement
                          ? "Generated automatically"
                          : l?.required
                            ? "Required"
                            : c.default != null
                              ? `Default: ${c.default}`
                              : c.nullable
                                ? "Optional"
                                : "Required"
                      }
                      required={
                        !disabled &&
                        widget !== "checkbox" &&
                        (!!l?.required || (!c.nullable && c.default == null))
                      }
                      onChange={(e) =>
                        setValues((old) => {
                          const next = { ...old };
                          if (
                            ["date", "datetime"].includes(widget) &&
                            !e.target.value
                          ) {
                            if (c.nullable) next[c.name] = null;
                            else if (!row && c.default != null)
                              delete next[c.name];
                            else next[c.name] = "";
                          } else
                            next[c.name] =
                              widget === "checkbox"
                                ? e.target.checked
                                : e.target.value;
                          return next;
                        })
                      }
                    />
                  )}{" "}
                  {widget === "date" &&
                    ["datetime", "timestamp"].includes(c.type) && (
                      <small>
                        Changing the date sets the time to midnight.
                      </small>
                    )}
                  {widget === "datetime" && (
                    <small>
                      Database session time; unchanged values retain full
                      precision.
                    </small>
                  )}
                  {c.nullable &&
                    !l?.required &&
                    !disabled &&
                    !["lookup", "dropdown"].includes(widget) && (
                      <span className="null-toggle">
                        <input
                          type="checkbox"
                          checked={values[c.name] === null}
                          onChange={(e) =>
                            setValues({
                              ...values,
                              [c.name]: e.target.checked ? null : "",
                            })
                          }
                        />
                        Set NULL
                      </span>
                    )}
                </label>
              );
            })}
        </div>
        <div className="form-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save record"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
        if (e.key === "Tab") {
          const list = ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)",
          );
          if (!list?.length) return;
          const first = list[0],
            last = list[list.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal"
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={close}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Admin({
  view,
  connections,
  refresh,
  fail,
}: {
  view: string;
  connections: Connection[];
  refresh: () => void;
  fail: (e: unknown) => void;
}) {
  const [users, setUsers] = useState<User[]>([]),
    [configs, setConfigs] = useState<Connection[]>([]),
    [grants, setGrants] = useState<Grant[]>([]),
    [audit, setAudit] = useState<
      {
        id: number;
        at: string;
        actor: string;
        action: string;
        resource: string;
      }[]
    >([]),
    [edit, setEdit] = useState<User | Connection | null | undefined>(undefined),
    [connection, setConnection] = useState(connections[0]?.id || 0),
    [tables, setTables] = useState<string[]>([]),
    [table, setTable] = useState(""),
    [uid, setUid] = useState(0),
    [grant, setGrant] = useState({
      read: true,
      create: false,
      update: false,
      delete: false,
    }),
    [fields, setFields] = useState<Field[]>([]),
    [layoutColumns, setLayoutColumns] = useState<Column[]>([]),
    [listView, setListView] = useState<ListView>({}),
    [layoutLoading, setLayoutLoading] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = () =>
    Promise.all([
      api<User[]>("/admin/users").then((u) => {
        setUsers(u);
        setUid((old) => old || u[0]?.id || 0);
      }),
      api<Connection[]>("/admin/connections").then(setConfigs),
      api<Grant[]>("/admin/grants").then(setGrants),
      api<typeof audit>("/admin/audit").then(setAudit),
    ]).catch(fail);
  useEffect(() => {
    reload();
    setMessage("");
    setEdit(undefined);
  }, [view]);
  useEffect(() => {
    let active = true;
    setTable("");
    setTables([]);
    if (connection)
      api<string[]>(`/connections/${connection}/tables`)
        .then((t) => {
          if (!active) return;
          setTables(t);
          setTable(t[0] || "");
        })
        .catch((e) => {
          if (active) fail(e);
        });
    return () => {
      active = false;
    };
  }, [connection]);
  useEffect(() => {
    const g = grants.find(
      (g) =>
        g.connectionId === connection && g.userId === uid && g.table === table,
    );
    setGrant(g || { read: false, create: false, update: false, delete: false });
    let active = true;
    setFields([]);
    setListView({});
    setLayoutColumns([]);
    setLayoutLoading(!!table && view === "layouts");
    if (table && view === "layouts")
      Promise.all([
        api<{ columns: Column[] }>(
          `/connections/${connection}/tables/${encodeURIComponent(table)}/schema`,
        ),
        api<{ fields: Field[]; view: ListView }>(
          `/connections/${connection}/tables/${encodeURIComponent(table)}/settings`,
        ),
      ])
        .then(([p, s]) => {
          if (active) {
            setLayoutColumns(p.columns);
            setListView(s.view || {});
            setFields([
              ...p.columns.map(
                (c, i) =>
                  s.fields.find((f) => f.name === c.name) || {
                    name: c.name,
                    label: c.name,
                    section: "",
                    order: i,
                    hidden: false,
                    readOnly: c.generated || c.autoIncrement,
                    widget: "auto",
                  },
              ),
              ...s.fields.filter((f) => f.widget === "join"),
            ]);
          }
        })
        .catch((e) => {
          if (active) fail(e);
        })
        .finally(() => {
          if (active) setLayoutLoading(false);
        });
    return () => {
      active = false;
    };
  }, [connection, table, uid, grants, view]);
  const titles: Record<string, string> = {
    users: "Users & roles",
    connections: "Database connections",
    permissions: "Table access",
    layouts: "Editor layouts",
    audit: "Activity log",
  };
  async function action(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage(msg);
      await reload();
      refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="heading">
        <div className="eyebrow">WORKSPACE SETTINGS</div>
        <h1>{titles[view]}</h1>
        <p>Keep your team, data access, and editing experience organized.</p>
      </div>
      {message && (
        <div className="success" role="status">
          {message}
        </div>
      )}
      {view === "users" && (
        <section className="card">
          <div className="card-title">
            <h2>
              Team members <span className="count">{users.length}</span>
            </h2>
            <button className="primary" onClick={() => setEdit(null)}>
              <Plus size={16} />
              New user
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.username}</strong>
                    </td>
                    <td>{u.isAdmin ? "Administrator" : "Member"}</td>
                    <td>
                      <span className="badge">
                        {u.enabled ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td>
                      <button onClick={() => setEdit(u)}>Edit user</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {view === "connections" && (
        <>
          <div className="section-actions">
            <span>{configs.length} configured connections</span>
            <button className="primary" onClick={() => setEdit(null)}>
              <Plus size={16} />
              Add connection
            </button>
          </div>
          <div className="connection-grid">
            {configs.map((c) => (
              <section className="card connection-card" key={c.id}>
                <span className="table-icon">
                  <Database size={24} />
                </span>
                <h2>{c.name}</h2>
                <p>
                  {c.host}:{c.port}
                </p>
                <dl>
                  <dt>Database</dt>
                  <dd>{c.database}</dd>
                  <dt>Transport</dt>
                  <dd>
                    {c.verifyTls ? "Verified TLS" : "Unencrypted (development)"}
                  </dd>
                </dl>
                <div className="actions">
                  <button onClick={() => setEdit(c)}>
                    <Pencil size={15} />
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      action(
                        () => api(`/admin/connections/${c.id}/test`, "POST"),
                        "Connection successful.",
                      )
                    }
                  >
                    Test connection
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${c.name} and its access rules? Database records will not be deleted.`,
                        )
                      )
                        action(
                          () => api(`/admin/connections/${c.id}`, "DELETE"),
                          "Connection removed.",
                        );
                    }}
                    aria-label={`Remove ${c.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </section>
            ))}
          </div>
          {!configs.length && (
            <Empty
              title="Connect your first database"
              text="Add a MariaDB connection. Your credentials are encrypted at rest."
            />
          )}
        </>
      )}
      {(view === "permissions" || view === "layouts") && (
        <section className="card settings-card">
          <div className="selectors">
            <label>
              Connection
              <select
                value={connection}
                onChange={(e) => {
                  if (connection !== Number(e.target.value)) {
                    setTables([]);
                    setTable("");
                    setConnection(Number(e.target.value));
                  }
                }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Table
              <select value={table} onChange={(e) => setTable(e.target.value)}>
                {tables.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {view === "permissions" && (
              <label>
                User
                <select
                  value={uid}
                  onChange={(e) => setUid(Number(e.target.value))}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.username}
                      {u.isAdmin ? " (administrator — full access)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {view === "permissions" ? (
            <>
              <h2>Allowed operations</h2>
              <p>
                Access is denied by default. Read permission is required for all
                record operations.
              </p>
              <div className="permission-grid">
                {(["read", "create", "update", "delete"] as const).map((k) => (
                  <label className="permission" key={k}>
                    <input
                      type="checkbox"
                      checked={grant[k]}
                      onChange={(e) =>
                        setGrant({ ...grant, [k]: e.target.checked })
                      }
                    />
                    <strong>{k[0].toUpperCase() + k.slice(1)}</strong>
                    <small>
                      {
                        {
                          read: "Browse and search records",
                          create: "Insert new records",
                          update: "Edit existing records",
                          delete: "Permanently remove records",
                        }[k]
                      }
                    </small>
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || !table || !uid}
                onClick={() =>
                  action(
                    () =>
                      api("/admin/grants", "PUT", {
                        userId: uid,
                        connectionId: connection,
                        table,
                        ...grant,
                      }),
                    "Permissions saved.",
                  )
                }
              >
                Save permissions
              </button>
            </>
          ) : (
            <>
              <h2>Record and list layout</h2>
              {!layoutLoading && (
                <ListViewEditor
                  value={listView}
                  columns={layoutColumns}
                  fields={fields}
                  change={setListView}
                />
              )}
              <p>
                Customize labels, sections, order, visibility, and field
                controls. List visibility is independent of editor visibility.
                Required fields must be filled before creating or updating a
                record. Hidden, read-only, and generated fields cannot be marked
                required.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Field label</th>
                      <th>Section</th>
                      <th>Order</th>
                      <th>Control</th>
                      <th>Hide in editor</th>
                      <th>Read-only</th>
                      <th>Required</th>
                      <th>Show in list</th>
                      <th>List order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => (
                      <tr key={f.name}>
                        <td>
                          {f.name}
                          {f.widget === "join" && (
                            <span className="badge">Joined</span>
                          )}
                        </td>
                        {(
                          [
                            "label",
                            "section",
                            "order",
                            "widget",
                            "hidden",
                            "readOnly",
                          ] as const
                        ).map((k) => (
                          <td key={k}>
                            {k === "widget" ? (
                              <select
                                aria-label={`${f.name} control`}
                                value={f[k]}
                                disabled={f.widget === "join"}
                                onChange={(e) =>
                                  setFields(
                                    fields.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            [k]: e.target.value,
                                            lookup:
                                              e.target.value === "lookup"
                                                ? x.lookup
                                                : undefined,
                                            options:
                                              e.target.value === "dropdown"
                                                ? x.options || []
                                                : undefined,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                {f.widget === "join" && (
                                  <option value="join">
                                    Joined (read-only)
                                  </option>
                                )}
                                {[
                                  "auto",
                                  "text",
                                  "textarea",
                                  "number",
                                  "date",
                                  "datetime",
                                  "dropdown",
                                  "checkbox",
                                  "lookup",
                                ].map((w) => (
                                  <option key={w} value={w}>
                                    {w === "datetime"
                                      ? "DateTime"
                                      : w === "date"
                                        ? "Date"
                                        : w === "dropdown"
                                          ? "Dropdown"
                                          : w}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                aria-label={`${f.name} ${k}`}
                                disabled={
                                  f.widget === "join" && k === "readOnly"
                                }
                                type={
                                  k === "hidden" || k === "readOnly"
                                    ? "checkbox"
                                    : k === "order"
                                      ? "number"
                                      : "text"
                                }
                                checked={
                                  typeof f[k] === "boolean"
                                    ? Boolean(f[k])
                                    : undefined
                                }
                                value={
                                  typeof f[k] === "boolean"
                                    ? undefined
                                    : String(f[k])
                                }
                                onChange={(e) =>
                                  setFields(
                                    fields.map((x, j) =>
                                      j === i
                                        ? {
                                            ...x,
                                            required:
                                              (k === "hidden" ||
                                                k === "readOnly") &&
                                              e.target.checked
                                                ? false
                                                : x.required,
                                            [k]:
                                              k === "hidden" || k === "readOnly"
                                                ? e.target.checked
                                                : k === "order"
                                                  ? Number(e.target.value)
                                                  : e.target.value,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            )}
                          </td>
                        ))}
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${f.name} required`}
                            checked={!!f.required}
                            disabled={
                              f.hidden ||
                              f.readOnly ||
                              f.widget === "join" ||
                              layoutColumns.some(
                                (c) =>
                                  c.name === f.name &&
                                  (c.generated || c.autoIncrement),
                              )
                            }
                            onChange={(e) =>
                              setFields((old) =>
                                old.map((x) =>
                                  x.name === f.name
                                    ? { ...x, required: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${f.name} showInList`}
                            checked={f.showInList !== false}
                            onChange={(e) =>
                              setFields((old) =>
                                old.map((x) =>
                                  x.name === f.name
                                    ? { ...x, showInList: e.target.checked }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            aria-label={`${f.name} listOrder`}
                            value={f.listOrder ?? f.order}
                            onChange={(e) =>
                              setFields((old) =>
                                old.map((x) =>
                                  x.name === f.name
                                    ? {
                                        ...x,
                                        listOrder: Number(e.target.value),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={
                  layoutLoading ||
                  !fields.length ||
                  fields.filter((f) => f.widget === "join").length >= 20
                }
                onClick={() => {
                  let n = 1;
                  while (
                    fields.some((f) => f.name.toLowerCase() === `joined_${n}`)
                  )
                    n++;
                  setFields((old) => [
                    ...old,
                    {
                      name: `joined_${n}`,
                      label: "Related value",
                      section: "",
                      order: old.length,
                      hidden: false,
                      readOnly: true,
                      widget: "join",
                      showInList: true,
                      listOrder: old.length,
                      join: {
                        sourceColumn: "",
                        table: "",
                        keyColumn: "",
                        valueColumn: "",
                      },
                    },
                  ]);
                }}
              >
                Add joined field
              </button>
              {fields
                .filter((f) => f.widget === "join")
                .map((f) => (
                  <JoinConfiguration
                    key={`${connection}/${table}/${f.name}`}
                    field={f}
                    connection={connection}
                    tables={tables}
                    sources={fields
                      .filter((x) => x.widget !== "join")
                      .map((x) => x.name)}
                    change={(join) =>
                      setFields((old) =>
                        old.map((x) =>
                          x.name === f.name ? { ...x, join } : x,
                        ),
                      )
                    }
                    remove={() =>
                      setFields((old) => old.filter((x) => x.name !== f.name))
                    }
                  />
                ))}
              {fields
                .filter((f) => f.widget === "dropdown")
                .map((f) => (
                  <DropdownConfiguration
                    key={`${connection}/${table}/${f.name}`}
                    name={f.name}
                    options={f.options || []}
                    change={(options) =>
                      setFields((old) =>
                        old.map((x) =>
                          x.name === f.name ? { ...x, options } : x,
                        ),
                      )
                    }
                  />
                ))}
              {fields
                .filter((f) => f.widget === "lookup")
                .map((f) => (
                  <LookupConfiguration
                    key={`${connection}/${table}/${f.name}`}
                    name={f.name}
                    connection={connection}
                    tables={tables}
                    value={f.lookup}
                    change={(lookup) =>
                      setFields((old) =>
                        old.map((x) =>
                          x.name === f.name ? { ...x, lookup } : x,
                        ),
                      )
                    }
                  />
                ))}
              <button
                className="primary"
                disabled={
                  !table ||
                  busy ||
                  layoutLoading ||
                  fields.length === 0 ||
                  fields.some(
                    (f) =>
                      f.widget === "join" &&
                      (!f.join?.sourceColumn ||
                        !f.join?.table ||
                        !f.join?.keyColumn ||
                        !f.join?.valueColumn),
                  ) ||
                  fields.some(
                    (f) =>
                      f.widget === "dropdown" &&
                      !!dropdownError(f.options || []),
                  )
                }
                onClick={() =>
                  action(
                    () =>
                      api(
                        `/admin/connections/${connection}/tables/${encodeURIComponent(table)}/layout`,
                        "PUT",
                        {
                          fields,
                          view: { ...listView, label: listView.label?.trim() },
                        },
                      ),
                    "Layout saved.",
                  )
                }
              >
                Save layout
              </button>
            </>
          )}
        </section>
      )}
      {view === "audit" && (
        <section className="card">
          <div className="card-title">
            <h2>Recent record changes</h2>
            <span className="count">Latest 200</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Operation</th>
                  <th>Connection / Table</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.at).toLocaleString()}</td>
                    <td>{a.actor}</td>
                    <td>
                      <span className="badge">{a.action}</span>
                    </td>
                    <td>{a.resource}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!audit.length && (
            <Empty
              title="A clean slate"
              text="Record changes will appear here. Field values and passwords are never logged."
            />
          )}
        </section>
      )}
      {edit !== undefined && (
        <Modal
          title={
            view === "users"
              ? edit
                ? "Edit user"
                : "New user"
              : edit
                ? "Edit connection"
                : "New connection"
          }
          close={() => setEdit(undefined)}
        >
          <AdminForm
            kind={view}
            initial={edit}
            save={async (data) => {
              await api(
                `/admin/${view}${edit ? "/" + edit.id : ""}`,
                edit ? "PUT" : "POST",
                data,
              );
              setEdit(undefined);
              await reload();
              refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
function AdminForm({
  kind,
  initial,
  save,
}: {
  kind: string;
  initial: User | Connection | null;
  save: (data: unknown) => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const value = (name: string) =>
    String((initial as unknown as Record<string, unknown>)?.[name] ?? "");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        const data: Record<string, unknown> = Object.fromEntries(f);
        if (kind === "users") {
          data.isAdmin = f.has("isAdmin");
          data.enabled = f.has("enabled");
        } else {
          data.verifyTls = f.has("verifyTls");
          data.port = Number(data.port);
        }
        if (initial && !data.password) data.password = null;
        try {
          await save(data);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="editor-grid">
        {(kind === "users"
          ? ["username"]
          : ["name", "host", "port", "database", "username"]
        ).map((n) => (
          <label key={n}>
            {n[0].toUpperCase() + n.slice(1)}
            <input
              name={n}
              type={n === "port" ? "number" : "text"}
              min={n === "port" ? 1 : undefined}
              max={n === "port" ? 65535 : undefined}
              defaultValue={value(n) || (n === "port" ? "3306" : "")}
              required
              autoComplete="off"
            />
          </label>
        ))}
        <label className="wide">
          {initial ? "New password (leave blank to keep current)" : "Password"}
          <input
            name="password"
            type="password"
            required={!initial}
            minLength={kind === "users" ? 14 : undefined}
            autoComplete="new-password"
          />
        </label>
        {kind === "users" ? (
          <>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="isAdmin"
                defaultChecked={(initial as User)?.isAdmin ?? false}
              />
              Administrator
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={(initial as User)?.enabled ?? true}
              />
              Enabled
            </label>
          </>
        ) : (
          <label className="checkbox-label wide">
            <input
              name="verifyTls"
              type="checkbox"
              defaultChecked={(initial as Connection)?.verifyTls ?? true}
            />
            Verify TLS certificate (disable only for trusted local development)
          </label>
        )}
      </div>
      <div className="form-actions">
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
