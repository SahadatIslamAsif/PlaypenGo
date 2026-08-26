"use client";

export function SubjectFilterChips({
  subjects,
  selected,
  onSelect,
}: {
  subjects: { id: string; display_name: string }[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={selected === null}
        className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
          selected === null ? "bg-ink text-shell" : "border border-hairline bg-surface text-muted"
        }`}
      >
        All
      </button>
      {subjects.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onSelect(s.id)}
          aria-pressed={selected === s.id}
          className={`shrink-0 rounded-pill px-3 py-1.5 text-xs font-medium transition-colors ${
            selected === s.id ? "bg-ink text-shell" : "border border-hairline bg-surface text-muted"
          }`}
        >
          {s.display_name}
        </button>
      ))}
    </div>
  );
}
