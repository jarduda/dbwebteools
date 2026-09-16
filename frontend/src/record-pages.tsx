import { SEARCH_DELAY_MS } from "./search";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  api,
  type Column,
  type Field,
  type Row,
  type Page,
  type RecordPageDefinition,
  type PageSummary,
  type RelatedTab,
} from "./api";
import { Plus, Pencil, Search, Trash2 } from "lucide-react";
import { cellText } from "./field-controls";

export function recordKey(row: Row, columns: Column[]) {
  if (row.keyToken) return { $record: row.keyToken };
  return Object.fromEntries(
    columns
      .filter((c) => c.primaryKey)
      .map((c) => [c.name, row.values[c.name]]),
  );
}
export type RecordRoute = { id: number; key: string };
export type PageRoute = RecordRoute & { trail: RecordRoute[] };
export function routeHref(path: RecordRoute[]) {
  return (
    "#" + path.map((r) => `page/${r.id}/${encodeURIComponent(r.key)}`).join("/")
  );
}
export function pageHref(
  pageId: number,
  row: Row,
  columns: Column[],
  trail: RecordRoute[] = [],
) {
  return routeHref([
    ...trail,
    { id: pageId, key: JSON.stringify(recordKey(row, columns)) },
  ]);
}
export function parsePageRoute(hash: string): PageRoute | null {
  if (!hash.startsWith("#page/")) return null;
  const parts = hash.slice(1).split("/");
  if (parts.length % 3 || parts.length > 150) return null;
  try {
    const path: RecordRoute[] = [];
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i] !== "page" || !/^[1-9][0-9]*$/.test(parts[i + 1]))
        return null;
      const key = decodeURIComponent(parts[i + 2]);
      const parsed = JSON.parse(key);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        return null;
      path.push({ id: Number(parts[i + 1]), key });
    }
    return { ...path[path.length - 1], trail: path.slice(0, -1) };
  } catch {
    return null;
  }
}
export function recordText(row: Row, column: Column, field?: Field) {
  if (row.calculationErrors?.[column.name]) return "Calculation error";
  const virtual = field && ["join", "formula"].includes(field.widget);
  if (virtual && !(column.name in (row.joinedValues || {})))
    return "Unavailable";
  const value = virtual
    ? row.joinedValues?.[column.name]
    : row.values[column.name];
  return value == null
    ? cellText(null, column, field)
    : (row.displayValues?.[column.name] ?? cellText(value, column, field));
}
export function PageCell({
  row,
  column,
  fields,
  pages,
  columns,
}: {
  row: Row;
  column: Column;
  fields: Field[];
  pages: PageSummary[];
  columns: Column[];
}) {
  const text = recordText(
    row,
    column,
    fields.find((f) => f.name === column.name),
  );
  const target = pages.find((p) => p.linkColumn === column.name);
  return target ? (
    <a
      className="record-link"
      href={pageHref(target.id, row, columns)}
      title={`Open ${target.name}`}
    >
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}

type EditorProps = {
  initialValues?: Record<string, unknown>;
  lockedFields?: string[];
  base?: string;
  columns: Column[];
  fields: Field[];
  row: Row | null;
  close: () => void;
  save: (values: Record<string, unknown>) => Promise<void>;
};
type Details = {
  page: RecordPageDefinition;
  record: Row;
  columns: Column[];
  fields: Field[];
  canUpdate: boolean;
};
export function RecordPageView({
  route,
  editor: Editor,
}: {
  route: PageRoute;
  editor: ComponentType<EditorProps>;
}) {
  const [data, setData] = useState<Details | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState(false),
    [tabId, setTabId] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setData(null);
    api<Details>(
      `/pages/${route.id}/record?key=${encodeURIComponent(route.key)}`,
    )
      .then((d) => {
        if (active) {
          setData(d);
          setTabId((old) =>
            d.page.tabs.some((t) => t.id === old)
              ? old
              : d.page.tabs[0]?.id || "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [route.id, route.key, revision]);
  const [ancestors, setAncestors] = useState<string[]>([]);
  const trailJson = JSON.stringify(route.trail);
  useEffect(() => {
    let active = true;
    setAncestors([]);
    const trail: RecordRoute[] = JSON.parse(trailJson);
    Promise.all(
      trail.map(async (r) => {
        try {
          const d = await api<Details>(
            `/pages/${r.id}/record?key=${encodeURIComponent(r.key)}`,
          );
          const column = d.columns.find((c) => c.name === d.page.linkColumn);
          const label = column
            ? recordText(
                d.record,
                column,
                d.fields.find((f) => f.name === column.name),
              )
            : "";
          return label ? `${d.page.name}: ${label}` : d.page.name;
        } catch {
          return "Unavailable record";
        }
      }),
    ).then((labels) => {
      if (active) setAncestors(labels);
    });
    return () => {
      active = false;
    };
  }, [trailJson]);
  const path = [...route.trail, { id: route.id, key: route.key }];
  const activeTab = data?.page.tabs.find((t) => t.id === tabId);
  const titleColumn = data?.columns.find(
    (c) => c.name === data.page.linkColumn,
  );
  return (
    <div className="record-page">
      <nav className="breadcrumbs" aria-label="Page navigation">
        <a href="#records">Data browser</a>
        {route.trail.map((r, i) => (
          <span className="breadcrumb-item" key={`${i}/${r.id}`}>
            <span aria-hidden="true">/</span>
            <a href={routeHref(path.slice(0, i + 1))}>
              {ancestors[i] || "Record page"}
            </a>
          </span>
        ))}
        <span aria-hidden="true">/</span>
        <span aria-current="page">
          {data?.page.name || "Record page"}
          {data && titleColumn
            ? `: ${recordText(
                data.record,
                titleColumn,
                data.fields.find((f) => f.name === titleColumn.name),
              )}`
            : ""}
        </span>
        <button type="button" onClick={() => history.back()}>
          Back
        </button>
      </nav>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <p role="status">Loading record…</p>}
      {data && (
        <>
          <div className="heading">
            <div className="eyebrow">RECORD PAGE · {data.page.table}</div>
            <h1>{data.page.name}</h1>
            <p>
              {titleColumn
                ? recordText(
                    data.record,
                    titleColumn,
                    data.fields.find((f) => f.name === data.page.linkColumn),
                  )
                : data.page.table}
            </p>
          </div>
          <section className="card" aria-label="Main record">
            <div className="card-title">
              <h2>Record details</h2>
              <div className="actions">
                <button onClick={() => setRevision((v) => v + 1)}>
                  Refresh page
                </button>
                {data.canUpdate && (
                  <button className="primary" onClick={() => setEditing(true)}>
                    Edit record
                  </button>
                )}
              </div>
            </div>
            <dl className="page-fields">
              {data.columns
                .filter(
                  (c) => !data.fields.find((f) => f.name === c.name)?.hidden,
                )
                .sort(
                  (a, b) =>
                    (data.fields.find((f) => f.name === a.name)?.order ??
                      data.columns.indexOf(a)) -
                    (data.fields.find((f) => f.name === b.name)?.order ??
                      data.columns.indexOf(b)),
                )
                .map((c) => {
                  const field = data.fields.find((f) => f.name === c.name);
                  return (
                    <div
                      key={c.name}
                      className={field?.widget === "textarea" ? "wide" : ""}
                    >
                      {field?.section && (
                        <span className="eyebrow">{field.section}</span>
                      )}
                      <dt>{field?.label || c.name}</dt>
                      <dd>{recordText(data.record, c, field)}</dd>
                    </div>
                  );
                })}
            </dl>
          </section>
          {data.page.tabs.length > 0 ? (
            <section className="card related-card">
              <div
                className="page-tabs"
                role="tablist"
                aria-label="Related objects"
              >
                {data.page.tabs.map((tab, i) => (
                  <button
                    type="button"
                    key={tab.id}
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-controls={`panel-${tab.id}`}
                    aria-selected={tab.id === tabId}
                    tabIndex={tab.id === tabId ? 0 : -1}
                    onClick={() => setTabId(tab.id)}
                    onKeyDown={(e) => {
                      if (
                        !["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                          e.key,
                        )
                      )
                        return;
                      e.preventDefault();
                      const next =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? data.page.tabs.length - 1
                            : (i +
                                (e.key === "ArrowRight" ? 1 : -1) +
                                data.page.tabs.length) %
                              data.page.tabs.length;
                      setTabId(data.page.tabs[next].id);
                      document
                        .getElementById(`tab-${data.page.tabs[next].id}`)
                        ?.focus();
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {activeTab && (
                <div
                  role="tabpanel"
                  id={`panel-${activeTab.id}`}
                  aria-labelledby={`tab-${activeTab.id}`}
                >
                  <RelatedRecords
                    key={`${activeTab.id}/${revision}`}
                    onCreated={() => setRevision((v) => v + 1)}
                    editor={Editor}
                    pageId={route.id}
                    parentKey={route.key}
                    tab={activeTab}
                    trail={path}
                  />
                </div>
              )}
            </section>
          ) : (
            <p className="notice">
              No related tabs are configured or available with your table
              permissions.
            </p>
          )}
          {editing && (
            <Editor
              base={`/connections/${data.page.connectionId}/tables/${encodeURIComponent(data.page.table)}`}
              columns={data.columns}
              fields={data.fields}
              row={data.record}
              close={() => setEditing(false)}
              save={async (values) => {
                await api(
                  `/connections/${data.page.connectionId}/tables/${encodeURIComponent(data.page.table)}/update`,
                  "POST",
                  {
                    values,
                    key: recordKey(data.record, data.columns),
                    version: data.record.version,
                  },
                );
                setEditing(false);
                setRevision((v) => v + 1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

type RelatedData = {
  canDelete: boolean;
  connectionId: number;
  canUpdate: boolean;
  lockedFields: string[];
  canCreate: boolean;
  data: Page;
  fields: Field[];
  visibleColumns: string[];
  targetPageId?: number | null;
  linkColumn?: string | null;
};
type CreatePreview = {
  connectionId: number;
  table: string;
  columns: Column[];
  fields: Field[];
  values: Record<string, unknown>;
  lockedFields: string[];
};
function RelatedRecords({
  onCreated,
  editor: Editor,
  pageId,
  parentKey,
  tab,
  trail,
}: {
  onCreated: () => void;
  editor: ComponentType<EditorProps>;
  pageId: number;
  parentKey: string;
  tab: RelatedTab;
  trail: RecordRoute[];
}) {
  const [data, setData] = useState<RelatedData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState(""),
    [desc, setDesc] = useState(false),
    [revision, setRevision] = useState(0),
    [editing, setEditing] = useState<Row | null>(null),
    [creating, setCreating] = useState(false),
    [deleting, setDeleting] = useState(false),
    [preview, setPreview] = useState<CreatePreview | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({
        key: parentKey,
        page: String(page),
        size: "25",
        search,
        ...(sort ? { sort, descending: String(desc) } : {}),
      });
      api<RelatedData>(`/pages/${pageId}/tabs/${tab.id}/records?${query}`)
        .then((d) => {
          if (active) setData(d);
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
  }, [pageId, parentKey, tab.id, page, search, sort, desc, revision]);
  const listRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);
  useLayoutEffect(() => {
    if (listRef.current && data)
      setListHeight((old) =>
        Math.max(old, listRef.current!.getBoundingClientRect().height),
      );
  }, [data]);
  const allColumns = data
    ? [...data.data.columns, ...(data.data.joinedColumns || [])]
    : [];
  const columns =
    data?.visibleColumns
      .map((n) => allColumns.find((c) => c.name === n))
      .filter((c): c is Column => !!c) || [];
  return (
    <>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {editing && data && (
        <Editor
          base={`/connections/${data.connectionId}/tables/${encodeURIComponent(tab.table)}`}
          columns={allColumns}
          fields={data.fields}
          row={editing}
          lockedFields={data.lockedFields}
          close={() => setEditing(null)}
          save={async (values) => {
            await api(`/pages/${pageId}/tabs/${tab.id}/update`, "POST", {
              parentKey,
              mutation: {
                values,
                key: recordKey(editing, data.data.columns),
                version: editing.version,
              },
            });
            setEditing(null);
            onCreated();
          }}
        />
      )}
      {preview && (
        <Editor
          base={`/connections/${preview.connectionId}/tables/${encodeURIComponent(preview.table)}`}
          columns={preview.columns}
          fields={preview.fields}
          row={null}
          initialValues={preview.values}
          lockedFields={preview.lockedFields}
          close={() => setPreview(null)}
          save={async (values) => {
            await api(`/pages/${pageId}/tabs/${tab.id}/create`, "POST", {
              key: parentKey,
              values,
            });
            setPreview(null);
            onCreated();
            setSearch("");
            setPage(1);
            setRevision((v) => v + 1);
            setNotice(
              "Record created. The list still applies its configured filters and sorting.",
            );
          }}
        />
      )}
      <div className="toolbar related-toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label={`Search ${tab.label}`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search related records…"
          />
        </div>
        <div className="actions">
          {sort && (
            <button
              onClick={() => {
                setSort("");
                setDesc(false);
                setPage(1);
              }}
            >
              Use default sorting
            </button>
          )}
          {data?.canCreate && (
            <button
              className="primary"
              disabled={creating || busy}
              onClick={async () => {
                setCreating(true);
                setError("");
                setNotice("");
                try {
                  setPreview(
                    await api<CreatePreview>(
                      `/pages/${pageId}/tabs/${tab.id}/create-preview`,
                      "POST",
                      { key: parentKey },
                    ),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setCreating(false);
                }
              }}
            >
              <Plus size={16} />
              {creating ? "Preparing…" : "Add record"}
            </button>
          )}{" "}
        </div>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      <div className="related-loading" role="status">
        {busy ? "Loading related records…" : ""}
      </div>
      <div
        ref={listRef}
        className="table-scroll"
        aria-busy={busy}
        style={{ minHeight: listHeight || undefined }}
      >
        {data && (
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.name}
                    aria-sort={
                      data.data.sort === c.name
                        ? data.data.descending
                          ? "descending"
                          : "ascending"
                        : "none"
                    }
                  >
                    <button
                      disabled={
                        !data.data.columns.some((x) => x.name === c.name)
                      }
                      onClick={() => {
                        setSort(c.name);
                        setDesc(
                          data.data.sort === c.name
                            ? !data.data.descending
                            : false,
                        );
                        setPage(1);
                      }}
                    >
                      {data.fields.find((f) => f.name === c.name)?.label ||
                        c.name}
                    </button>
                  </th>
                ))}
                {(data.canUpdate || data.canDelete) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.data.rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.name}>
                      {data.targetPageId && data.linkColumn === c.name ? (
                        <a
                          className="record-link"
                          href={pageHref(
                            data.targetPageId,
                            row,
                            data.data.columns,
                            trail,
                          )}
                        >
                          {recordText(
                            row,
                            c,
                            data.fields.find((f) => f.name === c.name),
                          )}
                        </a>
                      ) : (
                        recordText(
                          row,
                          c,
                          data.fields.find((f) => f.name === c.name),
                        )
                      )}
                    </td>
                  ))}
                  {(data.canUpdate || data.canDelete) && (
                    <td>
                      {data.canUpdate && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Edit record ${i + 1}`}
                          disabled={deleting}
                          onClick={() => setEditing(row)}
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                      {data.canDelete && (
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={`Delete record ${i + 1}`}
                          disabled={busy || deleting}
                          onClick={async () => {
                            if (
                              !window.confirm(
                                "Delete this record permanently? This action cannot be undone.",
                              )
                            )
                              return;
                            setDeleting(true);
                            setError("");
                            try {
                              await api(
                                `/pages/${pageId}/tabs/${tab.id}/delete`,
                                "POST",
                                {
                                  parentKey,
                                  mutation: {
                                    values: {},
                                    key: recordKey(row, data.data.columns),
                                    version: row.version,
                                  },
                                },
                              );
                              onCreated();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setDeleting(false);
                            }
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!busy && data?.data.total === 0 && (
          <p className="notice">No related records found.</p>
        )}
      </div>
      <div className="pagination">
        <span>
          {data
            ? `${data.data.total} records · Page ${page} of ${Math.max(1, Math.ceil(data.data.total / 25))}`
            : ""}
        </span>
        <div>
          <button
            disabled={busy || page === 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous related page"
          >
            Previous
          </button>
          <button
            disabled={busy || !data || page * 25 >= data.data.total}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next related page"
          >
            Next
          </button>
        </div>
      </div>
    </>
  );
}
