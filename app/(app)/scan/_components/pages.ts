// The paper-grouping logic shared between scan-screen.tsx (Done splits one
// scan_jobs row per paper, §5.3: "One paper per job.") and page-strip.tsx
// (the "Paper N" labels the strip renders). One function, so the number a
// page uploads under is always the same number its own label already
// showed - never two independent computations that could drift apart.

export type CapturedPage = {
  id: string;
  blob: Blob;
  extension: string;
  width: number;
  height: number;
  previewUrl: string;
  /** Ignored for index 0. Authored per page, never derived from a
   * neighbour - see page-strip.tsx. */
  sameAsPrevious: boolean;
};

/** Paper number (1-indexed) for each page, by index - a pure scan of each
 * page's own sameAsPrevious boolean. Never derived from a neighbour beyond
 * that: toggling one page's boundary never renumbers any other page's own
 * choice, only shifts which paper number it lands in. */
export function paperNumbers(pages: CapturedPage[]): number[] {
  const numbers: number[] = [];
  let current = 1;
  pages.forEach((page, i) => {
    if (i > 0 && !page.sameAsPrevious) current += 1;
    numbers.push(current);
  });
  return numbers;
}

/** Pages split into one array per paper, in paper order, pages within a
 * paper kept in capture order - exactly what Done uploads as separate
 * scan_jobs rows. */
export function groupIntoPapers(pages: CapturedPage[]): CapturedPage[][] {
  const numbers = paperNumbers(pages);
  const groups: CapturedPage[][] = [];
  pages.forEach((page, i) => {
    const paperIndex = numbers[i] - 1;
    (groups[paperIndex] ??= []).push(page);
  });
  return groups;
}
