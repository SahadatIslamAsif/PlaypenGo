import { describe, expect, it } from "vitest";
import { analyzeGrouping, splitPagesAt, type PageInfo } from "./grouping";

describe("analyzeGrouping", () => {
  it("flags an orphan first page rather than attaching it to nothing", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: false, subject: null, date: null },
      { pageNo: 2, hasHeader: false, subject: null, date: null },
    ];
    expect(analyzeGrouping(pages)).toEqual([{ kind: "orphan_first_page" }]);
  });

  it("flags a later header page whose subject and date genuinely differ - a real second paper", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 2, hasHeader: false, subject: null, date: null },
      { pageNo: 3, hasHeader: true, subject: "chemistry", date: "2026-08-19" },
    ];
    expect(analyzeGrouping(pages)).toEqual([{ kind: "possible_split", atPageNo: 3 }]);
  });

  it("is silent on the ordinary case - one header, everything else headerless", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 2, hasHeader: false, subject: null, date: null },
    ];
    expect(analyzeGrouping(pages)).toEqual([]);
  });

  // §5.3: "A CT question paper may print its header on every page. Guard
  // with same subject + same date + consecutive → same paper." This is the
  // shape that guard exists for, and the whole reason it's in the spec: a
  // 3-page CT that reprints its header on every page must not read as two
  // (or three) papers just because pages 2 and 3 have headers too.
  it("does not flag a CT that reprints its header on every page - same subject, same date, consecutive", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 2, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 3, hasHeader: true, subject: "physics", date: "2026-08-18" },
    ];
    expect(analyzeGrouping(pages)).toEqual([]);
  });

  it("still flags within a repeated-header run if a later page's date actually changes", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 2, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 3, hasHeader: true, subject: "physics", date: "2026-08-19" },
    ];
    expect(analyzeGrouping(pages)).toEqual([{ kind: "possible_split", atPageNo: 3 }]);
  });

  // An unresolved subject or date is the ordinary shape of a bad photo -
  // glare, a fold across the header, a subject the alias table hasn't seen
  // yet - not evidence of a second paper. It must read as "unknown," never as
  // "disagrees": flagging it would fire the warning most often exactly when
  // the parse tells us least, the opposite of the bias-to-silence this guard
  // exists for. Getting this wrong the other way (grouping two genuinely
  // different papers as one) costs one tap to split them in the review
  // screen - cheap enough that unknown should never be treated as worse than
  // that. Do not "fix" this back to flagging null as a mismatch.
  it("does not flag a header page with an unresolved subject or date - unknown is not disagreement", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 2, hasHeader: true, subject: null, date: null },
    ];
    expect(analyzeGrouping(pages)).toEqual([]);
  });

  it("keeps the last resolved identity across an unresolved page, so a later real split still gets caught", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: true, subject: "physics", date: "2026-08-18" },
      { pageNo: 2, hasHeader: true, subject: null, date: null },
      { pageNo: 3, hasHeader: true, subject: "chemistry", date: "2026-08-19" },
    ];
    expect(analyzeGrouping(pages)).toEqual([{ kind: "possible_split", atPageNo: 3 }]);
  });

  it("never treats an unparsed page (null hasHeader) as a signal either way", () => {
    const pages: PageInfo[] = [
      { pageNo: 1, hasHeader: null, subject: null, date: null },
      { pageNo: 2, hasHeader: null, subject: null, date: null },
    ];
    expect(analyzeGrouping(pages)).toEqual([]);
  });

  it("does not care about capture order in the input, only page_no", () => {
    const pages: PageInfo[] = [
      { pageNo: 2, hasHeader: false, subject: null, date: null },
      { pageNo: 1, hasHeader: false, subject: null, date: null },
    ];
    expect(analyzeGrouping(pages)).toEqual([{ kind: "orphan_first_page" }]);
  });
});

describe("splitPagesAt", () => {
  it("moves everything from the split point onward into a fresh, renumbered group", () => {
    const pages = [
      { pageNo: 1, storagePath: "a" },
      { pageNo: 2, storagePath: "b" },
      { pageNo: 3, storagePath: "c" },
    ];
    const { keep, moved } = splitPagesAt(pages, 3);
    expect(keep).toEqual([
      { pageNo: 1, storagePath: "a" },
      { pageNo: 2, storagePath: "b" },
    ]);
    expect(moved).toEqual([{ pageNo: 1, storagePath: "c" }]);
  });

  it("handles an out-of-order input the same as a sorted one", () => {
    const pages = [
      { pageNo: 3, storagePath: "c" },
      { pageNo: 1, storagePath: "a" },
      { pageNo: 2, storagePath: "b" },
    ];
    const { keep, moved } = splitPagesAt(pages, 2);
    expect(keep).toEqual([{ pageNo: 1, storagePath: "a" }]);
    expect(moved).toEqual([
      { pageNo: 1, storagePath: "b" },
      { pageNo: 2, storagePath: "c" },
    ]);
  });
});
