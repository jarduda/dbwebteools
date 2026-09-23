import { useEffect, useState } from "react";
import {
  api,
  type Column,
  type Connection,
  type ObjectDefinition,
  type ObjectField,
  type Field,
  type ListView,
} from "./api";
import { ListViewEditor } from "./list-view";
import { JoinConfiguration } from "./layout-fields";
import { DropdownConfiguration, dropdownError } from "./field-controls";
import { LookupConfiguration } from "./lookups";
import { CreationDefaultEditor } from "./creation-defaults";
import { FormulaValidator } from "./formula-validator";
import { SumupConfiguration } from "./sumups";

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
export function ObjectEditor({
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
    [target, setTarget] = useState<Schema | null>(null),
    [objectFields, setObjectFields] = useState<ObjectField[]>([]),
    [objectView, setObjectView] = useState<ListView>({}),
    [objectLoading, setObjectLoading] = useState(false);
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
    setObjectFields([]);
    setObjectView({});
    setError("");
    setLoading(true);
    setObjectLoading(true);
    if (table)
      Promise.all([
        api<Schema>(`${base}/tables/${encodeURIComponent(table)}`),
        api<ObjectDefinition>(
          `/admin/connections/${connection}/tables/${encodeURIComponent(table)}/object`,
        ),
      ])
        .then(([nextSchema, object]) => {
          if (active) {
            setSchema(nextSchema);
            setObjectFields(object.fields);
            setObjectView(object.view || {});
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) {
            setLoading(false);
            setObjectLoading(false);
          }
        });
    else {
      setLoading(false);
      setObjectLoading(false);
    }
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
      setRevision((value) => value + 1);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const patch = (value: Partial<Draft>) =>
    setDraft((old) => (old ? { ...old, ...value } : old));
  const columns: Column[] = (schema?.columns || []).map((column) => ({
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    primaryKey: column.primaryKey,
    generated: column.generated,
    autoIncrement: column.autoIncrement,
    default: column.default,
  }));
  const runtimeFields: Field[] = objectFields.map((field, index) => ({
    ...field,
    section: "",
    order: index,
    hidden: false,
    showInList: true,
    listOrder: index,
  }));
  const updateField = (name: string, patch: Partial<ObjectField>) =>
    setObjectFields((old) =>
      old.map((field) =>
        field.name === name ? { ...field, ...patch } : field,
      ),
    );
  return (
    <div className="object-editor">
      <div className="heading">
        <div className="eyebrow">ADMINISTRATION</div>
        <h1>Object editor</h1>
        <p>
          Create database structure and define the object behavior used by the
          application.
        </p>
      </div>
      <div className="selectors">
        <label>
          Connection
          <select
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
      {draft && schema && !creating && (
        <form
          className="card schema-column-form"
          aria-label={editing ? "Edit database field" : "Add field"}
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
                    ? "Relation field created. Foreign key and object lookup configured."
                    : "Field created.",
              );
            });
          }}
        >
          <h2>{editing ? "Edit database field" : "Add field"}</h2>
          <div className="form-grid">
            <label>
              Field name
              <input
                aria-label="Field name"
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
                searchable lookup is added to the object definition.
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
              {busy ? "Applying…" : editing ? "Save field" : "Create field"}
            </button>
          </div>
        </form>
      )}
      {schema && !creating && (
        <section
          className="card object-definition"
          aria-label="Object definition"
        >
          <div className="card-title">
            <div>
              <h2>Application object</h2>
              <p className="muted">
                Define validation, controls, relationships, defaults, formulas,
                joins and aggregates alongside their database definitions.
                Sections, order and visibility belong to Layout editor.
              </p>
            </div>
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
              Add field
            </button>
          </div>
          {objectLoading ? (
            <p role="status">Loading object definition…</p>
          ) : (
            <>
              <ListViewEditor
                value={objectView}
                columns={columns}
                fields={runtimeFields}
                change={setObjectView}
              />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Database definition</th>
                      <th>Label</th>
                      <th>Control / behavior</th>
                      <th>Read-only</th>
                      <th>Required</th>
                      <th>Creation default</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objectFields.map((field) => {
                      const column = columns.find((c) => c.name === field.name);
                      const schemaColumn = schema.columns.find(
                        (c) => c.name === field.name,
                      );
                      const virtual = ["join", "formula"].includes(
                        field.widget,
                      );
                      return (
                        <tr key={field.name}>
                          <td>
                            {field.name}
                            {virtual && <span className="badge">Virtual</span>}
                          </td>
                          <td>
                            {schemaColumn ? (
                              <>
                                <strong>{schemaColumn.sqlType}</strong>
                                <small className="muted database-field-details">
                                  {schemaColumn.nullable
                                    ? "Allows NULL"
                                    : "Required in database"}
                                  {schemaColumn.primaryKey
                                    ? " · Primary key"
                                    : schemaColumn.relatedTable
                                      ? ` · ${schemaColumn.relatedTable}.${schemaColumn.relatedKey}`
                                      : schemaColumn.uniqueKey
                                        ? " · Unique key"
                                        : ""}
                                </small>
                              </>
                            ) : (
                              "Application-only"
                            )}
                          </td>
                          <td>
                            <input
                              aria-label={`${field.name} label`}
                              maxLength={150}
                              value={field.label}
                              onChange={(e) =>
                                updateField(field.name, {
                                  label: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td>
                            <select
                              aria-label={`${field.name} control`}
                              value={field.widget}
                              disabled={virtual}
                              onChange={(e) => {
                                const widget = e.target.value;
                                updateField(field.name, {
                                  widget,
                                  creationDefault:
                                    widget === "sumup"
                                      ? null
                                      : field.creationDefault,
                                  sumup:
                                    widget === "sumup"
                                      ? field.sumup
                                      : undefined,
                                  readOnly:
                                    widget === "sumup" || field.readOnly,
                                  required:
                                    widget === "sumup" ? false : field.required,
                                  lookup:
                                    widget === "lookup"
                                      ? field.lookup
                                      : undefined,
                                  options:
                                    widget === "dropdown"
                                      ? field.options || []
                                      : undefined,
                                });
                              }}
                            >
                              {field.widget === "formula" && (
                                <option value="formula">
                                  Formula (read-only)
                                </option>
                              )}
                              {field.widget === "join" && (
                                <option value="join">Joined (read-only)</option>
                              )}
                              {column &&
                                !column.primaryKey &&
                                !column.autoIncrement &&
                                !column.generated &&
                                [
                                  "tinyint",
                                  "smallint",
                                  "mediumint",
                                  "int",
                                  "bigint",
                                  "decimal",
                                ].includes(column.type) && (
                                  <option value="sumup">
                                    Sum-up (stored total)
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
                              ].map((widget) => (
                                <option key={widget} value={widget}>
                                  {widget === "datetime"
                                    ? "DateTime"
                                    : widget[0].toUpperCase() + widget.slice(1)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${field.name} readOnly`}
                              checked={field.readOnly}
                              disabled={virtual || field.widget === "sumup"}
                              onChange={(e) =>
                                updateField(field.name, {
                                  readOnly: e.target.checked,
                                  required: e.target.checked
                                    ? false
                                    : field.required,
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`${field.name} required`}
                              checked={!!field.required}
                              disabled={
                                field.readOnly ||
                                virtual ||
                                !!column?.generated ||
                                !!column?.autoIncrement
                              }
                              onChange={(e) =>
                                updateField(field.name, {
                                  required: e.target.checked,
                                })
                              }
                            />
                          </td>
                          <td>
                            <CreationDefaultEditor
                              field={{
                                ...field,
                                section: "",
                                order: 0,
                                hidden: false,
                                showInList: true,
                              }}
                              column={column}
                              change={(creationDefault) =>
                                updateField(field.name, { creationDefault })
                              }
                            />
                          </td>
                          <td>
                            {schemaColumn ? (
                              <>
                                <button
                                  disabled={busy || !!schemaColumn.editBlocked}
                                  title={
                                    schemaColumn.editBlocked ||
                                    "Edit database field"
                                  }
                                  aria-label={`Edit field ${schemaColumn.name}`}
                                  onClick={() => {
                                    setDraft({
                                      ...blank(),
                                      name: schemaColumn.name,
                                      type: kind(schemaColumn),
                                      nullable: schemaColumn.nullable,
                                      length: schemaColumn.length || 255,
                                      precision: schemaColumn.precision || 18,
                                      scale: schemaColumn.scale ?? 2,
                                    });
                                    setEditing(true);
                                    setError("");
                                    setMessage("");
                                  }}
                                >
                                  Edit
                                </button>
                                {schemaColumn.editBlocked && (
                                  <small className="muted">
                                    {" "}
                                    {schemaColumn.editBlocked}
                                  </small>
                                )}
                              </>
                            ) : (
                              "Configured below"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="actions object-field-actions">
                <button
                  type="button"
                  disabled={
                    objectFields.filter((f) =>
                      ["join", "formula"].includes(f.widget),
                    ).length >= 20
                  }
                  onClick={() => {
                    let n = 1;
                    while (objectFields.some((f) => f.name === `joined_${n}`))
                      n++;
                    setObjectFields((old) => [
                      ...old,
                      {
                        name: `joined_${n}`,
                        label: "Related value",
                        readOnly: true,
                        widget: "join",
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
                <button
                  type="button"
                  disabled={
                    objectFields.filter((f) =>
                      ["join", "formula"].includes(f.widget),
                    ).length >= 20
                  }
                  onClick={() => {
                    let n = 1;
                    while (objectFields.some((f) => f.name === `formula_${n}`))
                      n++;
                    setObjectFields((old) => [
                      ...old,
                      {
                        name: `formula_${n}`,
                        label: "Calculated value",
                        readOnly: true,
                        widget: "formula",
                        formula: "",
                      },
                    ]);
                  }}
                >
                  Add formula field
                </button>
              </div>
              {runtimeFields
                .filter((field) => field.widget === "formula")
                .map((field) => (
                  <fieldset
                    className="lookup-config formula-config"
                    key={field.name}
                  >
                    <legend>{field.name} formula</legend>
                    <FormulaValidator
                      connection={connection}
                      table={table}
                      field={field}
                      fields={runtimeFields}
                    />
                    <label>
                      Expression
                      <textarea
                        aria-label={`${field.name} expression`}
                        maxLength={1024}
                        value={field.formula || ""}
                        onChange={(e) =>
                          updateField(field.name, { formula: e.target.value })
                        }
                      />
                    </label>
                    <p>
                      Calculated on the server. Reference stored columns in
                      square brackets, for example{" "}
                      <code>Round([price] * [quantity], 2)</code>.
                    </p>
                    <button
                      type="button"
                      aria-label={`Remove ${field.name}`}
                      onClick={() =>
                        setObjectFields((old) =>
                          old.filter((item) => item.name !== field.name),
                        )
                      }
                    >
                      Remove formula field
                    </button>
                  </fieldset>
                ))}
              {runtimeFields
                .filter((field) => field.widget === "join")
                .map((field) => (
                  <JoinConfiguration
                    key={`${connection}/${table}/${field.name}`}
                    field={field}
                    connection={connection}
                    tables={tables}
                    sources={objectFields
                      .filter(
                        (item) => !["join", "formula"].includes(item.widget),
                      )
                      .map((item) => item.name)}
                    change={(join) => updateField(field.name, { join })}
                    remove={() =>
                      setObjectFields((old) =>
                        old.filter((item) => item.name !== field.name),
                      )
                    }
                  />
                ))}
              {objectFields
                .filter((field) => field.widget === "dropdown")
                .map((field) => (
                  <DropdownConfiguration
                    key={`${connection}/${table}/${field.name}`}
                    name={field.name}
                    options={field.options || []}
                    change={(options) => updateField(field.name, { options })}
                  />
                ))}
              {objectFields
                .filter((field) => field.widget === "sumup")
                .map((field) => (
                  <SumupConfiguration
                    key={`${connection}/${table}/${field.name}`}
                    name={field.name}
                    connection={connection}
                    table={table}
                    value={field.sumup}
                    change={(sumup) => updateField(field.name, { sumup })}
                  />
                ))}
              {objectFields
                .filter((field) => field.widget === "lookup")
                .map((field) => (
                  <LookupConfiguration
                    key={`${connection}/${table}/${field.name}`}
                    name={field.name}
                    connection={connection}
                    tables={tables}
                    destinations={columns.filter(
                      (column) =>
                        !objectFields.some(
                          (item) =>
                            item.name === column.name &&
                            ["lookup", "sumup"].includes(item.widget),
                        ),
                    )}
                    value={field.lookup}
                    change={(lookup) => updateField(field.name, { lookup })}
                  />
                ))}
              {objectFields.some((field) => field.widget === "sumup") && (
                <button
                  disabled={busy || objectLoading}
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `/admin/connections/${connection}/tables/${encodeURIComponent(table)}/sumups/recalculate`,
                        "POST",
                      );
                      setMessage(
                        "Sum-ups recalculated from all existing child records.",
                      );
                    })
                  }
                >
                  Recalculate saved sum-ups
                </button>
              )}
              <button
                className="primary"
                disabled={
                  busy ||
                  objectLoading ||
                  !table ||
                  objectFields.length === 0 ||
                  objectFields.some(
                    (field) =>
                      field.widget === "dropdown" &&
                      !!dropdownError(field.options || []),
                  )
                }
                onClick={() =>
                  void run(async () => {
                    await api(
                      `/admin/connections/${connection}/tables/${encodeURIComponent(table)}/object`,
                      "PUT",
                      {
                        fields: objectFields,
                        view: {
                          ...objectView,
                          label: objectView.label?.trim(),
                        },
                      },
                    );
                    setMessage("Object saved. Application behavior updated.");
                  })
                }
              >
                Save object
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
