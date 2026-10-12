import { Option, Result } from "effect";

import { trustedBy, type BookId } from "#core/book/book";
import type { Finding } from "#core/findings/finding";
import * as Fixes from "#core/fixes/fixes";
import { tocViewOf } from "#core/galley";
import { addressCode, addressLabel } from "#core/location/address";
import { bookName } from "#core/location/canon";
import { addressAt } from "#core/location/locate";

import { t } from "../../i18n";
import { codeLabel } from "../../ui/panels/findingLabels";
import type { Step, Tour, TourContext } from "../machine";

/**
 * Triage verse numbers: a WORKFLOW, the same machine as a tutorial driving the
 * person through work rather than explaining a screen.
 *
 * Its steps are built when it starts, one per finding about a verse number:
 * Onion's (out of order, repeated, missing in sequence, no verse 1, no number)
 * and Sous's comparison with the source text (a verse the source has and this
 * project lacks, one it has and the source does not, an empty one). In
 * canonical order. Each step takes the editor to the verse and says what is
 * wrong in a panel docked in the corner. When the finding carries the
 * engine's own repair, the panel offers it as a button ("Renumber…"). Once
 * the problem is gone from that verse the panel says "Looks fixed" and waits
 * for Next: it never jumps on by itself, because a Backspace on "3" clears
 * "verse 3 repeated" before the "4" is typed. Skip leaves a step as it is.
 *
 * "Gone from that verse" is asked by ADDRESS, not by the finding's id: the id
 * carries offsets, and any edit before the verse moves them, which would read
 * as fixed when nothing was. A first cut, not a policy: what counts as a
 * verse-number problem, and in what order, is for a Galley or Onion lint rule
 * to own one day.
 */

const CODES = new Set([
  "verse-out-of-order",
  "verse-duplicate",
  "dedupe-verse-number",
  "verse-gap",
  "missing-verse-one",
  "verse-without-designator",
  "verse-before-first-chapter",
  "designator-malformed",
  "bridge-empty-verses",
  "sous.presence.Missing",
  "sous.presence.Extra",
  "sous.presence.Empty",
]);

/** The verse a finding sits in, as a stable key and as a person reads it. */
const placeOf = (
  context: TourContext,
  finding: Finding,
): { readonly key: string; readonly label: string } => {
  const held = Option.getOrUndefined(
    context.shell.services.projectAnalysis.analysis(finding.bookId),
  );
  const metadata = Option.getOrUndefined(context.shell.project()?.metadata() ?? Option.none());
  const name = bookName(finding.bookId, metadata);
  const address =
    held === undefined
      ? undefined
      : addressAt(finding.bookId, tocViewOf(held.analysis), finding.from);
  return address === undefined
    ? { key: `${finding.bookId}@${String(finding.from)}`, label: name }
    : { key: addressCode(address), label: addressLabel(address, name, t("Introduction")) };
};

const onBook = (bookId: BookId): boolean =>
  window.location.pathname.includes(`/book/${encodeURIComponent(bookId)}`);

/** The finding with this code in this verse now, if it is still there. */
const current = (context: TourContext, code: string, key: string): Finding | undefined =>
  context.shell
    .findings()
    .find((finding) => finding.code === code && placeOf(context, finding).key === key);

/**
 * The engine's repair for the finding as it stands NOW: the one the steps
 * were built from carries offsets that any edit earlier in the book has
 * moved, and `Fixes.preview` rightly refuses a stale one.
 */
const repairOf = (
  context: TourContext,
  code: string,
  key: string,
): Fixes.FixPreview | undefined => {
  const finding = current(context, code, key);
  if (finding?.fix === undefined) return undefined;
  const book = context.shell.services.seated(finding.bookId);
  const held = Option.getOrUndefined(
    context.shell.services.projectAnalysis.analysis(finding.bookId),
  );
  if (book === undefined || held === undefined) return undefined;
  const previewed = Fixes.preview(finding, book, held.analysis);
  return Result.isSuccess(previewed) ? previewed.success : undefined;
};

/**
 * Renumbering, straight from the finding: its span IS the verse number (the
 * catalogue's template renders "verse {anchor}" from it) and `expected` is
 * the catalogue's `expectedNumber` aux. Only the two codes whose catalogue
 * row names the repair "renumber to the expected verse": the engine does not
 * attach that repair at these sites today (an ask for kitchen), so the
 * workflow applies the catalogue's own answer. One trusted edit (verse
 * numbers are locked in the editor; this is a deliberate change from the
 * panel, like a fix) and one undo step.
 */
const RENUMBERABLE = new Set(["verse-duplicate", "verse-out-of-order"]);

const renumbering = (
  context: TourContext,
  code: string,
  key: string,
): { readonly to: string; readonly apply: () => void } | undefined => {
  if (!RENUMBERABLE.has(code)) return undefined;
  const finding = current(context, code, key);
  if (finding?.expected === undefined) return undefined;
  const book = context.shell.services.seated(finding.bookId);
  // The span is offsets into the text the finding was published against;
  // after a keystroke since then it points somewhere else, so it is not
  // offered until the next publication, as `Fixes.applyFix` refuses a stale fix.
  if (book === undefined || book.source().stamp.revision !== finding.stamp.revision)
    return undefined;
  const { from, to, bookId } = finding;
  const insert = String(finding.expected);
  return {
    to: insert,
    apply: () => {
      book.apply([{ from, to, insert }], "fix", trustedBy("fix"));
      context.shell.changed({ kind: "book.apply", books: [bookId] });
    },
  };
};

const steps = (context: TourContext): readonly Step[] => {
  const order = new Map(
    (context.shell.project()?.books ?? []).map((book, index) => [book.id, index]),
  );
  const found = context.shell
    .findings()
    .filter((finding) => CODES.has(finding.code))
    .toSorted(
      (left, right) =>
        (order.get(left.bookId) ?? 0) - (order.get(right.bookId) ?? 0) || left.from - right.from,
    );
  if (found.length === 0)
    return [
      {
        panel: {
          title: t("No verse-number problems"),
          body: t(
            "Sefer found nothing out of order, repeated, missing or empty. Nothing to triage.",
          ),
        },
        advance: "user",
      },
    ];
  return found.map((finding): Step => {
    const place = placeOf(context, finding);
    return {
      go: () => {
        context.shell.aim(finding.bookId, finding.from);
        void context.navigate({
          to: "/project/$slug/book/$book",
          params: { slug: context.shell.slug(), book: encodeURIComponent(finding.bookId) },
        });
      },
      ready: () => onBook(finding.bookId),
      panel: {
        title: t("{place}: {problem}", { place: place.label, problem: codeLabel(finding.code) }),
        body: finding.message,
        actions: [
          {
            label: () => {
              const held = renumbering(context, finding.code, place.key);
              return held === undefined ? undefined : t("Renumber to {n}", { n: held.to });
            },
            run: () => renumbering(context, finding.code, place.key)?.apply(),
          },
          {
            label: () => repairOf(context, finding.code, place.key)?.label,
            run: () => {
              const repair = repairOf(context, finding.code, place.key);
              const book = context.shell.services.seated(finding.bookId);
              if (repair === undefined || book === undefined) return;
              Fixes.applyFix(repair, book);
              context.shell.changed({ kind: "book.apply", books: [finding.bookId] });
            },
          },
        ],
      },
      done: () => current(context, finding.code, place.key) === undefined,
      advance: "user",
    };
  });
};

/**
 * Whether the findings have settled. The steps ARE the findings, and a
 * project that has just opened publishes them in passes: Onion's first, then
 * Sous's comparison with the source text once that text has registered,
 * which `findingsPending` does not cover. So: not pending, and the same
 * count for 2.5 s. A heuristic, capped by the machine's own wait.
 */
let seen = -1;
let since = 0;
const SETTLED_MS = 2500;
const settled = (context: TourContext): boolean => {
  const count = context.shell.findings().length;
  if (context.shell.findingsPending() || count !== seen) {
    seen = count;
    since = Date.now();
    return false;
  }
  return Date.now() - since >= SETTLED_MS;
};

export const verseNumbersWorkflow: Tour = {
  id: "triage-verse-numbers",
  kind: "workflow",
  title: "Triage verse numbers",
  summary:
    "Every verse number out of order, repeated, missing or empty, against your source text, one at a time; each moves on once fixed.",
  needsProject: true,
  startable: settled,
  steps,
};
