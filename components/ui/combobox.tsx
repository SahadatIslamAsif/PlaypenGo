"use client";

import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

// A text input that suggests as you type. Extracted from the subject
// autocomplete that was inline in add-subject-form, because the routine editor
// needs the same control against a different list — the school's own subject
// names rather than the Cambridge catalogue.
//
// Free text is always allowed. Both callers keep what the user typed as well as
// what it matched: §4.1's display_name preserves what the school calls a
// subject, and §5.1 keeps raw_text exactly as the routine cell wrote it.

export type ComboboxItem = {
  id: string;
  label: string;
  /** Alternative spellings this item should also match on. */
  keywords?: string[];
  /** Secondary text on the right of the row — a teacher, a syllabus code. */
  hint?: string;
};

export function Combobox({
  id,
  name,
  value,
  items,
  onChange,
  onSelect,
  onBlur,
  placeholder,
  minChars = 2,
  maxSuggestions = 6,
  disabled = false,
  className = "",
  inputClassName = "",
  "aria-label": ariaLabel,
}: {
  id?: string;
  name?: string;
  value: string;
  items: ComboboxItem[];
  onChange: (text: string) => void;
  onSelect: (item: ComboboxItem) => void;
  /** Fired once the suggestion list has had its chance to take the click. */
  onBlur?: () => void;
  placeholder?: string;
  minChars?: number;
  maxSuggestions?: number;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
}) {
  const [focused, setFocused] = useState(false);
  const generatedId = useId();
  const listId = `${id ?? generatedId}-suggestions`;

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (query.length < minChars) return [];
    return items
      .filter(
        (item) =>
          item.label.toLowerCase().includes(query) ||
          item.keywords?.some((k) => k.toLowerCase().includes(query)),
      )
      .slice(0, maxSuggestions);
  }, [items, value, minChars, maxSuggestions]);

  const open = focused && suggestions.length > 0;

  return (
    <div className={`relative ${className}`}>
      <Input
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        // Deferred so a click on a suggestion lands before the list unmounts.
        // onBlur runs on the same delay, so a live-mode save sees the value the
        // suggestion set rather than the half-typed text it replaced.
        onBlur={() =>
          window.setTimeout(() => {
            setFocused(false);
            onBlur?.();
          }, 120)
        }
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className={inputClassName}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1.5 flex w-full flex-col gap-1 rounded-button border border-hairline bg-surface p-1 shadow-elevated"
        >
          {suggestions.map((item) => (
            <li key={item.id} role="option" aria-selected={false}>
              <button
                type="button"
                // onMouseDown, not onClick: blur would otherwise close the list
                // before the click registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                  setFocused(false);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-button px-2 py-1.5 text-left text-sm text-body hover:bg-surface-sunk"
              >
                <span>{item.label}</span>
                {item.hint ? (
                  <span className="text-xs text-muted">{item.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
