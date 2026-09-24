import { SEARCH_DELAY_MS } from "./search";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Column, type Lookup } from "./api";
import { ListViewEditor } from "./list-view";

type LookupPage = {
  total: number;
  page: number;
  size: number;
  columns: string[];
  numericColumns?: string[];
  rows: Record<string, unknown>[];
};
export function LookupConfiguration({
  name,
  connection,
  tables,
  destinations,
  value,
  change,
}: {
  name: string;
  connection: number;
  tables: string[];
  destinations: Column[];
  value?: Lookup | null;
  change: (value: Lookup) => void;
}) {
  const [schema, setSchema] = useState<{
    columns: Column[];
    lookupKeys: string[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setSchema(null);
    setError("");
    if (value?.table)
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
  }, [connection, value?.table]);
  const current = value || {
    table: "",
    keyColumn: "",
    displayColumn: "",
    searchColumns: [],
  };
  return (
    <fieldset className="lookup-config">
      <legend>{name} relation</legend>
      <label>
        Related table
        <select
          aria-label={`${name} related table`}
          value={current.table}
          onChange={(e) =>
            change({
              table: e.target.value,
              keyColumn: "",
              displayColumn: "",
              searchColumns: [],
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
        Stored key
        <select
          aria-label={`${name} key column`}
          disabled={!schema}
          value={current.keyColumn}
          onChange={(e) => change({ ...current, keyColumn: e.target.value })}
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
        Display value
        <select
          aria-label={`${name} display column`}
          disabled={!schema}
          value={current.displayColumn}
          onChange={(e) =>
            change({ ...current, displayColumn: e.target.value })
          }
        >
          <option value="">Choose display column…</option>
          {schema?.columns.map((c) => (
            <option key={c.name}>{c.name}</option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Additional search columns</legend>
        <small>Key and display value are always searchable.</small>
        <div className="lookup-checks">
          {schema?.columns
            .filter(
              (c) =>
                c.name !== current.keyColumn &&
                c.name !== current.displayColumn,
            )
            .map((c) => (
              <label className="checkbox-label" key={c.name}>
                <input
                  type="checkbox"
                  aria-label={`${name} search ${c.name}`}
                  checked={current.searchColumns.includes(c.name)}
                  onChange={(e) =>
                    change({
                      ...current,
                      searchColumns: e.target.checked
                        ? [...current.searchColumns, c.name]
                        : current.searchColumns.filter((n) => n !== c.name),
                    })
                  }
                />
                {c.name}
              </label>
            ))}
        </div>
      </fieldset>
      {schema && (
        <ListViewEditor
          filtersOnly
          name={`${name} lookup criteria`}
          columns={schema.columns}
          fields={[]}
          value={current.criteria || { match: "all", filters: [] }}
          change={(criteria) => change({ ...current, criteria })}
        />
      )}
      <fieldset>
        <legend>Copy values to this table</legend>
        <p>
          Choosing or reselecting a record fills these values again. Allow
          editing to let users change a copy before saving or after reopening.
          Unchecked copies stay locked and are verified by the backend. Clearing
          the lookup copies NULL.
        </p>
        {(current.copyMappings || []).map((m, i) => (
          <div className="dropdown-option" key={i}>
            <label>
              Source column
              <select
                aria-label={`${name} copy ${i + 1} source`}
                value={m.sourceColumn}
                onChange={(e) =>
                  change({
                    ...current,
                    copyMappings: current.copyMappings!.map((x, j) =>
                      j === i ? { ...x, sourceColumn: e.target.value } : x,
                    ),
                  })
                }
              >
                <option value="">Choose source…</option>
                {schema?.columns.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Destination column
              <select
                aria-label={`${name} copy ${i + 1} destination`}
                value={m.destinationColumn}
                onChange={(e) =>
                  change({
                    ...current,
                    copyMappings: current.copyMappings!.map((x, j) =>
                      j === i ? { ...x, destinationColumn: e.target.value } : x,
                    ),
                  })
                }
              >
                <option value="">Choose destination…</option>
                {destinations
                  .filter(
                    (c) =>
                      c.name !== name &&
                      !c.primaryKey &&
                      !c.generated &&
                      !c.autoIncrement,
                  )
                  .map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                aria-label={`${name} copy ${i + 1} allow editing`}
                checked={m.editable ?? false}
                onChange={(e) =>
                  change({
                    ...current,
                    copyMappings: current.copyMappings!.map((x, j) =>
                      j === i ? { ...x, editable: e.target.checked } : x,
                    ),
                  })
                }
              />
              Allow editing
            </label>
            <button
              type="button"
              aria-label={`Remove ${name} copy ${i + 1}`}
              onClick={() =>
                change({
                  ...current,
                  copyMappings: current.copyMappings!.filter((_, j) => j !== i),
                })
              }
            >
              Remove mapping
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={!schema || (current.copyMappings?.length || 0) >= 20}
          onClick={() =>
            change({
              ...current,
              copyMappings: [
                ...(current.copyMappings || []),
                { sourceColumn: "", destinationColumn: "" },
              ],
            })
          }
        >
          Add copy mapping
        </button>
      </fieldset>
      {schema && schema.lookupKeys.length === 0 && (
        <p role="alert">
          This table needs a single-column primary or unique key.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

export function LookupInput({
  base,
  name,
  label,
  lookup,
  value,
  disabled,
  nullable,
  change,
}: {
  base: string;
  name: string;
  label: string;
  lookup: Lookup;
  value: unknown;
  disabled?: boolean;
  nullable: boolean;
  change: (key: unknown) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  async function choose(key: unknown) {
    setCopyBusy(true);
    setError("");
    try {
      await change(key);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopyBusy(false);
    }
  }
  const [display, setDisplay] = useState("");
  const [error, setError] = useState("");
  const url = `${base}/lookups/${encodeURIComponent(name)}`;
  useEffect(() => {
    let active = true;
    setDisplay("");
    setError("");
    if (value != null && value !== "")
      api<{ found: boolean; label: string | null }>(
        `${url}?key=${encodeURIComponent(String(value))}`,
      )
        .then((r) => {
          if (active) {
            setDisplay(r.label ?? String(value));
            if (!r.found) setError("Related record no longer exists.");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [url, value]);
  return (
    <span className="lookup-input">
      <span className="lookup-control">
        <input
          aria-label={label}
          readOnly
          disabled={disabled || copyBusy}
          value={value == null || value === "" ? "" : display || String(value)}
          placeholder="Select a related record…"
        />
        <button
          type="button"
          disabled={disabled || copyBusy}
          aria-label={`Choose ${label}`}
          onClick={() => setOpen(true)}
        >
          Choose…
        </button>
        {nullable && !disabled && value != null && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            disabled={copyBusy}
            onClick={() => void choose(null)}
          >
            Clear
          </button>
        )}
      </span>
      {value != null && value !== "" && <small>Key: {String(value)}</small>}
      {error && (
        <span role="alert" className="lookup-error">
          {error}
        </span>
      )}
      {open && (
        <LookupDialog
          url={url}
          label={label}
          lookup={lookup}
          close={() => setOpen(false)}
          busy={copyBusy}
          error={error}
          select={(key) => {
            void choose(key);
          }}
        />
      )}
    </span>
  );
}

function LookupDialog({
  busy: selecting,
  error: selectionError,
  url,
  label,
  lookup,
  close,
  select,
}: {
  url: string;
  label: string;
  lookup: Lookup;
  close: () => void;
  select: (key: unknown) => void;
  busy: boolean;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LookupPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => d.close();
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    setData(null);
    const timer = setTimeout(() => {
      api<LookupPage>(
        `${url}?page=${page}&size=25&search=${encodeURIComponent(search)}`,
      )
        .then((r) => {
          if (active) setData(r);
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [url, search, page]);
  return createPortal(
    <dialog
      ref={dialog}
      className="lookup-dialog"
      aria-label={`Select ${label}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <h2>Select {label}</h2>
        <button type="button" aria-label="Close lookup" onClick={close}>
          ×
        </button>
      </div>
      <p>
        {lookup.table} · Choose a record to store its {lookup.keyColumn}.
      </p>
      <input
        autoFocus
        aria-label="Search related records"
        placeholder={`Search ${[...new Set([lookup.keyColumn, lookup.displayColumn, ...lookup.searchColumns])].join(", ")}…`}
        value={search}
        onChange={(e) => {
          setBusy(true);
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      {selectionError && (
        <div className="alert" role="alert">
          {selectionError}
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="table-scroll" aria-busy={busy}>
        {busy ? (
          <p role="status">Loading records…</p>
        ) : (
          data && (
            <table>
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                  <th>Select</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={String(r[lookup.keyColumn])}>
                    {data.columns.map((c) => (
                      <td key={c}>
                        {r[c] == null ? "" : String(r[c])}
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="secondary"
                        disabled={selecting}
                        aria-label={`Select ${r[lookup.displayColumn] ?? "record"} (${r[lookup.keyColumn]})`}
                        onClick={() => select(r[lookup.keyColumn])}
                      >
                        Select
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
        {!busy && data?.total === 0 && (
          <p role="status">No matching records. Try another search.</p>
        )}
      </div>
      <div className="pagination">
        <span>
          {data
            ? `${data.total} records · Page ${page} of ${Math.max(1, Math.ceil(data.total / 25))}`
            : ""}
        </span>
        <div>
          <button
            type="button"
            aria-label="Previous lookup page"
            disabled={busy || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            aria-label="Next lookup page"
            disabled={busy || !data || page * 25 >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
      <div className="form-actions">
        <button type="button" onClick={close}>
          Cancel
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
