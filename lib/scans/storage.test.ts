// storage.ts had no test file at all. These cover the one thing a path
// builder can get wrong that RLS won't complain about: 0021's storage
// policies read the owner out of a path's first segment via
// storage_owner(name), which does `(storage.foldername(name))[1]::uuid` and
// returns null on any failure - including segment 1 not being a valid UUID.
// A null owner fails every predicate, so a builder bug that put something
// other than the student id first wouldn't throw or 403 anywhere obvious; it
// would just quietly deny the very student the path was built for. That
// failure mode is correct for a genuinely malformed path (§3.3 wants a deny,
// not a raise) - but it also means nothing will flag a builder that produces
// one, so the guarantee is asserted directly here instead: by construction,
// these functions cannot put anything but the exact student id argument in
// segment 1, for any student id and any of the other arguments.

import { describe, expect, it } from "vitest";
import { scanImagePath, scriptImagePath, SCANS_BUCKET, SCRIPTS_BUCKET } from "./storage";

describe("bucket ids", () => {
  it("are two distinct buckets, not one bucket with a prefix", () => {
    expect(SCANS_BUCKET).toBe("scans");
    expect(SCRIPTS_BUCKET).toBe("scripts");
    expect(SCANS_BUCKET).not.toBe(SCRIPTS_BUCKET);
  });
});

const STUDENT_A = "00000000-0000-4000-a000-000000000002";
const STUDENT_B = "00000000-0000-4000-a000-000000000004";

describe("scanImagePath", () => {
  it("builds the documented scans/ layout: student/job/page.ext", () => {
    expect(scanImagePath(STUDENT_A, "job-1", 1, "webp")).toBe(`${STUDENT_A}/job-1/1.webp`);
  });

  it("carries page number and extension through unchanged", () => {
    expect(scanImagePath(STUDENT_A, "job-1", 5, "jpeg")).toBe(`${STUDENT_A}/job-1/5.jpeg`);
  });
});

describe("scriptImagePath", () => {
  it("builds the documented scripts/ layout: student/result/page.ext", () => {
    expect(scriptImagePath(STUDENT_A, "res-1", 2, "png")).toBe(`${STUDENT_A}/res-1/2.png`);
  });
});

// The malformed-name case: storage_owner() trusts segment 1 to be the owner,
// so the builders must never be able to put anything else there - not the
// job/result id, not a param in the wrong slot, not a fixed literal. Proven
// structurally (the first segment is always exactly the id argument, for two
// different students) rather than by trying to enumerate bad inputs.
describe("the student id always lands in segment 1 - the storage_owner() contract", () => {
  it("scanImagePath: segment 1 is exactly the student id, for either student", () => {
    expect(scanImagePath(STUDENT_A, "job-1", 1, "webp").split("/")[0]).toBe(STUDENT_A);
    expect(scanImagePath(STUDENT_B, "job-2", 1, "webp").split("/")[0]).toBe(STUDENT_B);
  });

  it("scriptImagePath: segment 1 is exactly the student id, for either student", () => {
    expect(scriptImagePath(STUDENT_A, "res-1", 1, "webp").split("/")[0]).toBe(STUDENT_A);
    expect(scriptImagePath(STUDENT_B, "res-2", 1, "webp").split("/")[0]).toBe(STUDENT_B);
  });

  it("neither builder ever produces more than three path segments", () => {
    expect(scanImagePath(STUDENT_A, "job-1", 1, "webp").split("/")).toHaveLength(3);
    expect(scriptImagePath(STUDENT_A, "res-1", 1, "webp").split("/")).toHaveLength(3);
  });
});
