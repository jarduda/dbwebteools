import { type Column, type Field, type ListFilter, type ListView } from "./api";

const comparison = [
  ["eq", "Equals"],
  ["ne", "Does not equal"],
  ["gt", "Greater than"],
  ["gte", "At least"],
  ["lt", "Less than"],
  ["lte", "At most"],
];
const nulls = [
  ["isNull", "Is NULL"],
  ["notNull", "Is not NULL"],
];
const numeric = [
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "bigint",
  "year",
  "bit",
  "decimal",
  "numeric",
  "float",
  "double",
  "real",
];
const temporal = ["date", "datetime", "timestamp"];
export function filterOperators(c?: Column) {
  if (!c) return [];
  if (
    [
      "char",
      "varchar",
      "tinytext",
      "text",
      "mediumtext",
      "longtext",
      "enum",
      "set",
    ].includes(c.type)
  )
    return [
      ...comparison,
      ["contains", "Contains"],
      ["startsWith", "Starts with"],
      ...nulls,
    ];
  return numeric.includes(c.type) || temporal.includes(c.type)
    ? [...comparison, ...nulls]
    : nulls;
}
export function filterSummary(view: ListView, fields: Field[]) {
  const label = (name: string) =>
    fields.find((f) => f.name === name)?.label || name;
  const operators = [
    ...comparison,
    ...nulls,
    ["contains", "Contains"],
    ["startsWith", "Starts with"],
  ];
  return (view.filters || [])
    .map(
      (f) =>
        `${label(f.column)} ${operators.find((o) => o[0] === f.operator)?.[1] || f.operator}${["isNull", "notNull"].includes(f.operator) ? "" : ` ${fields.find((x) => x.name === f.column)?.options?.find((o) => o.key === f.value)?.display ?? (f.value === "" ? '""' : f.value)}`}`,
    )
    .join(view.match === "any" ? " OR " : " AND ");
}
export function ListViewEditor({
  value,
  columns,
  fields,
  change,
  filtersOnly = false,
  name = "List configuration",
}: {
  value: ListView;
  filtersOnly?: boolean;
  name?: string;
  columns: Column[];
  fields: Field[];
  change: (view: ListView) => void;
}) {
  const filters = value.filters || [];
  const label = (name: string) =>
    fields.find((f) => f.name === name)?.label || name;
  const update = (i: number, patch: Partial<ListFilter>) =>
    change({
      ...value,
      filters: filters.map((f, j) => (i === j ? { ...f, ...patch } : f)),
    });
  return (
    <section className="list-view-editor" aria-label={name}>
      <h3>
        {filtersOnly
          ? "Lookup selection criteria"
          : "List title, default sorting & filters"}
      </h3>
      {!filtersOnly && (
        <>
          <div className="list-view-settings">
            <label>
              List title
              <input
                aria-label="List title"
                maxLength={150}
                placeholder="Use table name"
                value={value.label || ""}
                onChange={(e) => change({ ...value, label: e.target.value })}
              />
            </label>
            <label>
              Default sort column
              <select
                aria-label="Default sort column"
                value={value.sort || ""}
                onChange={(e) =>
                  change({
                    ...value,
                    sort: e.target.value,
                    descending: e.target.value ? value.descending : false,
                  })
                }
              >
                <option value="">Primary key (automatic)</option>
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {label(c.name)} ({c.name})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort direction
              <select
                aria-label="Sort direction"
                disabled={!value.sort}
                value={value.descending ? "desc" : "asc"}
                onChange={(e) =>
                  change({ ...value, descending: e.target.value === "desc" })
                }
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </label>
          </div>
          <p>
            Field labels from Layout editor are used in record forms and list headings.
            Filters apply to the list and its search results, not to table
            permissions or lookup choices.
          </p>
        </>
      )}
      {filtersOnly && (
        <p>
          Only matching records can be selected. Criteria apply together with
          search and pagination. Existing relations keep their display labels.
        </p>
      )}
      <label className="filter-match">
        Show records matching
        <select
          aria-label="Filter match"
          value={value.match || "all"}
          onChange={(e) =>
            change({ ...value, match: e.target.value as "all" | "any" })
          }
        >
          <option value="all">All criteria (AND)</option>
          <option value="any">Any criterion (OR)</option>
        </select>
      </label>
      {filters.map((f, i) => {
        const c = columns.find((c) => c.name === f.column);
        const options = fields.find((x) => x.name === f.column)?.options;
        return (
          <div className="list-filter" key={i}>
            <label>
              Field
              <select
                aria-label={`Filter ${i + 1} field`}
                value={f.column}
                onChange={(e) => {
                  const col = columns.find((c) => c.name === e.target.value);
                  update(i, {
                    column: e.target.value,
                    operator: filterOperators(col)[0]?.[0] || "eq",
                    value: "",
                  });
                }}
              >
                {columns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {label(c.name)} ({c.name})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <select
                aria-label={`Filter ${i + 1} condition`}
                value={f.operator}
                onChange={(e) => update(i, { operator: e.target.value })}
              >
                {filterOperators(c).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {!["isNull", "notNull"].includes(f.operator) ? (
              <label>
                Value
                {options?.length && ["eq", "ne"].includes(f.operator) ? (
                  <select
                    aria-label={`Filter ${i + 1} value`}
                    value={f.value ?? ""}
                    onChange={(e) => update(i, { value: e.target.value })}
                  >
                    <option value="">Empty text</option>
                    {!options.some((o) => o.key === f.value) && f.value && (
                      <option value={f.value}>{f.value}</option>
                    )}
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.display} ({o.key})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label={`Filter ${i + 1} value`}
                    type={
                      c?.type === "date"
                        ? "date"
                        : c && ["datetime", "timestamp"].includes(c.type)
                          ? "datetime-local"
                          : "text"
                    }
                    step="any"
                    maxLength={2000}
                    inputMode={
                      c && numeric.includes(c.type) ? "decimal" : undefined
                    }
                    placeholder={
                      c && numeric.includes(c.type)
                        ? "Number"
                        : "Value (keys for relations)"
                    }
                    value={f.value ?? ""}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                )}
              </label>
            ) : (
              <span className="null-filter-hint">No value needed</span>
            )}
            <button
              type="button"
              aria-label={`Remove filter ${i + 1}`}
              onClick={() =>
                change({ ...value, filters: filters.filter((_, j) => i !== j) })
              }
            >
              Remove
            </button>
          </div>
        );
      })}
      <button
        type="button"
        disabled={!columns.length || filters.length >= 20}
        onClick={() =>
          change({
            ...value,
            filters: [
              ...filters,
              {
                column: columns[0].name,
                operator: filterOperators(columns[0])[0][0],
                value: "",
              },
            ],
          })
        }
      >
        Add filter
      </button>
      {!filters.length && <p>No criteria: show all accessible records.</p>}
      {!!filters.length && (
        <p className="filter-preview">{filterSummary(value, fields)}</p>
      )}
    </section>
  );
}
