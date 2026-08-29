"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DesktopProgressChart, MobileProgressChart } from "../../_components/dashboard/progress-chart";
import {
  ManualEntrySheet,
  type ChapterOption,
  type PaperOption,
  type SubjectOption,
} from "./manual-entry-sheet";
import { ResultCard } from "./result-card";
import { SubjectFilterChips } from "./subject-filter-chips";
import {
  countUnlogged,
  filterBySubject,
  type ResultListItem,
  type UnloggedAssessmentRow,
} from "@/lib/assessments/list";
import type { SubjectSeries } from "@/lib/assessments/series";

export function ResultsScreen({
  studentId,
  editable,
  canDelete,
  items,
  unloggedAssessments,
  series,
  today,
  subjects,
  papers,
  chapters,
}: {
  studentId: string;
  editable: boolean;
  canDelete: boolean;
  items: ResultListItem[];
  /** Everything results itself can't show: an assessment past its date (or
   * confirmed via §7.6's "did this happen?") with no result yet. Read
   * alongside `items.length === 0` so the empty state can tell "nothing has
   * come up" apart from "papers happened and nobody's logged them" -
   * CLAUDE.md's quality floor, and the whole reason this prop exists. */
  unloggedAssessments: UnloggedAssessmentRow[];
  series: SubjectSeries[];
  today: string;
  subjects: SubjectOption[];
  papers: PaperOption[];
  chapters: ChapterOption[];
}) {
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const filtered = filterBySubject(items, subjectFilter);
  const filterOptions = subjects.filter((s) => items.some((i) => i.subjectId === s.id));
  const unloggedCount = countUnlogged(unloggedAssessments, subjectFilter, today);

  return (
    <div className="flex flex-col gap-5 pb-nav-clear lg:pb-0">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-ink">Results</h1>
        {editable ? (
          <Button type="button" onClick={() => setSheetOpen(true)}>
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Log result
          </Button>
        ) : null}
      </div>

      {filterOptions.length > 0 ? (
        <SubjectFilterChips
          subjects={filterOptions}
          selected={subjectFilter}
          onSelect={setSubjectFilter}
        />
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          {unloggedCount > 0 ? (
            <>
              <p className="text-sm font-semibold text-ink">
                {unloggedCount} unlogged {unloggedCount === 1 ? "paper" : "papers"}
              </p>
              <p className="mt-1 text-sm text-muted">
                {editable
                  ? "These have already happened - scan or log them to keep the record current."
                  : "These have already happened but haven't been logged yet."}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-ink">No results yet</p>
              <p className="mt-1 text-sm text-muted">
                {editable ? "Scan a paper to start tracking." : "Nothing has come up to log yet."}
              </p>
            </>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => (
            <ResultCard key={item.resultId} item={item} canDelete={canDelete} canAttach={editable} />
          ))}
        </div>
      )}

      <Card>
        <p className="mb-3 text-sm font-semibold text-ink">Trend</p>
        <div className="hidden sm:block">
          <DesktopProgressChart series={series} />
        </div>
        <div className="sm:hidden">
          <MobileProgressChart series={series} today={today} />
        </div>
      </Card>

      {editable ? (
        <ManualEntrySheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          studentId={studentId}
          subjects={subjects}
          papers={papers}
          chapters={chapters}
          today={today}
        />
      ) : null}
    </div>
  );
}
