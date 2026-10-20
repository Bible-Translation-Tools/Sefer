import type { Tour, TourContext } from "../machine";

/**
 * Telling Sefer a finding is fine, and approving a key term: how the first
 * version works and why, for the product owner and the designer to give
 * feedback on, rather than for a translator. The plan it walks:
 * `planning/items/2026-10-06-project-state-and-suppressions.mdx`.
 *
 * It starts from a share link to WA's English ULB, pinned to one commit, so
 * everyone who runs it reads the same text and the same findings: the link
 * downloads the project where it is not on the device yet (a few seconds to
 * a minute), and opens it where it is.
 *
 * Strings are raw and translated where they are drawn.
 */

const toFindings = (context: TourContext): void => {
  void context.navigate({
    to: "/project/$slug/findings",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

/**
 * Findings narrowed to one proofreading check, so the cards on screen have
 * Fine here and More whatever the reader's own filters say: a convention
 * finding is the kind that offers all three answers.
 */
/** How many are marked fine: step 2 moves on when this goes up, not merely when it is shown. */
const markedFine = (): number =>
  Number(
    document.querySelector<HTMLElement>("[data-findings-hidden]")?.dataset["findingsHidden"] ?? 0,
  );
let markedAtStart = 0;

const toProofreading = (context: TourContext): void => {
  markedAtStart = markedFine();
  const code = context.shell
    .findings()
    .find((finding) => finding.code.startsWith("sous.convention."))?.code;
  void context.navigate({
    to: "/project/$slug/findings",
    params: { slug: context.shell.slug() },
    search: code === undefined ? {} : { code },
  });
};

const toTerms = (context: TourContext): void => {
  void context.navigate({
    to: "/project/$slug/terms",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

const present = (selector: string): boolean => document.querySelector(selector) !== null;

/** WA's English ULB as of 2025-10-02: public, and it does not move under the tutorial. */
const PROJECT =
  "/r/WA-Catalog/en_ulb/findings?at=8baaf2076f7813ac7ab5f3e7988627ec0f9d91dc&host=content.bibletranslationtools.org";

/** Long enough for a first download on a slow line. */
const DOWNLOAD_MS = 600_000;

export const suppressionsTour: Tour = {
  id: "suppressions",
  kind: "tutorial",
  title: "Marking findings fine, and approving key terms",
  summary:
    "The first version of suppressions and approvals: what each answer does, why the wider ones are tucked away, and what does not travel yet. For feedback.",
  needsProject: true,
  start: PROJECT,
  steps: [
    {
      go: toFindings,
      ready: () => present("[data-findings-count]"),
      timeoutMs: DOWNLOAD_MS,
      spotlight: {
        anchor: "[data-findings-count]",
        title: "Saying a finding is fine",
        body: "Proofreading flags what is unusual for this project, and unusual is sometimes right. This walk-through shows the first version of answering “this is fine”, so you can tell us what reads well and what does not.",
      },
      advance: "user",
    },
    {
      go: toProofreading,
      ready: () => present("[data-tour=fine-here]"),
      timeoutMs: 20_000,
      spotlight: {
        anchor: "[data-tour=fine-here]",
        title: "Fine here",
        body: "Press Fine here on a proofreading finding. It hides that one finding at that place, and the toast offers Undo. It is saved against the text itself, not a position: edit elsewhere in the verse and it stays hidden; change the flagged text and the finding comes back, since that is new text to judge. We could add a note saying why it is fine here; we have left that out for now.",
      },
      advance: () => markedFine() > markedAtStart,
    },
    {
      ready: () => present("[data-findings-hidden]"),
      spotlight: {
        anchor: "[data-findings-hidden]",
        title: "What you marked fine",
        body: "The count of what you hid. Press it to list them; Show again on any one brings it back. Nothing is deleted: a finding you marked fine is only set aside.",
      },
      advance: "user",
    },
    {
      ready: () => present("[data-tour=finding-more]"),
      spotlight: {
        anchor: "[data-tour=finding-more]",
        title: "Two wider answers, behind More",
        body: "Always allow “…” never flags that exact thing in this project, a word doubled on purpose say, while still checking every other doubled word. Turn off stops a whole check, in every project, from the proofreading settings. They are behind More because they reach further than the one finding in front of you, and Fine here is the answer most findings want.",
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-findings-count]",
        title: "These stay on this device, for now",
        body: "What you mark fine is kept on this device only: not in the project's history, not in a zip, not on a teammate's machine. It could be exported or shared later, but two people writing the same list would need their own way to settle disagreements, the way Review does for scripture, so that is a later decision. Lint findings (markers, numbering) get Fine here later too; this first version is proofreading.",
      },
      advance: "user",
    },
    {
      go: toTerms,
      ready: () => present("[data-tour=terms-cards]"),
      spotlight: {
        anchor: "[data-tour=terms-cards]",
        title: "Key-term approvals are kept too",
        body: "Approving a key term in a verse is now saved the same way, on this device. Open a term and Approve a verse. If the verse is edited afterwards, anywhere, its card shows Changed since approved and offers Approve again; put the text back and the approval stands again. Approved with edits means the verse was changed in its card before you approved it.",
      },
      advance: "user",
    },
  ],
};
