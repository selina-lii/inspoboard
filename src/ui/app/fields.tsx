// Form fields shared by views.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { isComposing } from "./keys";

type CommitFieldProps = {
  label?: string;
  value: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** True: a long value wraps onto more lines (the field grows). Enter still commits: the value has no line breaks. */
  wrap?: boolean;
  onCommit(value: string): void;
  /** Called after Enter, Escape, or blur. */
  onDone?(): void;
};

/** A text field that commits on blur or Enter. Escape restores the stored value. */
export function CommitField({ label, value, placeholder, className, disabled, autoFocus, wrap, onCommit, onDone }: CommitFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const area = useRef<HTMLTextAreaElement>(null);
  // A wrapping field is as tall as its text.
  useLayoutEffect(() => {
    const element = area.current;
    if (element === null) return;
    const fit = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft]);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isComposing(event)) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(value);
      // The blur handler reads the draft from the element. Restore it first.
      event.currentTarget.value = value;
      event.currentTarget.blur();
    }
  };
  const input = wrap === true ? (
    <textarea
      ref={area}
      className={`${className ?? ""} wrap-field`}
      value={draft}
      rows={1}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      dir="auto"
      // A pasted line break becomes a space: a name is one line.
      onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, " "))}
      onBlur={(event) => {
        if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
        onDone?.();
      }}
      onKeyDown={onKeyDown}
    />
  ) : (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      dir="auto"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
        onDone?.();
      }}
      onKeyDown={onKeyDown}
    />
  );
  return label === undefined ? input : (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  );
}
