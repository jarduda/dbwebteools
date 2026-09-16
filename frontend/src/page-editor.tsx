import { useEffect, useState } from "react";
import {
  api,
  type Connection,
  type Column,
  type Field,
  type RelatedTab,
  type RecordPageDefinition,
} from "./api";

function newTabId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function PageEditor({ connections }: { connections: Connection[] }) {
  const [pages, setPages] = useState<RecordPageDefinition[]>([]),
    [draft, setDraft] = useState<RecordPageDefinition | null>(null),
    [tables, setTables] = useState<string[]>([]),
    [columns, setColumns] = useState<Column[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const blank = (): RecordPageDefinition => ({
    id: 0,
    connectionId: connections[0]?.id || 0,
    table: "",
    name: "",
    linkColumn: "",
    tabs: [],
  });
  useEffect(() => {
    let active = true;
    api<RecordPageDefinition[]>("/admin/pages")
      .then((p) => {
        if (active) {
          setPages(p);
          setDraft(p[0] || blank());
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setTables([]);
    if (draft?.connectionId)
      api<string[]>(`/connections/${draft.connectionId}/tables`)
        .then((t) => {
          if (active) setTables(t);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [draft?.connectionId]);
  useEffect(() => {
    let active = true;
    setColumns([]);
    if (draft?.connectionId && draft.table)
      api<{ columns: Column[] }>(
        `/connections/${draft.connectionId}/tables/${encodeURIComponent(draft.table)}/schema`,
      )
        .then((r) => {
          if (active) setColumns(r.columns);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [draft?.connectionId, draft?.table]);
  const update = (patch: Partial<RecordPageDefinition>) => {
    setDraft((old) => (old ? { ...old, ...patch } : old));
    setMessage("");
  };
  return (
    <>
      <div className="heading">
        <div className="eyebrow">ADMINISTRATION</div>
        <h1>Page editor</h1>
        <p>
          Build record pages with a main-object layout and related lists in
          tabs.
        </p>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="selectors">
        <label>
          Page
          <select
            aria-label="Page"
            value={draft?.id || 0}
            onChange={(e) => {
              const selected = pages.find(
                (p) => p.id === Number(e.target.value),
              );
              setDraft(selected || blank());
              setError("");
              setMessage("");
            }}
          >
            <option value={0}>New page…</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.table}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setDraft(blank());
            setError("");
            setMessage("");
          }}
        >
          New page
        </button>
      </div>
      {draft && (
        <form
          className="card page-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              let saved = draft;
              if (draft.id) await api(`/admin/pages/${draft.id}`, "PUT", draft);
              else
                saved = await api<RecordPageDefinition>(
                  "/admin/pages",
                  "POST",
                  draft,
                );
              setDraft(saved);
              setPages(await api<RecordPageDefinition[]>("/admin/pages"));
              setMessage("Page saved.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="page-config-grid">
            <label>
              Page name
              <input
                required
                maxLength={150}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Page connection
              <select
                aria-label="Page connection"
                required
                disabled={!!draft.id}
                value={draft.connectionId || ""}
                onChange={(e) =>
                  update({
                    connectionId: Number(e.target.value),
                    table: "",
                    linkColumn: "",
                    tabs: [],
                  })
                }
              >
                <option value="">Choose connection…</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Main table
              <select
                aria-label="Main table"
                required
                disabled={!!draft.id}
                value={draft.table}
                onChange={(e) =>
                  update({ table: e.target.value, linkColumn: "", tabs: [] })
                }
              >
                <option value="">Choose table…</option>
                {tables.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              List drill-down column
              <select
                aria-label="List drill-down column"
                required
                value={draft.linkColumn}
                disabled={!columns.length}
                onChange={(e) => update({ linkColumn: e.target.value })}
              >
                <option value="">Choose link column…</option>
                {columns.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          <p>
            The main object uses this table's <strong>Editor layout</strong>{" "}
            (labels, sections, visibility, lookups, joined fields and formulas).
            Make the drill-down column visible in the table's list layout.
            Different pages for the same table must use different list
            drill-down columns.
          </p>
          {columns.length > 0 && !columns.some((c) => c.primaryKey) && (
            <p role="alert">
              This table needs a primary key before a page can be created.
            </p>
          )}
          <h2>Related objects</h2>
          <p>
            Each tab shows records where its related column equals the selected
            parent column. Choose display columns in the order you want them
            shown.
          </p>
          {draft.tabs.map((tab, i) => (
            <RelatedTabEditor
              key={tab.id}
              tab={tab}
              number={i + 1}
              connection={draft.connectionId}
              tables={tables}
              parentColumns={columns}
              pages={pages}
              change={(next) =>
                update({
                  tabs: draft.tabs.map((t) => (t.id === tab.id ? next : t)),
                })
              }
              remove={() =>
                update({ tabs: draft.tabs.filter((t) => t.id !== tab.id) })
              }
              move={(direction) => {
                const next = [...draft.tabs];
                const index = i + direction;
                if (index < 0 || index >= next.length) return;
                [next[i], next[index]] = [next[index], next[i]];
                update({ tabs: next });
              }}
            />
          ))}
          <button
            type="button"
            disabled={!draft.table || draft.tabs.length >= 12}
            onClick={() =>
              update({
                tabs: [
                  ...draft.tabs,
                  {
                    id: newTabId(),
                    label: `Related ${draft.tabs.length + 1}`,
                    table: "",
                    parentColumn: columns.find((c) => c.primaryKey)?.name || "",
                    relatedColumn: "",
                    columns: [],
                  },
                ],
              })
            }
          >
            Add related tab
          </button>
          <div className="form-actions">
            {draft.id > 0 && (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (
                    !confirm(
                      `Delete page "${draft.name}"? Database records will not be deleted.`,
                    )
                  )
                    return;
                  setBusy(true);
                  setError("");
                  try {
                    await api(`/admin/pages/${draft.id}`, "DELETE");
                    setPages(await api<RecordPageDefinition[]>("/admin/pages"));
                    setDraft(blank());
                    setMessage("Page deleted. Database records are unchanged.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete page
              </button>
            )}
            <button
              type="submit"
              className="primary"
              disabled={busy || !columns.some((c) => c.primaryKey)}
            >
              {busy ? "Saving…" : "Save page"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function RelatedTabEditor({
  tab,
  number,
  connection,
  tables,
  parentColumns,
  pages,
  change,
  remove,
  move,
}: {
  tab: RelatedTab;
  number: number;
  connection: number;
  tables: string[];
  parentColumns: Column[];
  pages: RecordPageDefinition[];
  change: (tab: RelatedTab) => void;
  remove: () => void;
  move: (direction: number) => void;
}) {
  const [columns, setColumns] = useState<Column[]>([]),
    [fields, setFields] = useState<Field[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setColumns([]);
    setFields([]);
    setError("");
    if (tab.table) {
      const base = `/connections/${connection}/tables/${encodeURIComponent(tab.table)}`;
      Promise.all([
        api<{ columns: Column[] }>(base + "/schema"),
        api<{ fields: Field[] }>(base + "/settings"),
      ])
        .then(([schema, settings]) => {
          if (active) {
            setColumns(schema.columns);
            setFields(settings.fields);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [connection, tab.table]);
  const available = [
    ...columns.map((c) => c.name),
    ...fields
      .filter((f) => ["join", "formula"].includes(f.widget))
      .map((f) => f.name),
  ];
  const targetPages = pages.filter(
    (p) => p.connectionId === connection && p.table === tab.table,
  );
  return (
    <fieldset className="related-config">
      <legend>Related tab {number}</legend>
      <div className="page-config-grid">
        <label>
          Tab label
          <input
            aria-label={`Tab ${number} label`}
            required
            maxLength={150}
            value={tab.label}
            onChange={(e) => change({ ...tab, label: e.target.value })}
          />
        </label>
        <label>
          Related table
          <select
            aria-label={`Tab ${number} table`}
            required
            value={tab.table}
            onChange={(e) =>
              change({
                ...tab,
                table: e.target.value,
                relatedColumn: "",
                columns: [],
                targetPageId: null,
                linkColumn: null,
              })
            }
          >
            <option value="">Choose table…</option>
            {tables.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Parent column
          <select
            aria-label={`Tab ${number} parent column`}
            required
            value={tab.parentColumn}
            onChange={(e) => change({ ...tab, parentColumn: e.target.value })}
          >
            <option value="">Choose column…</option>
            {parentColumns.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Related column
          <select
            aria-label={`Tab ${number} related column`}
            required
            value={tab.relatedColumn}
            disabled={!columns.length}
            onChange={(e) => change({ ...tab, relatedColumn: e.target.value })}
          >
            <option value="">Choose column…</option>
            {columns.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="visible-related-columns">
        <legend>Visible columns</legend>
        <div className="lookup-checks">
          {available.map((name) => (
            <label key={name} className="checkbox-label">
              <input
                type="checkbox"
                aria-label={`Tab ${number} show ${name}`}
                checked={tab.columns.includes(name)}
                onChange={(e) =>
                  change({
                    ...tab,
                    columns: e.target.checked
                      ? [...tab.columns, name]
                      : tab.columns.filter((c) => c !== name),
                    linkColumn:
                      !e.target.checked && tab.linkColumn === name
                        ? null
                        : tab.linkColumn,
                  })
                }
              />
              {fields.find((f) => f.name === name)?.label || name}
              <small>{name}</small>
            </label>
          ))}
        </div>
        <ol className="column-order">
          {tab.columns.map((name, i) => (
            <li key={name}>
              <span>{fields.find((f) => f.name === name)?.label || name}</span>
              <button
                type="button"
                disabled={i === 0}
                aria-label={`Tab ${number} move ${name} up`}
                onClick={() => {
                  const next = [...tab.columns];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  change({ ...tab, columns: next });
                }}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === tab.columns.length - 1}
                aria-label={`Tab ${number} move ${name} down`}
                onClick={() => {
                  const next = [...tab.columns];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  change({ ...tab, columns: next });
                }}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
      </fieldset>
      <div className="page-config-grid">
        <label>
          Destination page
          <select
            aria-label={`Tab ${number} destination page`}
            value={tab.targetPageId || ""}
            onChange={(e) =>
              change({
                ...tab,
                targetPageId: e.target.value ? Number(e.target.value) : null,
                linkColumn: null,
              })
            }
          >
            <option value="">No drill-down</option>
            {targetPages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {tab.targetPageId && (
          <label>
            Drill-down column
            <select
              aria-label={`Tab ${number} drill-down column`}
              required
              value={tab.linkColumn || ""}
              onChange={(e) => change({ ...tab, linkColumn: e.target.value })}
            >
              <option value="">Choose visible column…</option>
              {tab.columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!targetPages.length && tab.table && (
        <p>Create a page for this related table to enable drill-down.</p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          aria-label={`Move tab ${number} up`}
          onClick={() => move(-1)}
          disabled={number === 1}
        >
          Move tab up
        </button>
        <button
          type="button"
          aria-label={`Move tab ${number} down`}
          onClick={() => move(1)}
        >
          Move tab down
        </button>
        <button type="button" onClick={remove}>
          Remove tab {number}
        </button>
      </div>
    </fieldset>
  );
}
