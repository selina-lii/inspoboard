// A small dialog with text fields, for example the months of a calendar or a web address.
// Enter saves (if all fields are valid). Escape or Cancel closes it with no change.

import { useEffect, useState } from "react";
import { MovablePanel } from "../app/movable";
import { isComposing } from "../app/keys";
import "./dialogs.css";

export type Field = {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  /** A regular expression that a valid value matches. */
  pattern?: RegExp;
  help?: string;
};

export type FieldsRequest = { title: string; fields: Field[]; submit?: string };

type Props = FieldsRequest & { onDone(values: Record<string, string> | null): void };

export function FieldsDialog({ title, fields, submit, onDone }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((field) => [field.key, field.value])));
  const valid = fields.every((field) => field.pattern === undefined || field.pattern.test(values[field.key]!.trim()));
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onDone(null);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDone]);
  const finish = () => valid && onDone(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])));
  return (
    <div className="dialog-backdrop" onMouseDown={() => onDone(null)}>
      <MovablePanel className="dialog fields-dialog" titleClassName="dialog-title" label={title} title={title} onMouseDown={(event) => event.stopPropagation()}>
        {fields.map((field, index) => {
          const bad = field.pattern !== undefined && !field.pattern.test(values[field.key]!.trim());
          return (
            <label key={field.key} className="fields-row">
              <span>{field.label}</span>
              <input
                autoFocus={index === 0}
                className={bad ? "invalid" : undefined}
                value={values[field.key]}
                placeholder={field.placeholder}
                spellCheck={false}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                onKeyDown={(event) => !isComposing(event) && event.key === "Enter" && finish()}
              />
              {field.help !== undefined && <span className="setting-help">{field.help}</span>}
            </label>
          );
        })}
        <div className="fields-buttons">
          <button onClick={() => onDone(null)}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={finish}>
            {submit ?? "OK"}
          </button>
        </div>
      </MovablePanel>
    </div>
  );
}
