import type { Column, DropdownOption, Field } from "./api";

export function widgetFor(column: Column, field?: Field) {
  if (field?.widget && field.widget !== "auto") return field.widget;
  return column.type === "date"
    ? "date"
    : ["datetime", "timestamp"].includes(column.type)
      ? "datetime"
      : "text";
}

// Do not pass dates through JavaScript Date: that would introduce browser timezone shifts.
// Native date/time controls support milliseconds. Raw, untouched database values remain in editor state.
export function temporalInput(value: unknown, widget: string) {
  const raw = String(value ?? "").replace(" ", "T");
  if (!raw) return "";
  return widget === "date"
    ? raw.slice(0, 10)
    : raw.length === 10
      ? raw + "T00:00"
      : raw.slice(0, 23);
}

export function cellText(value: unknown, column: Column, field?: Field) {
  if (value == null)
    return [
      "tinyint",
      "smallint",
      "mediumint",
      "int",
      "bigint",
      "decimal",
      "float",
      "double",
      "bit",
      "year",
    ].includes(column.type) || field?.widget === "number"
      ? ""
      : "NULL";
  const widget = widgetFor(column, field);
  if (widget === "date") return String(value).slice(0, 10);
  if (widget === "datetime")
    return String(value).replace("T", " ").replace(/\.0+$/, "");
  return String(value);
}

export function dropdownError(options: DropdownOption[]) {
  if (!options.length || options.length > 200) return "Define 1–200 options.";
  if (
    options.some(
      (o) =>
        !o.key.trim() ||
        !o.display.trim() ||
        o.key !== o.key.trim() ||
        o.display !== o.display.trim() ||
        o.key.length > 256 ||
        o.display.length > 256,
    )
  )
    return "Keys and display labels must be non-blank, at most 256 characters, and have no surrounding spaces.";
  if (new Set(options.map((o) => o.key.toUpperCase())).size !== options.length)
    return "Keys must be unique (ignoring case).";
  if (
    new Set(options.map((o) => o.display.toUpperCase())).size !== options.length
  )
    return "Display labels must be unique (ignoring case).";
  return "";
}

export function DropdownConfiguration({
  name,
  options,
  change,
}: {
  name: string;
  options: DropdownOption[];
  change: (options: DropdownOption[]) => void;
}) {
  const error = dropdownError(options);
  return (
    <fieldset className="dropdown-config">
      <legend>{name} dropdown values</legend>
      <p>
        The key is saved to the database; the display label is shown to users.
        Keys and labels must each be unique.
      </p>
      {options.map((option, i) => (
        <div className="dropdown-option" key={i}>
          <label>
            Key
            <input
              aria-label={`${name} option ${i + 1} key`}
              maxLength={256}
              value={option.key}
              onChange={(e) =>
                change(
                  options.map((o, j) =>
                    j === i ? { ...o, key: e.target.value } : o,
                  ),
                )
              }
            />
          </label>
          <label>
            Display label
            <input
              aria-label={`${name} option ${i + 1} display`}
              maxLength={256}
              value={option.display}
              onChange={(e) =>
                change(
                  options.map((o, j) =>
                    j === i ? { ...o, display: e.target.value } : o,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            aria-label={`Remove ${name} option ${i + 1}`}
            onClick={() => change(options.filter((_, j) => j !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={options.length >= 200}
        onClick={() => change([...options, { key: "", display: "" }])}
      >
        Add option
      </button>
      {error && (
        <p className="lookup-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
