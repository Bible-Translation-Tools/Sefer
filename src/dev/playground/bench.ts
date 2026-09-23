/**
 * Real text, on demand, without clicking around — the "half wired" half.
 *
 * A diff prototype needs two texts that differ in the ways scripture actually
 * differs: a reworded verse, a verse only one side has, a change that is pure
 * markup. Getting that out of the real application means opening a project,
 * making some edits, saving, making some more — every time, before you can look
 * at the thing you are trying to design.
 *
 * So the bench takes the OPEN PROJECT's live book text as the `current` side —
 * real USFM, real chapter and verse structure, the reader's own project — and
 * offers two ways to get a `baseline` to put beside it:
 *
 *   * `disk` — what was actually written, from `SaveCoordinator.baseline`. True,
 *     and usually empty, which is exactly why it is not the default.
 *   * `draft` — a SYNTHETIC earlier draft: the same text, walked backwards
 *     through a handful of deterministic edits. It is not honest scripture and
 *     it is not trying to be; it is a fixture that guarantees one of each kind
 *     of unit so a layout can be judged. Deterministic, so the screen does not
 *     rearrange itself under you between reloads.
 *
 * Nothing here writes. The project's books are read through the same
 * `book.source()` the compare port reads, and the mutation happens on a string.
 */

import { Option, Result } from "effect";

import { diffSkeleton } from "../../core/diff/skeleton";
import type { GalleyService } from "../../core/galley";
import type { Project } from "../../core/project/project";
import type { SaveCoordinatorService } from "../../core/save/saveCoordinator";
import type { Bench } from "./experiment";

export type BaselineKind = "draft" | "disk";

/** How busy the synthetic draft is: one edit per this many verses. */
const SPACING: Record<string, number> = { light: 29, normal: 11, heavy: 4 };

/**
 * The synthetic earlier draft.
 *
 * Walks the book's `\v` lines and rewrites every Nth one, rotating through the
 * four shapes a reviewer has to be able to tell apart at a glance:
 *
 *   0. reworded — the same verse, different words. The common case, and the one
 *      an intra-unit word diff is for.
 *   1. shorter — a clause the current text has and the draft does not, so the
 *      unit is an addition rather than a rewrite.
 *   2. absent — the verse is missing from the draft entirely: a one-sided unit
 *      with nothing to put in the other column.
 *   3. markup only — the paragraph marker differs and not one reader-visible
 *      character does. This is the unit every "just show me the words" layout
 *      renders as blank, which is the whole reason it is in the fixture.
 *   4. dropped since — the draft holds a verse the current text does not, so
 *      the one-sided unit points the OTHER way. It is written as a duplicate of
 *      the verse beside it, which is a thing real USFM does and which the
 *      engine addresses with `_dup_`; a layout that cannot show two units at
 *      one reference should find that out here rather than in front of a
 *      translator.
 *
 * Deterministic by position, with no randomness at all: the same book always
 * produces the same draft, so two runs of the playground can be compared.
 */
const syntheticDraft = (text: string, spacing: number): string => {
  const lines = text.split("\n");
  const out: string[] = [];
  let verse = 0;
  for (const line of lines) {
    if (!line.startsWith("\\v ")) {
      out.push(line);
      continue;
    }
    verse += 1;
    if (verse % spacing !== 0) {
      out.push(line);
      continue;
    }
    const shape = Math.floor(verse / spacing) % 5;
    const marker = /^\\v \S+\s*/.exec(line)?.[0] ?? "\\v ? ";
    const body = line.slice(marker.length);
    const words = body.split(" ");
    if (shape === 0) {
      // Reworded: three words in the middle replaced, so the marks land inside
      // the verse rather than at either end where they are easy to render.
      const at = Math.max(1, Math.floor(words.length / 3));
      out.push(
        marker +
          [...words.slice(0, at), "in", "the", "former", "rendering", ...words.slice(at + 3)].join(
            " ",
          ),
      );
    } else if (shape === 1) {
      // Shorter: the draft stops early, so the current side is an addition.
      out.push(marker + words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(" "));
    } else if (shape === 2) {
      // Absent: the line is simply not written.
      continue;
    } else if (shape === 3) {
      // Markup only: same words, different paragraph. The `\q1` is emitted
      // before the verse, which is where a paragraph marker lives in USFM.
      out.push("\\q1");
      out.push(line);
    } else {
      // Dropped since: the draft says this verse twice and the current text
      // says it once.
      out.push(line);
      out.push(`${marker}And they abode there, and it was told in the tents of their fathers.`);
    }
  }
  return out.join("\n");
};

export interface BenchRequest {
  readonly project: Project | undefined;
  readonly galley: GalleyService;
  readonly save: SaveCoordinatorService;
  readonly bookId: string | undefined;
  readonly baseline: BaselineKind;
  /** A key of `SPACING`; anything else reads as `normal`. */
  readonly density: string;
}

/**
 * The bench, or `undefined` when there is no project, no book, or no baseline
 * of the requested kind — which the frame says in words rather than rendering
 * an experiment over two empty strings.
 */
export const benchFor = (request: BenchRequest): Bench | undefined => {
  const { project, bookId } = request;
  if (project === undefined || bookId === undefined) return undefined;
  const book = project.book(bookId);
  if (book === undefined) return undefined;

  const currentText = book.source().text;
  const baselineText =
    request.baseline === "disk"
      ? Option.getOrUndefined(request.save.baseline(book))?.text
      : syntheticDraft(currentText, SPACING[request.density] ?? 9);
  if (baselineText === undefined) return undefined;

  const found = diffSkeleton(request.galley, bookId, baselineText, currentText);

  return {
    bookId,
    baselineLabel: request.baseline === "disk" ? "on disk" : "a synthetic earlier draft",
    currentLabel: "in the editor",
    baselineText,
    currentText,
    skeleton: Result.isSuccess(found) ? found.success : undefined,
    refusal: Result.isFailure(found) ? found.failure.description : undefined,
    galley: request.galley,
  };
};
