/**
 * The half of Combine that decides: which books get replayed, and every rule
 * that says no.
 *
 * All of it runs with no repository, because `planCombine` takes facts rather
 * than ports — which is the reason the program was split in two. The order of
 * the refusals is policy (a contested book must be named before a mechanical
 * objection like unsaved work), so the ladder is asserted, not just the rungs.
 */

import { describe, expect, it } from "vitest";

import type { ChangedPath } from "../git/git";
import { combineMessage, planCombine, type CombineSurvey } from "./combine";
import { emptyPlan, incomingPlan, type IncomingFile } from "./plan";

const MARK_BASE = "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The beginning.\n";
const MARK_CLOUD = "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The beginning of it.\n";
const MARK_MINE = "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The very beginning.\n";
const LUKE_BASE = "\\id LUK\n\\h Luke\n\\c 1\n\\v 1 Many have undertaken.\n";
const LUKE_CLOUD = "\\id LUK\n\\h Luke\n\\c 1\n\\v 1 Many people have undertaken.\n";

const file = (over: Partial<IncomingFile>): IncomingFile => ({
  path: "42-LUK.usfm",
  bookId: "LUK",
  kind: "modified",
  base: LUKE_BASE,
  cloud: LUKE_CLOUD,
  here: LUKE_BASE,
  ...over,
});

const changed = (...paths: readonly string[]): readonly ChangedPath[] =>
  paths.map((path) => ({ path, kind: "modified" }) as const);

/** Two sides that moved on different books: the combine every rung allows. */
const apart: CombineSurvey = {
  branch: "main",
  localHead: "aaa1",
  cloudHead: "bbb2",
  base: "ccc3",
  ahead: 2,
  behind: 1,
  incoming: incomingPlan([], [file({})]),
  changed: changed("41-MRK.usfm"),
  cloudChanged: changed("42-LUK.usfm"),
  uncommitted: 0,
};

/** The same, with Mark moved on both sides. */
const together: CombineSurvey = {
  ...apart,
  incoming: incomingPlan(
    [],
    [
      file({
        path: "41-MRK.usfm",
        bookId: "MRK",
        base: MARK_BASE,
        cloud: MARK_CLOUD,
        here: MARK_MINE,
      }),
    ],
  ),
  cloudChanged: changed("41-MRK.usfm"),
};

const refusalOf = (survey: CombineSurvey): string | undefined => {
  const decision = planCombine(survey);
  return decision.ok ? undefined : decision.refusal;
};

describe("planCombine", () => {
  it("replays every path this device changed, ascending, as one version", () => {
    const decision = planCombine({
      ...apart,
      changed: changed("41-MRK.usfm", "40-MAT.usfm"),
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.replay).toEqual({
      branch: "main",
      from: "aaa1",
      onto: "bbb2",
      paths: ["40-MAT.usfm", "41-MRK.usfm"],
      message: "Combine: 2 books on top of the cloud",
    });
  });

  it("refuses a book both sides changed, and names it", () => {
    const decision = planCombine(together);
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("contested");
    expect(decision.detail).toContain("MRK");
  });

  it("refuses when the shared project has no copy of this branch", () => {
    expect(refusalOf({ ...apart, cloudHead: undefined })).toBe("no-cloud-copy");
  });

  it("refuses a detached or unborn HEAD before anything else", () => {
    expect(refusalOf({ ...together, branch: undefined })).toBe("no-branch");
  });

  it("refuses a repository with no versions of its own", () => {
    expect(refusalOf({ ...apart, localHead: undefined })).toBe("no-work-here");
  });

  it("refuses two histories with nothing in common rather than guessing a base", () => {
    expect(refusalOf({ ...apart, base: undefined })).toBe("no-shared-version");
  });

  it("refuses when only one side has moved: that is a send or a receive", () => {
    expect(refusalOf({ ...apart, behind: 0, incoming: emptyPlan })).toBe("not-diverged");
    expect(refusalOf({ ...apart, ahead: 0, incoming: emptyPlan })).toBe("not-diverged");
  });

  it("refuses a non-scripture file both sides changed, which no book check sees", () => {
    const decision = planCombine({
      ...apart,
      changed: changed("metadata.json"),
      cloudChanged: changed("metadata.json", "42-LUK.usfm"),
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("contested");
    expect(decision.detail).toContain("metadata.json");
  });

  it("refuses unrecorded work, because the branch move would discard it", () => {
    expect(refusalOf({ ...apart, uncommitted: 2 })).toBe("unrecorded-work");
  });

  it("names the contested book before it mentions unrecorded work", () => {
    expect(refusalOf({ ...together, uncommitted: 2 })).toBe("contested");
  });

  it("refuses a deletion, which a receipt cannot express", () => {
    expect(refusalOf({ ...apart, changed: [{ path: "41-MRK.usfm", kind: "deleted" }] })).toBe(
      "deletion",
    );
  });

  it("refuses when this device's versions changed no file at all", () => {
    expect(refusalOf({ ...apart, changed: [] })).toBe("nothing-to-replay");
  });
});

describe("combineMessage", () => {
  it("says one book without an s", () => {
    expect(combineMessage(1)).toBe("Combine: 1 book on top of the cloud");
  });

  it("counts the books otherwise", () => {
    expect(combineMessage(3)).toBe("Combine: 3 books on top of the cloud");
  });
});
