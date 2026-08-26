import type { SelectHTMLAttributes } from "react";

// A plain constrained picker — for choosing among a fixed list of real
// records (a subject, a paper, a chapter), where free text has no meaning.
// components/ui/combobox.tsx is for the opposite case: matching typed text
// against a list, always allowing what was typed. Neither replaces the
// other.

export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-11 w-full rounded-button border border-hairline bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      {...props}
    />
  );
}
