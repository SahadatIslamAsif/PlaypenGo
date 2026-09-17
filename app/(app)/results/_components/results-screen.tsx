"use client";

import { CalendarClock, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrendChart } from "../../_components/dashboard/progress-chart";
import { ScheduleCTSheet } from "../../_components/schedule-ct-sheet";
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
  type ScheduledCTItem,
  type UnloggedAssessmentRow,
} from "@/lib/assessments/list";
import type { SubjectSeries } from "@/lib/assessments/series";

export function ResultsScreen({
  studentId,
  editable,
  canDelete,
  canCorrect = false,
  items,
  scheduledCTs,
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
  /** §3.3's tutor UPDATE-only path - never true alongside `editable`. */
  canCorrect?: boolean;
  items: ResultListItem[];
  /** A scheduled-but-unlogged CT - buildResultsList() above never surfaces
   *  one (it loops `results`, so an assessment with no result row never
   *  appears), so the CT section merges this in as its other source. */
  scheduledCTs: ScheduledCTItem[];
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
  const [editingCTId, setEditingCTId] = useState<string | null>(null);

  const filtered = filterBySubject(items, subjectFilter);
  const scheduledFiltered = subjectFilter
    ? scheduledCTs.filter((ct) => ct.subjectId === subjectFilter)
    : scheduledCTs;
  const filterOptions = subjects.filter(
    (s) => items.some((i) => i.subjectId === s.id) || scheduledCTs.some((c) => c.subjectId === s.id),
  );
  const unloggedCount = countUnlogged(unloggedAssessments, subjectFilter, today);

  // §8: scheduled sits above logged as one fixed block, never interleaved by
  // raw date - a logged CT from weeks ago must never bury one due tomorrow.
  const ctItems = filtered.filter((i) => i.type === "CT");
  const cwmItems = filtered.filter((i) => i.type === "CWM");
  const hasAnything = filtered.length > 0 || scheduledFiltered.length > 0;

  const editingCT = editingCTId ? (scheduledCTs.find((c) => c.assessmentId === editingCTId) ?? null) : null;
  const editingSubjectChapters = editingCT
    ? chapters
        .filter((c) => c.student_subject_id === editingCT.subjectId)
        .map((c) => ({ id: c.id, name: c.name, paperId: c.paper_id }))
    : [];
  const editingSubjectPapers = editingCT
    ? papers.filter((p) => p.student_subject_id === editingCT.subjectId).map((p) => ({ id: p.id, name: p.name }))
    : [];

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

      {!hasAnything ? (
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
        // CT and CWM sit in their own column from `sm:` up - two columns
        // side by side (CWM left, CT right), each independently
        // scrollable-length, rather than one full block stacked on top of
        // the other where a long CT list pushes CWM entries out of view.
        // Below `sm:` (true mobile) they still stack, CT first, matching
        // §8's fixed CT-above-CWM ordering - CT stays first in the DOM for
        // that, and only `sm:order-*` flips which column it lands in once
        // there are two side by side.
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:items-start">
          {scheduledFiltered.length > 0 || ctItems.length > 0 ? (
            <div className="flex flex-col gap-2 sm:order-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">CT</p>
              <div className="flex flex-col gap-3">
                {scheduledFiltered.map((ct) => (
                  <ScheduledCTRow
                    key={ct.assessmentId}
                    ct={ct}
                    editable={editable}
                    onEdit={() => setEditingCTId(ct.assessmentId)}
                  />
                ))}
                {ctItems.map((item) => (
                  <ResultCard
                    key={item.resultId}
                    item={item}
                    canDelete={canDelete}
                    canAttach={editable}
                    canCorrect={canCorrect}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {cwmItems.length > 0 ? (
            <div className="flex flex-col gap-2 sm:order-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">CWM</p>
              <div className="flex flex-col gap-3">
                {cwmItems.map((item) => (
                  <ResultCard
                    key={item.resultId}
                    item={item}
                    canDelete={canDelete}
                    canAttach={editable}
                    canCorrect={canCorrect}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Card className="min-w-0 max-w-full overflow-hidden">
        <p className="mb-3 text-sm font-semibold text-ink">Trend</p>
        <div className="hidden sm:block">
          <TrendChart series={series} today={today} subjectFilter={subjectFilter} />
        </div>
        <div className="sm:hidden">
          <TrendChart series={series} today={today} weeksLimit={6} subjectFilter={subjectFilter} />
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

      {editable && editingCT ? (
        <ScheduleCTSheet
          key={editingCT.assessmentId}
          open={true}
          onClose={() => setEditingCTId(null)}
          studentId={studentId}
          subjectId={editingCT.subjectId}
          subjectName={editingCT.subjectName}
          chapters={editingSubjectChapters}
          papers={editingSubjectPapers}
          defaultName={editingCT.name ?? "CT"}
          today={today}
          ctDates={new Set(scheduledCTs.map((c) => c.scheduledDate))}
          editing={{
            assessmentId: editingCT.assessmentId,
            name: editingCT.name,
            scheduledDate: editingCT.scheduledDate,
            chapterIds: editingCT.chapterIds,
          }}
        />
      ) : null}
    </div>
  );
}

function ScheduledCTRow({
  ct,
  editable,
  onEdit,
}: {
  ct: ScheduledCTItem;
  editable: boolean;
  onEdit: () => void;
}) {
  const label = `${ct.name ?? "CT"} · ${ct.subjectName}`;

  return (
    // Same min-height and top/middle/footer rhythm as a logged ResultCard
    // (min-h-[118px]) so a scheduled CT - which has no score breakdown or
    // footer actions of its own - doesn't read as visually shorter next to
    // the logged cards sharing its column.
    <button
      type="button"
      disabled={!editable}
      onClick={onEdit}
      className="flex min-h-[118px] flex-col justify-between gap-3 rounded-card border border-hairline bg-surface p-4 text-left shadow-soft transition-colors enabled:hover:bg-surface-sunk disabled:cursor-default"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">{label}</p>
            {ct.paperName ? <span className="text-xs text-muted">{ct.paperName}</span> : null}
          </div>
          {ct.chapterNames.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted">{ct.chapterNames.join(", ")}</p>
          ) : null}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-tint-sage px-2.5 py-1 text-xs font-medium text-tint-ink">
          <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} />
          {formatScheduledDate(ct.scheduledDate)}
        </span>
      </div>
      <p className="text-xs text-muted">Scheduled · awaiting paper</p>
    </button>
  );
}

function formatScheduledDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
