import { useEffect, useState } from "react";
import { api, type Connection } from "./api";

type SchemaColumn = {
  name: string;
  type: string;
  sqlType: string;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  generated: boolean;
  length: number | null;
  precision: number | null;
  scale: number | null;
  default: string | null;
  relatedTable: string | null;
  relatedKey: string | null;
  uniqueKey: boolean;
  editBlocked: string | null;
};
type Schema = { version: string; columns: SchemaColumn[] };
type Draft = {
  name: string;
  type: string;
  nullable: boolean;
  length: number;
  precision: number;
  scale: number;
  relatedTable: string;
  relatedKey: string;
  displayColumn: string;
};
const blank = (): Draft => ({
  name: "",
  type: "text",
  nullable: true,
  length: 255,
  precision: 18,
  scale: 2,
  relatedTable: "",
  relatedKey: "",
  displayColumn: "",
});
const kind = (c: SchemaColumn) =>
  ({
    varchar: "text",
    bigint: "integer",
    int: "integer",
    smallint: "integer",
    mediumint: "integer",
    tinyint: "boolean",
    text: "longtext",
    timestamp: "datetime",
  })[c.type] || c.type;
export function SchemaEditor({
  connections,
  onChanged,
}: {
  connections: Connection[];
  onChanged: () => void;
}) {
  const [connection, setConnection] = useState(connections[0]?.id || 0);
  const [tables, setTables] = useState<string[]>([]),
    [table, setTable] = useState("");
  const [schema, setSchema] = useState<Schema | null>(null),
    [target, setTarget] = useState<Schema | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null),
    [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false),
    [newName, setNewName] = useState(""),
    [primaryKey, setPrimaryKey] = useState("id");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [revision, setRevision] = useState(0);
  const base = `/admin/connections/${connection}/schema`;
  useEffect(() => {
    let active = true;
    setTables([]);
    setTable("");
    setSchema(null);
    setDraft(null);
    setCreating(false);
    setError("");
    setMessage("");
    if (connection)
      api<string[]>(`/connections/${connection}/tables`)
        .then((t) => {
          if (active) {
            setTables(t);
            setTable(t[0] || "");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [connection]);
  useEffect(() => {
    let active = true;
    setSchema(null);
    setDraft(null);
    setError("");
    setLoading(true);
    if (table)
      api<Schema>(`${base}/tables/${encodeURIComponent(table)}`)
        .then((s) => {
          if (active) setSchema(s);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    else setLoading(false);
    return () => {
      active = false;
    };
  }, [base, table, revision]);
  const targetTable = draft?.relatedTable || "";
  useEffect(() => {
    let active = true;
    setTarget(null);
    if (targetTable)
      api<Schema>(`${base}/tables/${encodeURIComponent(targetTable)}`)
        .then((s) => {
          if (active) setTarget(s);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [base, targetTable]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const patch = (value: Partial<Draft>) =>
    setDraft((old) => (old ? { ...old, ...value } : old));
  return (
    <div className="schema-editor">
      <div className="heading">
        <div className="eyebrow">ADMINISTRATION</div>
        <h1>Table designer</h1>
        <p>Create tables and manage column parameters for a connection.</p>
      </div>
      <div className="selectors">
        <label>
          Connection
          <select
            aria-label="Schema connection"
            disabled={busy}
            value={connection}
            onChange={(e) => setConnection(Number(e.target.value))}
          >
            <option value={0}>Select connection</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Table
          <select
            aria-label="Schema table"
            disabled={busy}
            value={table}
            onChange={(e) => {
              setTable(e.target.value);
              setCreating(false);
              setMessage("");
            }}
          >
            <option value="">Select table</option>
            {tables.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="toolbar">
        <div className="actions">
          <button
            className="primary"
            disabled={!connection || busy}
            onClick={() => {
              setCreating(true);
              setDraft(null);
              setNewName("");
              setPrimaryKey("id");
              setError("");
            }}
          >
            New table
          </button>
          <button
            disabled={!table || busy}
            onClick={() => setRevision((v) => v + 1)}
          >
            Refresh structure
          </button>
        </div>
      </div>
      {creating && (
        <form
          className="card"
          aria-label="Create table"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await api<Schema>(`${base}/tables`, "POST", {
                name: newName,
                primaryKey,
              });
              setTables((old) => [...old, newName].sort());
              setTable(newName);
              setSchema(result);
              setCreating(false);
              setMessage("Table created with an auto-increment primary key.");
            });
          }}
        >
          <h2>New table</h2>
          <div className="form-grid">
            <label>
              Table name
              <input
                aria-label="New table name"
                required
                pattern="[A-Za-z_][A-Za-z0-9_]{0,63}"
                maxLength={64}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Primary key name
              <input
                required
                aria-label="Primary key name"
                pattern="[A-Za-z_][A-Za-z0-9_]{0,63}"
                maxLength={64}
                value={primaryKey}
                onChange={(e) => setPrimaryKey(e.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          <p className="muted">
            A unique BIGINT primary key is generated automatically for each new
            record.
          </p>
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Create table
            </button>
          </div>
        </form>
      )}
      {loading && <p role="status">Loading table structure…</p>}
      {schema && !creating && (
        <section className="card" aria-label="Table structure">
          <div className="card-title">
            <h2>{table}</h2>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setDraft(blank());
                setEditing(false);
                setError("");
                setMessage("");
              }}
            >
              Add column
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Database type</th>
                  <th>Allows NULL</th>
                  <th>Relation / key</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schema.columns.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{c.sqlType}</td>
                    <td>{c.nullable ? "Yes" : "No"}</td>
                    <td>
                      {c.primaryKey
                        ? "Primary key"
                        : c.relatedTable
                          ? `${c.relatedTable}.${c.relatedKey}`
                          : c.uniqueKey
                            ? "Unique key"
                            : "—"}
                    </td>
                    <td>
                      <button
                        disabled={busy || !!c.editBlocked}
                        title={c.editBlocked || "Edit column parameters"}
                        aria-label={`Edit column ${c.name}`}
                        onClick={() => {
                          setDraft({
                            ...blank(),
                            name: c.name,
                            type: kind(c),
                            nullable: c.nullable,
                            length: c.length || 255,
                            precision: c.precision || 18,
                            scale: c.scale ?? 2,
                          });
                          setEditing(true);
                          setError("");
                          setMessage("");
                        }}
                      >
                        Edit
                      </button>
                      {c.editBlocked && (
                        <small className="muted"> {c.editBlocked}</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {draft && schema && !creating && (
        <form
          className="card schema-column-form"
          aria-label={editing ? "Edit column" : "Add column"}
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await api<Schema>(
                `${base}/tables/${encodeURIComponent(table)}/${editing ? "modify-column" : "columns"}`,
                "POST",
                { ...draft, version: schema.version },
              );
              setSchema(result);
              setDraft(null);
              setMessage(
                editing
                  ? "Column parameters updated."
                  : draft.type === "relation"
                    ? "Relation column created. Foreign key and layout lookup configured."
                    : "Column created.",
              );
            });
          }}
        >
          <h2>{editing ? "Edit column parameters" : "Add column"}</h2>
          <div className="form-grid">
            <label>
              Column name
              <input
                aria-label="Column name"
                required
                disabled={editing || busy}
                pattern="[A-Za-z_][A-Za-z0-9_]{0,63}"
                maxLength={64}
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              Type
              <select
                aria-label="Column type"
                value={draft.type}
                disabled={editing || busy}
                onChange={(e) =>
                  patch({
                    type: e.target.value,
                    relatedTable: "",
                    relatedKey: "",
                    displayColumn: "",
                  })
                }
              >
                {Object.entries({
                  text: "Text",
                  longtext: "Long text",
                  integer: "Integer",
                  decimal: "Decimal number",
                  boolean: "Boolean",
                  date: "Date",
                  datetime: "Date and time",
                  relation: "Relation",
                }).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {draft.type === "text" && (
              <label>
                Text length
                <input
                  aria-label="Text length"
                  type="number"
                  required
                  min={1}
                  max={16383}
                  value={draft.length}
                  disabled={busy}
                  onChange={(e) => patch({ length: Number(e.target.value) })}
                />
              </label>
            )}
            {draft.type === "decimal" && (
              <>
                <label>
                  Total digits (precision)
                  <input
                    aria-label="Total digits"
                    type="number"
                    required
                    min={1}
                    max={65}
                    value={draft.precision}
                    disabled={busy}
                    onChange={(e) =>
                      patch({ precision: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Decimal places
                  <input
                    aria-label="Decimal places"
                    type="number"
                    required
                    min={0}
                    max={Math.min(30, draft.precision)}
                    value={draft.scale}
                    disabled={busy}
                    onChange={(e) => patch({ scale: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.nullable}
              disabled={busy}
              onChange={(e) => patch({ nullable: e.target.checked })}
            />
            Allow NULL (empty values)
          </label>
          {draft.type === "relation" && (
            <>
              <div className="form-grid">
                <label>
                  Related table
                  <select
                    aria-label="Related table"
                    required
                    disabled={busy}
                    value={draft.relatedTable}
                    onChange={(e) =>
                      patch({
                        relatedTable: e.target.value,
                        relatedKey: "",
                        displayColumn: "",
                      })
                    }
                  >
                    <option value="">Select table</option>
                    {tables.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Related key
                  <select
                    aria-label="Related key"
                    required
                    disabled={busy || !target}
                    value={draft.relatedKey}
                    onChange={(e) => patch({ relatedKey: e.target.value })}
                  >
                    <option value="">Select unique key</option>
                    {target?.columns
                      .filter(
                        (c) =>
                          c.uniqueKey &&
                          !c.nullable &&
                          !c.generated &&
                          [
                            "bigint",
                            "int",
                            "smallint",
                            "mediumint",
                            "tinyint",
                            "varchar",
                            "char",
                          ].includes(c.type),
                      )
                      .map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Display column
                  <select
                    aria-label="Relation display column"
                    required
                    disabled={busy || !target}
                    value={draft.displayColumn}
                    onChange={(e) => patch({ displayColumn: e.target.value })}
                  >
                    <option value="">Select display value</option>
                    {target?.columns
                      .filter(
                        (c) =>
                          !["binary", "varbinary", "geometry"].includes(
                            c.type,
                          ) && !c.type.includes("blob"),
                      )
                      .map((c) => (
                        <option key={c.name}>{c.name}</option>
                      ))}
                  </select>
                </label>
              </div>
              <p className="notice">
                The key type is copied automatically. A foreign key prevents
                missing references and deletion of referenced records. A
                searchable lookup is added to the layout.
              </p>
            </>
          )}
          {editing && (
            <p className="muted">
              Names and types remain unchanged. Defaults, indexes and comments
              are preserved. Decimal places and integer capacity cannot be
              reduced.
            </p>
          )}
          {!editing && (
            <p className="muted">
              For a table with existing records, allow NULL first, populate the
              column, then make it required.
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Applying…" : editing ? "Save column" : "Create column"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
