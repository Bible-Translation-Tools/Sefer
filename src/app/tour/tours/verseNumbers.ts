import { trustedBy, type BookId } from "@wycliffeassociates/sefer-text/book";
import { addressCode, addressLabel } from "@wycliffeassociates/sefer-text/location/address";
import { bookName } from "@wycliffeassociates/sefer-text/location/canon";
import { addressAt } from "@wycliffeassociates/sefer-text/location/locate";
import { Option, Result } from "effect";

import { m } from "#app/paraglide/messages";
import type { Finding } from "#core/findings/finding";
import * as Fixes from "#core/fixes/fixes";
import { tocViewOf } from "#core/galley";

import { codeLabel } from "../../ui/panels/findingLabels";
import { findingMessage } from "../../ui/rules/labelMessages";
import type { Step, Tour, TourContext } from "../machine";

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
    : { key: addressCode(address), label: addressLabel(address, name, m.tour_introduction()) };
};

const onBook = (bookId: BookId): boolean =>
  window.location.pathname.includes(`/book/${encodeURIComponent(bookId)}`);

const current = (context: TourContext, code: string, key: string): Finding | undefined =>
  context.shell
    .findings()
    .find((finding) => finding.code === code && placeOf(context, finding).key === key);

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

const stepFor = (context: TourContext, finding: Finding): Step => {
  const place = placeOf(context, finding);
  return {
    go: () => {
      context.shell.aim(
        finding.bookId,
        current(context, finding.code, place.key)?.from ?? finding.from,
      );
      void context.navigate({
        to: "/project/$slug/book/$book",
        params: { slug: context.shell.slug(), book: encodeURIComponent(finding.bookId) },
      });
    },
    ready: () => onBook(finding.bookId),
    panel: {
      title: m.tour_place_problem({ place: place.label, problem: codeLabel(finding.code) }),
      body: findingMessage(finding),
      actions: [
        {
          label: () => {
            const held = renumbering(context, finding.code, place.key);
            return held === undefined ? undefined : m.tour_renumber_to_n({ n: held.to });
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
          title: m.tour_no_verse_number_problems(),
          body: m.tour_sefer_found_nothing_out_of(),
        },
        advance: "user",
      },
    ];
  return found.map((finding) => stepFor(context, finding));
};

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
  audience: "field",
  title: m.tour_triage_verse_numbers,
  summary: m.tour_triage_verse_numbers_summary,
  needsProject: true,
  startable: settled,
  steps,
};
