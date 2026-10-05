/**
 * Every word `/cloud` says, in one table keyed by the state.
 *
 * v1 learned this the expensive way: the chip, the banner, the panel and the
 * settings rows each grew their own wording for the same six situations, and
 * they drifted. So the glossary is physically one module, keyed by the enum,
 * and a surface that wants to describe a state has nowhere else to look.
 *
 * Three rules the strings themselves follow:
 *
 * 1. **No git words.** Nobody sees branch, commit, HEAD, merge, rebase, fetch
 *    or origin. The online copy is "the shared project"; a version is a
 *    version. The git vocabulary lives in `src/core`, where it is accurate,
 *    and stops at this file.
 * 2. **Every anxious state reassures about local safety.** Offline, behind,
 *    diverged and conflicted all end by saying the work is still here. A
 *    translator's first fear is losing a morning's work, and answering it
 *    costs one clause.
 * 3. **Every action says what it will do, in one sentence, before it runs.**
 *    That sentence is `narrate`, it sits under the button, and it names what
 *    moves and what does not.
 */

import type {
  CombineRefusal,
  CombineState,
  IncomingPlan,
  ReceiveRefusal,
  SyncActionId,
  SyncState,
} from "#core/sync";
import { FRONT_MATTER } from "#core/sync";

import { t, type Params } from "../../i18n";
import type { SendOutcome } from "../../syncActions";
import type { BadgeTone } from "../primitives";
import { bookName } from "../workspace/books";

/**
 * One or many, as two whole messages rather than an "(s)".
 *
 * `src/app/i18n.ts` is interpolation only — no plural rules yet — so the two
 * forms are written out and chosen here. Both are literals, so the extractor
 * that replaces `t` later finds both, and no language is left with the English
 * assumption that one form plus an "s" covers it.
 */
export const plural = (count: number, one: string, many: string, params: Params = {}): string =>
  t(count === 1 ? one : many, { count, ...params });

/** What the badge, the heading and the paragraph say for one state. */
export interface StateCopy {
  /** Two or three words, for the Badge. */
  readonly chip: string;
  /** The card's heading: the situation, as a sentence. */
  readonly headline: string;
  /** One paragraph: what it means, and that the work is safe. */
  readonly detail: string;
  readonly tone: BadgeTone;
}

/**
 * What the reading adds to a state's words: whether the last failure was a
 * send (the work was saved, only the sending did not happen), and whether
 * anyone is signed in (a refusal to someone signed in is not a sign-in
 * problem — it is permission).
 */
export interface StateContext {
  readonly sendRefused?: boolean | undefined;
  readonly signedIn?: boolean | undefined;
}

export const stateCopy = (state: SyncState, context: StateContext = {}): StateCopy => {
  switch (state) {
    case "checking":
      return {
        chip: t("Checking"),
        headline: t("Checking the shared project"),
        detail: t(
          "Sefer is asking the shared project what has changed. Your work is saved here, and you can keep working.",
        ),
        tone: "muted",
      };
    case "detached":
      return {
        chip: t("Not shared"),
        headline: t("This project is only on this device"),
        detail: t(
          "Your work is saved here. Choose a shared project to back it up and work with others.",
        ),
        tone: "neutral",
      };
    case "unpublished":
      return {
        chip: t("Nothing sent yet"),
        headline: t("The shared project is still empty"),
        detail: t("Nothing has been sent yet. Publishing puts your first version online."),
        tone: "brand",
      };
    case "attached-clean":
      return {
        chip: t("Up to date"),
        headline: t("Up to date with the shared project"),
        detail: t("Your project is stored safely on this device and in the shared project."),
        tone: "success",
      };
    case "ahead":
      return {
        chip: t("Changes to send"),
        headline: t("You have work the shared project does not"),
        detail: t("Send it when you are ready. Nothing in the shared project is replaced."),
        tone: "warning",
      };
    case "behind":
      return {
        chip: t("Updates to receive"),
        headline: t("There are updates to receive"),
        detail: t(
          "The shared project has versions you do not have yet. You will see exactly what changes before anything is applied.",
        ),
        tone: "warning",
      };
    case "diverged":
      return {
        chip: t("Needs review"),
        headline: t("Both sides have moved"),
        detail: t(
          "You and the shared project both recorded work. Nothing is merged automatically — your text stays exactly as it is until you choose.",
        ),
        tone: "warning",
      };
    case "conflicted":
      return {
        chip: t("Unfinished"),
        headline: t("A transfer stopped part-way"),
        detail: t(
          "Your work is still here and still saved. Finish this before sending or receiving anything else.",
        ),
        tone: "error",
      };
    case "offline":
      return {
        chip: t("Offline"),
        headline: t("You're offline"),
        detail:
          context.sendRefused === true
            ? t(
                "Saved on this device. Not sent yet: you're offline. Sefer sends it the next time you save or open this project. Your work is safe here.",
              )
            : t("Your work is still saved here. You can send it once you're back online."),
        tone: "muted",
      };
    case "unauthorized":
      // Signed in and still refused: a missing permission or an expired
      // sign-in, which both hosts report as the same reason — so the words say
      // both, and signing in again stays the one button.
      if (context.signedIn === true)
        return {
          chip: t("Can't send"),
          headline: t("This account can't send to the shared project"),
          detail: t(
            "Saved on this device. Not sent: this account may not have permission to write to the shared project, or its sign-in has expired. Your work is safe here.",
          ),
          tone: "warning",
        };
      return {
        chip: t("Sign in again"),
        headline: t("Sign in to keep sharing"),
        detail:
          context.sendRefused === true
            ? t(
                "Saved on this device. Not sent: sign in to send your changes to the shared project. Your work is safe here.",
              )
            : t("Sending and receiving updates is paused until you sign in again."),
        tone: "error",
      };
  }
};

export const actionLabel = (action: SyncActionId): string => {
  switch (action) {
    case "sign-in":
      return t("Sign in");
    case "attach":
      return t("Choose a shared project");
    case "publish":
      return t("Publish this project");
    case "pull":
      return t("Receive updates");
    case "push":
      return t("Send my changes");
    case "combine":
      return t("Combine");
    case "compare":
      return t("Compare the changes");
    case "resolve":
      return t("Finish the transfer");
    case "retry":
      return t("Check for changes");
  }
};

/**
 * The sentence under the button: what this press will do, before it does it.
 *
 * Counts come from the clocks, so the sentence is specific — "sends your 2
 * versions", not "sends your changes". A vague promise is what makes people
 * afraid to press a sync button.
 */
export const narrate = (
  action: SyncActionId,
  counts: { readonly ahead: number; readonly behind: number; readonly contested: number },
  host: string,
): string => {
  switch (action) {
    case "sign-in":
      return t("Signs you in to {host}. Nothing is sent or received until you ask for it.", {
        host,
      });
    case "attach":
      return t("Records which shared project this one belongs to. Nothing is transferred yet.");
    case "publish":
      return plural(
        counts.ahead,
        "Creates the project online and sends the {count} version on this device. Nothing here changes.",
        "Creates the project online and sends the {count} versions on this device. Nothing here changes.",
      );
    case "pull":
      return plural(
        counts.behind,
        "Applies the shared project's {count} version to this device. You see the plan first, and nothing is applied until you confirm it.",
        "Applies the shared project's {count} versions to this device. You see the plan first, and nothing is applied until you confirm it.",
      );
    case "push":
      return plural(
        counts.ahead,
        "Sends your {count} version to the shared project. Nothing on this device changes.",
        "Sends your {count} versions to the shared project. Nothing on this device changes.",
      );
    case "combine":
      // Both counts, because the whole question a person is weighing here is
      // "what happens to my N versions, and to their M". Both are kept, and
      // one new version joins them. The last clause is the promise the move
      // keeps: everything up to the send is local.
      return plural(
        counts.ahead,
        "Your {count} version and the shared project's {behind} are both kept, joined by one new version. Nothing in the shared project changes until it is sent.",
        "Your {count} versions and the shared project's {behind} are both kept, joined by one new version. Nothing in the shared project changes until it is sent.",
        { behind: counts.behind },
      );
    case "compare":
      return plural(
        counts.contested,
        "Opens the book you both changed, side by side, so you decide what to keep. Nothing changes until you do.",
        "Opens the {count} books you both changed, side by side, so you decide what to keep. Nothing changes until you do.",
      );
    case "resolve":
      return t("Finishes the transfer that stopped. Your text is untouched until you choose.");
    case "retry":
      return t("Asks the shared project what it has. Nothing is sent and nothing is applied.");
  }
};

/** "the front matter", "chapter 3" — one chapter, as a person names it. */
const chapterLabel = (chapter: number): string =>
  chapter === FRONT_MATTER ? t("the front matter") : t("chapter {number}", { number: chapter });

/** "1, 3 and 4", "the front matter and chapter 2" — a list, not a JSON array. */
export const chapterList = (chapters: readonly number[]): string => {
  const labels = chapters.map(chapterLabel);
  if (labels.length <= 1) return labels[0] ?? "";
  const last = labels[labels.length - 1] ?? "";
  return t("{first} and {last}", { first: labels.slice(0, -1).join(", "), last });
};

/**
 * The plan in one sentence — the one the gap analysis asked for by name:
 * "3 chapters of Mark changed on the cloud; 1 of them also changed here."
 *
 * Built from the totals rather than per-book, because the per-book detail is
 * right below it and a summary that repeats the list is not a summary.
 */
export const planSummary = (plan: IncomingPlan): string => {
  if (plan.chapterCount === 0) {
    return t("Nothing in your books changes; the updates are elsewhere in the project.");
  }
  // "3 chapters of Mark" reads better than "3 chapters across 1 book", and a
  // single-book plan is the common one, so it gets its own sentence.
  const where =
    plan.books.length === 1
      ? t("of {book}", { book: bookName(plan.books[0]?.bookId ?? "") })
      : plural(plan.books.length, "across {count} book", "across {count} books");
  const changed = plural(
    plan.chapterCount,
    "{count} chapter {where} changed in the shared project",
    "{count} chapters {where} changed in the shared project",
    { where },
  );
  if (plan.overlapCount === 0) {
    return t("{changed}, and none of them changed here.", { changed });
  }
  return plural(
    plan.overlapCount,
    "{changed}; {count} of them also changed here.",
    "{changed}; {count} of them also changed here.",
    { changed },
  );
};

/**
 * A book's name from the file that holds it — "41-MRK.usfm" → "Mark".
 *
 * Combine names the books it is about to join before it reads a byte of
 * them, so there is no `\id` marker to go on yet; the file name is what a
 * project has. An unrecognised stem falls through `bookName` unchanged, which
 * shows the file rather than inventing a book.
 */
export const bookFromPath = (path: string): string => {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const stem = file.replace(/\.[^.]*$/u, "");
  return bookName(stem.replace(/^\d+[-_]?/u, "").toUpperCase());
};

/**
 * Why a combine did not run, in the words of the surface.
 *
 * Core's refusals are spelled in git — "refs/remotes/origin/main does not
 * exist" — because that is the accurate way to say them there. This is the one
 * place they cross into the vocabulary a translator reads, and every sentence
 * ends by saying where the work is, because a refused transfer is exactly when
 * somebody wonders.
 */
/** Why a receive did not run, in the words the screen uses. */
export const receiveRefusal = (refusal: ReceiveRefusal, books: readonly string[] = []): string => {
  switch (refusal) {
    case "review":
      return t(
        "You and the shared project both changed {books}, so nothing was received. Compare the two versions and decide what to keep. Your work is untouched.",
        { books: books.join(", ") },
      );
    case "diverged":
      return t(
        "This device has versions the shared project does not have yet, so its updates were not received on their own. Combine them instead. Nothing has changed.",
      );
    case "no-cloud-copy":
      return t("The shared project has no copy of this work yet. Publish it first.");
    case "no-shared-version":
      return t(
        "This project and the shared project have no version in common, so there is nothing to build on. Nothing has changed.",
      );
    case "unrecorded":
      return t(
        "Some files the shared project changed have changes here that aren't kept as a version yet, so nothing was received. Save them first. Your work is untouched.",
      );
    case "moved":
      return t(
        "A book changed while the updates were arriving, so nothing was received. Try again. Your work is untouched.",
      );
    case "no-branch":
      return t("There is nothing here to receive into. Your work is exactly as you left it.");
  }
};

export const combineRefusal = (refusal: CombineRefusal): string => {
  switch (refusal) {
    case "contested":
      return t(
        "You and the shared project both changed the same book, so nothing was combined. Compare the two versions and decide what to keep. Your work is untouched.",
      );
    case "no-cloud-copy":
      return t("The shared project has no copy of this work yet. Publish it first.");
    case "no-shared-version":
      return t(
        "This project and the shared project have no version in common, so there is nothing to build on. Nothing has changed.",
      );
    case "not-diverged":
      return t(
        "Only one side has moved, so there is nothing to combine — send or receive instead. Nothing has changed.",
      );
    case "deletion":
      return t(
        "The shared project deleted a file, and a combine cannot carry a deletion yet. Nothing has changed.",
      );
    case "moved":
      return t(
        "A book changed while the two were being combined, so nothing was. Try again. Your work is untouched.",
      );
    case "no-branch":
    case "no-work-here":
      return t("There is nothing here to combine. Your work is exactly as you left it.");
  }
};

/**
 * Where the work is after a combine failed on the way through.
 *
 * `restored` is the ordinary answer and it is good news; `stranded` is the one
 * that needs a person, and it says so plainly rather than hiding behind "an
 * error occurred".
 */
export const combineTrouble = (state: CombineState): string => {
  switch (state) {
    case "untouched":
      return t("Nothing was changed on this device or in the shared project.");
    case "restored":
      return t(
        "This device was put back exactly as it was, and nothing reached the shared project. You can try again.",
      );
    case "recorded":
      return t(
        "Your work and the shared project's are combined on this device, but sending them did not finish. Nothing is lost — the next send carries it.",
      );
    case "stranded":
      return t(
        "This device is part-way through a combine and could not be put back. Your versions are all still recorded — do not edit until someone has looked at it.",
      );
  }
};

/**
 * How a send ended, as the last line of a Record: the version is kept here
 * either way, and the line says that first whenever the send did not get
 * through. `state` is where the project stands afterwards, when it is known —
 * a refused send has already been followed by a check, so "behind" and
 * "diverged" can be told apart.
 */
export const sendOutcomeCopy = (
  outcome: SendOutcome,
  state?: SyncState,
): {
  readonly tone: "success" | "warning" | "muted";
  readonly title: string;
  readonly detail: string;
} => {
  switch (outcome.kind) {
    case "sent":
      return {
        tone: "success",
        title: t("Sent to the shared project"),
        detail: t("Your team gets it the next time they check for changes."),
      };
    case "detached":
      return {
        tone: "muted",
        title: t("Kept on this device"),
        detail: t(
          "This project is not connected to a shared project, so there is nowhere to send it.",
        ),
      };
    case "held":
      return {
        tone: "muted",
        title: t("Kept on this device; not sent"),
        detail: t("This project does not send on save. Send it when you are ready."),
      };
    case "refused":
      switch (outcome.reason) {
        case "Rejected":
          return {
            tone: "warning",
            title: t("Saved here. Not sent: the shared project has changed"),
            detail:
              state === "behind" || state === "diverged"
                ? t(
                    "It has versions you have not reviewed yet. Your work is safe on this device — compare the changes, choose, and record again to send.",
                  )
                : t(
                    "The shared project would not take it as it is. Your work is safe on this device — check for changes and compare them.",
                  ),
          };
        case "Network":
        case "Unavailable":
          return {
            tone: "warning",
            title: t("Saved here. Not sent: the shared project could not be reached"),
            detail: t(
              "You may be offline. Your work is safe on this device, and Sefer sends it the next time you record a version or press Send.",
            ),
          };
        case "Unauthorized":
          return {
            tone: "warning",
            title: t("Saved here. Not sent: sign in to send"),
            detail: t(
              "Your sign-in has expired, or this account may not write to the shared project. Your work is safe on this device.",
            ),
          };
      }
  }
};
