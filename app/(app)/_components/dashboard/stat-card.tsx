import { ProgressRing } from "@/components/charts/progress-ring";
import { formatConverted, formatRaw } from "@/lib/assessments/marks";

// Design system: "tinted fill, circular progress ring on the left ..., small
// muted date above a large label. Used for the three most recent results."

const TINTS = ["bg-tint-mint", "bg-tint-sage", "bg-tint-teal"] as const;

export type StatCardData = {
  date: string;
  subjectName: string;
  type: "CT" | "CWM";
  rawObtained: number;
  rawTotal: number;
  converted: number;
  percentage: number;
};

export function StatCard({ data, tintIndex }: { data: StatCardData; tintIndex: number }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-3 rounded-tint p-4 ${TINTS[tintIndex % TINTS.length]}`}
    >
      {/* --tint-ink, not --ink: this ring sits on a tint fill that is
          deliberately pale in both themes (see globals.css), while --ink
          inverts to a light colour in dark mode — exactly the low-contrast
          mismatch Phase 3 hit with a mint card full of dark inputs. */}
      <ProgressRing percentage={data.percentage} color="var(--tint-ink)" />
      {/* Three short lines rather than two long ones — at three-per-row on
          desktop the card is roughly 160px wide, and "Physics · CWM" plus
          "9 / 10 raw · 13.5 / 15" on one line each does not fit without
          truncating mid-word. Splitting the type onto its own line with the
          percentage, and the raw->converted mapping onto another, keeps
          every line short enough to read in full. */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-tint-ink/60">{formatDate(data.date)}</p>
        <p className="truncate text-sm font-semibold text-tint-ink">{data.subjectName}</p>
        <p className="text-xs text-tint-ink/70">
          {data.type} · {data.percentage}%
        </p>
        <p className="text-xs text-tint-ink/70">
          {formatRaw(data.rawObtained, data.rawTotal)} → {formatConverted(data.converted, data.type === "CT" ? 25 : 15)}
        </p>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
