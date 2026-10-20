import type { BookId } from "@sefer/text/book";
import { Result } from "effect";

import type { DecisionUnit } from "#core/galley";
import type { Diff } from "#core/sync/facts";
import { bookFacts } from "#core/sync/facts";

import { t } from "../../../i18n";
import type { Shell } from "../../../ProjectContext";
import type { Services } from "../../../services";
import type { SendOutcome, settleWithShared } from "../../../syncActions";
import { writerWatch } from "../../../writerWatch";
import { combineRefusal, combineTrouble, receiveRefusal } from "../../cloud/copy";
import type { ReviewBook } from "../ReviewReader";

export const TYPING_PAUSE_MS = 400;

export const LIVE = new Set(["project", "disk"]);

export const keyOf = (bookId: BookId, unitId: string): string => `${bookId}\0${unitId}`;

type SettleOutcome = Awaited<ReturnType<typeof settleWithShared>>;

export const refusedDetail = (outcome: Extract<SettleOutcome, { kind: "refused" }>): string => {
  if (outcome.receive !== undefined) return receiveRefusal(outcome.receive, outcome.books ?? []);
  if (outcome.combine !== undefined) return combineRefusal(outcome.combine);
  if (outcome.state !== undefined) return combineTrouble(outcome.state);
  return outcome.description;
};

export const settledMessage = (copyReview: boolean, settledNames: readonly string[]): string => {
  const books = settledNames.join(", ");
  if (copyReview) {
    return settledNames.length === 0
      ? t("Combined with your copy")
      : t("Combined {books} with your copy", { books });
  }
  return settledNames.length === 0
    ? t("Combined with the shared project")
    : t("Combined {books} with the shared project", { books });
};

export type ReceiptAction = "see" | "copy" | "retry" | "send" | "open" | "offer";

export interface ReceiptLine {
  readonly tone: "success" | "warning" | "error" | "muted";
  readonly title: string;
  readonly detail?: string;
  readonly action?: ReceiptAction;
}

export const sendAction = (
  outcome: SendOutcome,
): "see" | "copy" | "retry" | "send" | "open" | undefined => {
  if (outcome.kind === "held") return "send";
  if (outcome.kind !== "refused") return undefined;
  if (outcome.reason === "Rejected") return outcome.toCopy === true ? "copy" : "see";
  if (outcome.reason === "Unauthorized") return "open";
  return "retry";
};

export interface ChangedSides {
  readonly here: ReadonlySet<string>;
  readonly there: ReadonlySet<string>;
}

export const originAmong = (
  sides: ChangedSides | undefined,
  units: readonly DecisionUnit[],
): "there" | "here" | "both" | undefined => {
  if (sides === undefined) return undefined;
  let here = false;
  let there = false;
  for (const unit of units)
    for (const sid of [unit.currentAddr?.sid, unit.baselineAddr?.sid]) {
      if (sid === undefined) continue;
      if (sides.here.has(sid)) here = true;
      if (sides.there.has(sid)) there = true;
    }
  if (here && there) return "both";
  if (here) return "here";
  if (there) return "there";
  return undefined;
};

export const changedSinceOf = (
  services: Services,
  baseTexts: ReadonlyMap<BookId, { readonly text: string }>,
  editorOnLeft: boolean,
  books: readonly ReviewBook[],
): ReadonlyMap<BookId, ChangedSides> => {
  const out = new Map<BookId, ChangedSides>();
  const diff: Diff = (before, after) => {
    const found = services.galley.diff(before, after);
    return Result.isSuccess(found) ? found.success : undefined;
  };
  for (const book of books) {
    const ancestor = baseTexts.get(book.bookId)?.text;
    if (ancestor === undefined) continue;
    const facts = bookFacts(
      {
        bookId: book.bookId,
        path: "",
        base: ancestor,
        mine: editorOnLeft ? book.currentText : book.baselineText,
        theirs: editorOnLeft ? book.baselineText : book.currentText,
      },
      diff,
    );
    out.set(book.bookId, { here: new Set(facts.mine.refs), there: new Set(facts.theirs.refs) });
  }
  return out;
};

export const writerSide = (shell: Shell) => {
  const project = shell.project();
  const work = writerWatch.facts(project?.root).work;
  if (project === undefined || work.length === 0) return undefined;
  const owners = [...new Set(work.map((each) => each.owner))];
  const texts = new Map<BookId, { text: string; stamp: { revision: number; length: number } }>();
  for (const book of project.books) {
    const text = book.source().text;
    texts.set(book.id, { text, stamp: { revision: 0, length: text.length } });
  }
  for (const each of work)
    texts.set(each.book, {
      text: each.proposal,
      stamp: { revision: 0, length: each.proposal.length },
    });
  return {
    label: t("From Writer ({owners})", { owners: owners.join(", ") }),
    texts: { head: `writer:${work.map((each) => each.head.slice(0, 7)).join("+")}`, texts },
  };
};
