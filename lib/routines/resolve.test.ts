// The §5.1 rules, tested against the shapes the real Class VIII sample contains.
//
// These run without a database on purpose. They are the rules Phase 5's parse
// will be judged against, and they need to be settled before a model is in the
// loop — a failure here is a rule that is wrong, not a model that misread.

import { describe, expect, it } from "vitest";
import {
  groupTeacherNames,
  isBreakColumn,
  isNonAcademicText,
  normalise,
  resolveSubject,
  type SubjectCandidate,
} from "./resolve";

const subjects: SubjectCandidate[] = [
  { id: "phy", display_name: "Physics", aliases: ["Phy"] },
  { id: "maths", display_name: "Maths", aliases: ["Math D", "Add Math", "Mathematics"] },
  { id: "chem", display_name: "Chemistry", aliases: [] },
  { id: "env", display_name: "Env. Management", aliases: ["Env Mgt", "EM"] },
  { id: "ben1", display_name: "Bengali I", aliases: [] },
  { id: "ben2", display_name: "Bengali II", aliases: [] },
];

describe("normalise", () => {
  it("collapses the punctuation the school's short forms differ by", () => {
    expect(normalise("E.C.A.")).toBe("eca");
    expect(normalise("Env. Mgt")).toBe("env mgt");
    expect(normalise("Math-D")).toBe("math d");
  });

  it("preserves non-Latin script rather than stripping it", () => {
    // §4.2: Bengali chapters are in Bangla script and must survive verbatim.
    expect(normalise("বাংলা")).toBe("বাংলা");
  });
});

describe("resolveSubject", () => {
  it("matches a subject's own name", () => {
    expect(resolveSubject("Physics", subjects)).toMatchObject({
      subjectId: "phy",
      kind: "exact",
    });
  });

  it("matches an alias — the payoff of §5.1's alias capture", () => {
    expect(resolveSubject("Phy", subjects)).toMatchObject({
      subjectId: "phy",
      kind: "alias",
    });
  });

  it("§5.1 rule 5: 'Maths' maps to the parent subject, not a paper", () => {
    // Math D and Add Math are aliases of the same student_subject; the routine
    // never distinguishes them and paper choice happens at result-logging time.
    expect(resolveSubject("Maths", subjects).subjectId).toBe("maths");
    expect(resolveSubject("Add Math", subjects).subjectId).toBe("maths");
    expect(resolveSubject("Math D", subjects).subjectId).toBe("maths");
  });

  it("ignores punctuation and case differences", () => {
    expect(resolveSubject("env mgt", subjects).subjectId).toBe("env");
    expect(resolveSubject("ENV. MANAGEMENT", subjects).subjectId).toBe("env");
  });

  it("accepts a stem only when it points at one subject", () => {
    expect(resolveSubject("Chem", subjects)).toMatchObject({
      subjectId: "chem",
      kind: "fuzzy",
    });
  });

  it("leaves an ambiguous stem for the human", () => {
    // Bengali I and Bengali II are separate subjects (§10 item 2). Guessing
    // between them would file a result under the wrong teacher's paper.
    expect(resolveSubject("Bengali", subjects).subjectId).toBeNull();
  });

  it("returns null for text no subject matches", () => {
    expect(resolveSubject("Woodwork", subjects)).toMatchObject({
      subjectId: null,
      kind: "none",
      isNonAcademic: false,
    });
  });

  it("§5.1 rule 2: flags a named non-academic period", () => {
    for (const text of ["Games", "E.C.A.", "Assembly", "Library", "BREAK"]) {
      expect(resolveSubject(text, subjects)).toMatchObject({
        subjectId: null,
        isNonAcademic: true,
      });
    }
  });

  it("does not treat a blank cell as non-academic", () => {
    expect(resolveSubject("   ", subjects)).toMatchObject({
      subjectId: null,
      isNonAcademic: false,
    });
    expect(isNonAcademicText("")).toBe(false);
  });
});

describe("isBreakColumn — §5.1 rule 1", () => {
  it("catches the vertical BREAK of the real sample", () => {
    expect(isBreakColumn(["B", "R", "E", "A", "K"])).toBe(true);
  });

  it("catches a column that spells it out on every day", () => {
    expect(isBreakColumn(["Break", "Break", "Break", "Break", "Break"])).toBe(true);
  });

  it("catches a partially filled vertical break", () => {
    expect(isBreakColumn(["B", "R", "", "A", "K"])).toBe(true);
  });

  it("does not treat one stray letter among subjects as a break", () => {
    // The rule §5.1 states is about the column, not the cell. A single-letter
    // cell beside four real subjects is a misread to be corrected, not a break.
    expect(isBreakColumn(["B", "Physics", "Chemistry", "Maths", "Biology"])).toBe(
      false,
    );
  });

  it("does not treat an empty column as a break", () => {
    expect(isBreakColumn(["", "", "", "", ""])).toBe(false);
  });

  it("does not treat a normal subject column as a break", () => {
    expect(
      isBreakColumn(["Physics", "Physics", "Chemistry", "Physics", "Maths"]),
    ).toBe(false);
  });
});

describe("groupTeacherNames — §5.1 rule 4", () => {
  it("flags the sample's Shafiul/Shafiur as one teacher", () => {
    const groups = groupTeacherNames([
      "Shafiul",
      "Shafiul",
      "Shafiur",
      "Rakin",
      "Abrar",
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toEqual(["Shafiul", "Shafiur"]);
    // The spelling used most often wins; Shafiul appears twice.
    expect(groups[0].canonical).toBe("Shafiul");
  });

  it("returns nothing when every name is distinct", () => {
    expect(groupTeacherNames(["Rakin", "Abrar", "Tabassum"])).toEqual([]);
  });

  it("does not group two genuinely different short names", () => {
    // Merging these silently would corrupt the per-teacher signal §5.1 rule 3
    // wants the field for. Three characters is below the threshold.
    expect(groupTeacherNames(["Ali", "Abu"])).toEqual([]);
  });

  it("does not group names that differ at the first letter", () => {
    expect(groupTeacherNames(["Rakin", "Bakin"])).toEqual([]);
  });

  it("ignores blanks", () => {
    expect(groupTeacherNames(["", "  ", "Rakin"])).toEqual([]);
  });
});
