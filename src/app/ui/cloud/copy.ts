import type {
  CombineRefusal,
  CombineState,
  IncomingPlan,
  ReceiveRefusal,
  SyncState,
} from "#core/sync";
import { FRONT_MATTER } from "#core/sync";

import { t, type Params } from "../../i18n";
import type { SendOutcome } from "../../syncActions";
import type { BadgeTone } from "../primitives";

export const plural = (count: number, one: string, many: string, params: Params = {}): string =>
  t(count === 1 ? one : many, { count, ...params });

export interface StateCopy {
  readonly chip: string;
  readonly headline: string;
  readonly detail: string;
  readonly tone: BadgeTone;
}

export interface StateContext {
  readonly sendRefused?: boolean | undefined;
  readonly signedIn?: boolean | undefined;
  readonly inCopy?: boolean;
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
      if (context.inCopy === true)
        return {
          chip: t("Up to date"),
          headline: t("Your copy has all your work"),
          detail: t("Offer your changes to the shared project when they are ready."),
          tone: "success",
        };
      return {
        chip: t("Up to date"),
        headline: t("Up to date with the shared project"),
        detail: t("Your project is stored safely on this device and in the shared project."),
        tone: "success",
      };
    case "ahead":
      if (context.inCopy === true)
        return {
          chip: t("Changes to send"),
          headline: t("You have work your copy does not"),
          detail: t("Send it to your copy when you are ready."),
          tone: "warning",
        };
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

const chapterLabel = (chapter: number): string =>
  chapter === FRONT_MATTER ? t("the front matter") : t("chapter {number}", { number: chapter });

export const chapterList = (chapters: readonly number[]): string => {
  const labels = chapters.map(chapterLabel);
  if (labels.length <= 1) return labels[0] ?? "";
  const last = labels[labels.length - 1] ?? "";
  return t("{first} and {last}", { first: labels.slice(0, -1).join(", "), last });
};

export const planSummary = (plan: IncomingPlan): string => {
  if (plan.books.length === 0)
    return t("Nothing in your books changes; the updates are elsewhere in the project.");
  const books = plural(plan.books.length, "{count} book", "{count} books");
  if (plan.verseCount === 0) return t("There are changes in {books}.", { books });
  const verses = plural(plan.verseCount, "{count} verse", "{count} verses");
  return t("There are changes to {verses} in {books}.", { verses, books });
};

export const incomingWords = (plan: IncomingPlan): string | undefined => {
  if (plan.books.length === 0) return undefined;
  const books = plural(plan.books.length, "{count} book", "{count} books");
  if (plan.verseCount === 0) return t("{books} to receive", { books });
  const verses = plural(plan.verseCount, "{count} verse", "{count} verses");
  return t("{verses} in {books} to receive", { verses, books });
};

export const outgoingWords = (): string => t("Saved changes not sent yet");

export const planOverlap = (
  plan: IncomingPlan,
): { readonly text: string; readonly mine: boolean } | undefined => {
  if (plan.verseCount === 0) return undefined;
  if (plan.verseOverlap === 0)
    return { text: t("You have not changed any of those verses."), mine: false };
  return {
    text: plural(
      plan.verseOverlap,
      "You also changed {count} of those verses.",
      "You also changed {count} of those verses.",
    ),
    mine: true,
  };
};

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
      return outcome.toCopy === true
        ? {
            tone: "success",
            title: t("Sent to your copy"),
            detail: t("Offer your changes from the cloud menu when they are ready."),
          }
        : {
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
          if (outcome.toCopy === true)
            return {
              tone: "warning",
              title: t("Saved here. Not sent: your copy has changes this device does not"),
              detail: t(
                "They came from another device, or from changes you offered before. Compare with your copy and choose what to keep; then it sends as usual. Nothing is lost on either side.",
              ),
            };
          if (outcome.description !== undefined)
            return {
              tone: "warning",
              title: t("Saved here. Not sent to your copy"),
              detail: t("Your work is safe on this device. What went wrong: {description}", {
                description: outcome.description,
              }),
            };
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

export const offerRefusalCopy = (needed: {
  readonly copy: boolean;
}): { readonly title: string; readonly message: string } =>
  needed.copy
    ? {
        title: t("Your copy has changes this device does not"),
        message: t(
          "Compare with your copy and choose what to keep; then offer again. Nothing is lost on either side.",
        ),
      }
    : {
        title: t("The shared project has changes this device does not"),
        message: t(
          "Compare the changes and choose what to keep; then offer again. Nothing is lost on either side.",
        ),
      };
