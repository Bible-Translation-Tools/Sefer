import { Option } from "effect";

import type { BookId } from "#core/book/book";
import type { Finding } from "#core/findings/finding";
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
 * canonical order. Each step takes the editor to the verse, says what is
 * wrong in a panel docked in the corner, and moves on by itself once that
 * problem is gone from that verse; Skip leaves it.
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

/** Whether a finding with this code is still in this verse. */
const stillThere = (context: TourContext, code: string, key: string): boolean =>
  context.shell
    .findings()
    .some((finding) => finding.code === code && placeOf(context, finding).key === key);

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
      },
      advance: () => !stillThere(context, finding.code, place.key),
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
