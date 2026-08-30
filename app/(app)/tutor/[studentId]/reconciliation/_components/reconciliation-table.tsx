"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import type { ReconciliationRow } from "@/lib/assessments/reconciliation";

// Cards, not a table — CLAUDE.md's "Tables become cards" rule holds even
// here, where §6 literally says "table"; the rule is about the layout
// primitive, not this one screen. The Portal column is local state only
// (see the page's own comment on why it isn't persisted) - refreshing or
// leaving the page loses it, which is fine for a value that's only ever
// read once, in the room, against a screen the tutor is looking at anyway.
export function ReconciliationTable({ rows }: { rows: ReconciliationRow[] }) {
  const [portalValues, setPortalValues] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm font-semibold text-ink">No subjects yet</p>
        <p className="mt-1 text-sm text-muted">
          There&apos;s nothing to reconcile until this student has an active subject.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const nothingLogged = row.cwmCount === 0 && row.ctCount === 0;
        return (
          <Card key={row.subjectId}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">{row.subjectName}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                  <span>
                    CWM: {row.cwmAverage !== null ? `${row.cwmAverage} / 15` : "none logged"}
                    {row.cwmCount > 0 ? ` (${row.cwmCount})` : ""}
                  </span>
                  <span>
                    CT: {row.ctAverage !== null ? `${row.ctAverage} / 25` : "none logged"}
                    {row.ctCount > 0 ? ` (${row.ctCount})` : ""}
                  </span>
                </div>
                {nothingLogged ? (
                  <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-danger">
                    <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Nothing logged in the app for this subject
                  </p>
                ) : null}
              </div>

              <label className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-[11px] font-medium text-muted">Portal</span>
                <input
                  type="text"
                  value={portalValues[row.subjectId] ?? ""}
                  onChange={(e) =>
                    setPortalValues((prev) => ({ ...prev, [row.subjectId]: e.target.value }))
                  }
                  placeholder="—"
                  className="h-9 w-24 rounded-button border border-hairline bg-surface px-2 text-right text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </label>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
