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

import type { IncomingPlan, SyncActionId, SyncState } from "../../../core/sync";
import { FRONT_MATTER } from "../../../core/sync";
import { t } from "../../i18n";
import type { BadgeTone } from "../primitives";

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

export const stateCopy = (state: SyncState): StateCopy => {
  switch (state) {
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
        detail: t("Your work is still saved here. You can send it once you're back online."),
        tone: "muted",
      };
    case "unauthorized":
      return {
        chip: t("Sign in again"),
        headline: t("Sign in to keep sharing"),
        detail: t("Sending and receiving updates is paused until you sign in again."),
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
      return t(
        "Creates the project online and sends the {ahead} version(s) on this device. Nothing here changes.",
        { ahead: counts.ahead },
      );
    case "pull":
      return t(
        "Applies the shared project's {behind} version(s) to this device. You see the plan first, and nothing is applied until you confirm it.",
        { behind: counts.behind },
      );
    case "push":
      return t(
        "Sends your {ahead} version(s) to the shared project. Nothing on this device changes.",
        { ahead: counts.ahead },
      );
    case "combine":
      return t(
        "Puts the shared project's {behind} version(s) underneath, then keeps your work as one version on top. No scripture text is merged.",
        { behind: counts.behind },
      );
    case "compare":
      return t(
        "Opens the {contested} book(s) you both changed, side by side, so you decide what to keep. Nothing changes until you do.",
        { contested: counts.contested },
      );
    case "resolve":
      return t("Finishes the transfer that stopped. Your text is untouched until you choose.");
    case "retry":
      return t("Asks the shared project what it has. Nothing is sent and nothing is applied.");
  }
};

/** "the front matter", "chapter 3" — one chapter, as a person names it. */
export const chapterLabel = (chapter: number): string =>
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
  const books = plan.books.length;
  if (plan.overlapCount === 0) {
    return t(
      "{chapters} chapter(s) across {books} book(s) changed in the shared project, and none of them changed here.",
      { chapters: plan.chapterCount, books },
    );
  }
  return t(
    "{chapters} chapter(s) across {books} book(s) changed in the shared project; {overlap} of them also changed here.",
    { chapters: plan.chapterCount, books, overlap: plan.overlapCount },
  );
};
