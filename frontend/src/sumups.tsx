import { useEffect, useState } from "react";
import { api, type Sumup } from "./api";
type Relation = {
  childTable: string;
  lookupField: string;
  label: string;
  keyColumn: string;
  sources: { name: string; label: string; formula: boolean }[];
};
export function SumupConfiguration({
  name,
  connection,
  table,
  value,
  change,
}: {
  name: string;
  connection: number;
  table: string;
  value?: Sumup | null;
  change: (value: Sumup) => void;
}) {
  const [relations, setRelations] = useState<Relation[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<Relation[]>(
      `/admin/connections/${connection}/tables/${encodeURIComponent(table)}/sumups/relations`,
    )
      .then((r) => {
        if (active) setRelations(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [connection, table]);
  const config = value || {
    operation: "sum",
    childTable: "",
    lookupField: "",
    sourceField: "",
  };
  const selected = relations.find(
    (r) =>
      r.childTable === config.childTable &&
      r.lookupField === config.lookupField,
  );
  return (
    <fieldset className="lookup-config">
      <legend>Sum-up · {name}</legend>
      <p>
        Stores a backend-managed total. Saving initializes existing parents;
        child creates, edits, moves and deletes apply incremental changes.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="page-config-grid">
        <label>
          Operation
          <select
            aria-label={`${name} sum-up operation`}
            value={config.operation}
            onChange={(e) =>
              change({
                ...config,
                operation: e.target.value as "sum" | "count",
              })
            }
          >
            <option value="sum">Sum</option>
            <option value="count">Count</option>
          </select>
        </label>
        <label>
          Child lookup relation
          <select
            aria-label={`${name} sum-up relation`}
            value={
              selected
                ? JSON.stringify([selected.childTable, selected.lookupField])
                : ""
            }
            onChange={(e) => {
              const [childTable, lookupField] = JSON.parse(e.target.value);
              change({ ...config, childTable, lookupField, sourceField: "" });
            }}
          >
            <option value="" disabled>
              Choose child relation…
            </option>
            {relations.map((r) => (
              <option
                key={JSON.stringify([r.childTable, r.lookupField])}
                value={JSON.stringify([r.childTable, r.lookupField])}
              >
                {r.childTable} · {r.label} → {table}.{r.keyColumn}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source field
          <select
            aria-label={`${name} sum-up source`}
            value={config.sourceField || ""}
            disabled={!selected}
            onChange={(e) => change({ ...config, sourceField: e.target.value })}
          >
            <option value="">
              {config.operation === "count"
                ? "All child records"
                : "Choose numeric column or formula…"}
            </option>
            {selected?.sources.map((f) => (
              <option key={f.name} value={f.name}>
                {f.label}
                {f.formula ? " (formula)" : ""} · {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!relations.length && !error && (
        <p>
          Define a lookup on a child table's layout pointing to this parent
          table first.
        </p>
      )}
      <p>
        Count with a source counts non-NULL values; sum ignores NULL. Formula
        sources must return numbers. Use an integer or DECIMAL destination with
        enough precision.
      </p>
    </fieldset>
  );
}
