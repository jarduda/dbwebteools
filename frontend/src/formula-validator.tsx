import { useEffect, useRef, useState } from "react";
import { api, type Field } from "./api";
export function FormulaValidator({
  connection,
  table,
  field,
  fields,
}: {
  connection: number;
  table: string;
  field: Field;
  fields: Field[];
}) {
  const [feedback, setFeedback] = useState<{
      message: string;
      valid: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const draft = JSON.stringify(fields);
  useEffect(() => {
    revision.current++;
    setFeedback(null);
    setBusy(false);
    return () => {
      revision.current++;
    };
  }, [connection, table, field.formula, draft]);
  return (
    <div className="formula-validation">
      {feedback && (
        <p
          role={feedback.valid ? "status" : "alert"}
          className={feedback.valid ? "notice" : "alert"}
        >
          {feedback.message}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        aria-label={`Validate ${field.name} formula`}
        onClick={async () => {
          const current = ++revision.current;
          setBusy(true);
          setFeedback(null);
          try {
            const r = await api<{ message: string }>(
              `/admin/connections/${connection}/tables/${encodeURIComponent(table)}/formulas/validate`,
              "POST",
              { formula: field.formula, fields },
            );
            if (current === revision.current)
              setFeedback({ message: r.message, valid: true });
          } catch (e) {
            if (current === revision.current)
              setFeedback({ message: (e as Error).message, valid: false });
          } finally {
            if (current === revision.current) setBusy(false);
          }
        }}
      >
        {busy ? "Validating…" : "Validate formula"}
      </button>
    </div>
  );
}
