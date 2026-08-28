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
import { filterBySubject, type ResultListItem } from "@/lib/assessments/list";
import type { SubjectSeries } from "@/lib/assessments/series";

export function ResultsScreen({
  studentId,
  editable,
  canDelete,
  items,
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
          <p className="text-sm font-semibold text-ink">No results yet</p>
          <p className="mt-1 text-sm text-muted">
            {editable
              ? "Log a result to start tracking, or scan a paper once scanning ships."
              : "Nothing has been logged for this subject yet."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((item) => (
            <ResultCard key={item.resultId} item={item} canDelete={canDelete} />
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
