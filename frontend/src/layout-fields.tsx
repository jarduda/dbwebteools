import { useEffect, useState } from "react";
import { api, type Column, type Field, type Join } from "./api";

export function listColumns(columns: Column[], fields: Field[]) {
  return columns
    .filter((c) => fields.find((f) => f.name === c.name)?.showInList !== false)
    .sort((a, b) => {
      const fa = fields.find((f) => f.name === a.name),
        fb = fields.find((f) => f.name === b.name);
      return (
        (fa?.listOrder ?? fa?.order ?? columns.indexOf(a)) -
        (fb?.listOrder ?? fb?.order ?? columns.indexOf(b))
      );
    });
}

export function JoinConfiguration({
  field,
  connection,
  tables,
  sources,
  change,
  remove,
}: {
  field: Field;
  connection: number;
  tables: string[];
  sources: string[];
  change: (join: Join) => void;
  remove?: () => void;
}) {
  const [schema, setSchema] = useState<{
    columns: Column[];
    lookupKeys: string[];
  } | null>(null);
  const [error, setError] = useState("");
  const value = field.join || {
    sourceColumn: "",
    table: "",
    keyColumn: "",
    valueColumn: "",
  };
  useEffect(() => {
    let active = true;
    setSchema(null);
    setError("");
    if (value.table)
      api<{ columns: Column[]; lookupKeys: string[] }>(
        `/connections/${connection}/tables/${encodeURIComponent(value.table)}/schema`,
      )
        .then((s) => {
          if (active) setSchema(s);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [connection, value.table]);
  return (
    <fieldset className="lookup-config joined-config">
      <legend>{field.name} join</legend>
      <label>
        Local key column
        <select
          aria-label={`${field.name} source column`}
          value={value.sourceColumn}
          onChange={(e) => change({ ...value, sourceColumn: e.target.value })}
        >
          <option value="">Choose local column…</option>
          {sources.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label>
        Related table
        <select
          aria-label={`${field.name} joined table`}
          value={value.table}
          onChange={(e) =>
            change({
              ...value,
              table: e.target.value,
              keyColumn: "",
              valueColumn: "",
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
        Related unique key
        <select
          aria-label={`${field.name} join key`}
          value={value.keyColumn}
          disabled={!schema}
          onChange={(e) => change({ ...value, keyColumn: e.target.value })}
        >
          <option value="">Choose unique key…</option>
          {schema?.columns
            .filter((c) => !c.nullable && schema.lookupKeys.includes(c.name))
            .map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
        </select>
      </label>
      <label>
        Displayed value
        <select
          aria-label={`${field.name} joined value`}
          value={value.valueColumn}
          disabled={!schema}
          onChange={(e) => change({ ...value, valueColumn: e.target.value })}
        >
          <option value="">Choose value column…</option>
          {schema?.columns.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
      </label>
      <p>
        Read-only. No matching record gives NULL. Related-table read permission
        is required.
      </p>
      {remove && (
        <button
          type="button"
          onClick={remove}
          aria-label={`Remove ${field.name}`}
        >
          Remove joined field
        </button>
      )}
      {error && (
        <p className="lookup-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
