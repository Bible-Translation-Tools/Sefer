import { Effect } from "effect";

import { PRODUCERS, SEVERITIES } from "#core/findings/filter";

import { shellKeys, type FindingsFilterPreference } from "../../settings";
import type { Tour, TourContext } from "../machine";

const toFindings = (context: TourContext): void => {
  void context.navigate({
    to: "/project/$slug/findings",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

const markedFine = (): number =>
  Number(
    document.querySelector<HTMLElement>("[data-findings-hidden]")?.dataset["findingsHidden"] ?? 0,
  );
let markedAtStart = 0;

let heldFilter: FindingsFilterPreference | undefined;

const setFilter = (context: TourContext, preference: FindingsFilterPreference): void => {
  const settings = context.shell.services.settings;
  void context.shell.services.run(
    Effect.ignore(settings.set(shellKeys(settings).findingsFilter, preference)),
  );
};

const toProofreading = (context: TourContext): void => {
  markedAtStart = markedFine();
  const settings = context.shell.services.settings;
  heldFilter ??= settings.get(shellKeys(settings).findingsFilter);
  setFilter(context, { severities: SEVERITIES, producers: PRODUCERS, hideStale: false });
  const code = context.shell
    .findings()
    .find((finding) => finding.code.startsWith("sous.convention."))?.code;
  void context.navigate({
    to: "/project/$slug/findings",
    params: { slug: context.shell.slug() },
    search: code === undefined ? {} : { code },
  });
};

const toEditorFinding = (context: TourContext): void => {
  const finding = context.shell.findings().find((each) => each.code.startsWith("sous.convention."));
  if (finding === undefined) return;
  context.shell.aim(finding.bookId, finding.from, finding.to);
  void context.navigate({
    to: "/project/$slug/book/$book",
    params: { slug: context.shell.slug(), book: finding.bookId },
  });
};

const restoreFilter = (context: TourContext): void => {
  if (heldFilter !== undefined) setFilter(context, heldFilter);
  heldFilter = undefined;
};

const present = (selector: string): boolean => document.querySelector(selector) !== null;

const on = (screen: string): boolean => window.location.pathname.includes(screen);
const onFindings = (context: TourContext): void => {
  if (!on("/findings")) toProofreading(context);
};

const PROJECT =
  "/r/WA-Catalog/en_ulb/findings?at=8baaf2076f7813ac7ab5f3e7988627ec0f9d91dc&host=content.bibletranslationtools.org";

const DOWNLOAD_MS = 600_000;

let pressedMoreAt = 0;
const openMore = (): void => {
  if (present("[role=menu]")) return;
  if (Date.now() - pressedMoreAt < 800) return;
  const more = document.querySelector<HTMLElement>("[data-tour=finding-more]");
  if (more === null) return;
  pressedMoreAt = Date.now();
  more.click();
};

const toTerms = (context: TourContext): void => {
  void context.navigate({
    to: "/project/$slug/terms",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

const ACTIVE_CARD = "[data-sid]:not([data-condensed])";
const APPROVE = `${ACTIVE_CARD} [data-card-action=approve]`;
const CHANGED = `${ACTIVE_CARD} [aria-label="Text changed since last approved"]`;
const approveLabel = (): string => document.querySelector(APPROVE)?.textContent?.trim() ?? "";
let approvedAtStart = false;

export const suppressionsTour: Tour = {
  id: "suppressions",
  kind: "tutorial",
  title: "Marking findings fine, and approving key terms",
  summary:
    "Two first versions of telling Sefer something about your project to remember: a finding that is fine, a key term approved. What each does, why, and what we could do instead. For feedback.",
  needsProject: true,
  start: PROJECT,
  steps: [
    {
      go: toFindings,
      ready: () => present("[data-findings-count]"),
      timeoutMs: DOWNLOAD_MS,
      spotlight: {
        anchor: "[data-findings-count]",
        title: "Telling Sefer a finding is fine",
        body: "Sefer's proofreading looks for what is unusual in this project: a rare letter, a capital where this project usually writes lower case, the same word twice. Unusual is not always wrong. In “Potiphera priest of On”, On is a city, so its capital is right, and you will want Sefer to stop asking.",
        notes: [
          {
            label: "What this walk-through is",
            text: "The first version of answering “this is fine”. Each stop says what a control does, why we built it that way, and what we could do instead. The second half moves to key terms: another screen and another job, but the same idea of telling Sefer something about your project to remember next time.",
          },
          {
            label: "What we want from you",
            text: "Whether the words make sense to a translator, whether the choices are the right ones, and anything that surprised you.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: toProofreading,
      ready: () => present("[data-tour=fine-here]"),
      timeoutMs: 60_000,
      spotlight: {
        anchor: "[data-tour=fine-here]",
        title: "Fine here",
        body: "Fine here means: I have looked at this one, it is right, stop showing it to me. Only this one, at this place. The same thing elsewhere in the Bible still shows, because it might be a real mistake there.",
        try: "Press Fine here on this card. The walk-through moves on when you do.",
        notes: [
          {
            label: "What Sefer remembers",
            text: "Not a position, which would move with every edit. It remembers the verse, the exact characters that were flagged, and which time they appear in that verse. So you can edit other words in the verse and it stays hidden. If you change the flagged characters themselves, the finding comes back, because that is new text to judge.",
          },
          {
            label: "Why one click",
            text: "Most findings that are fine are fine for an obvious reason, and asking why every time would make this slow. A toast offers Undo for a slip.",
          },
          {
            label: "What we could do instead",
            text: "Ask for a short note saying why (useful for a reviewer later). Or answer “this check is wrong here” rather than “this text is fine”: the difference only shows when a settings change makes a different check flag the same text, and “text is fine” keeps it hidden then.",
          },
        ],
      },
      advance: () => markedFine() > markedAtStart,
    },
    {
      go: onFindings,
      ready: () => present("[data-findings-hidden]"),
      spotlight: {
        anchor: "[data-findings-hidden]",
        title: "Where hidden findings go",
        body: "This count is everything you marked fine. Nothing was deleted: a finding marked fine is only set aside, and this is where you find it again.",
        try: "Press it to see the list, then Show again on one to bring it back. Press it again to return to the findings.",
        notes: [
          {
            label: "Why here",
            text: "Next to “shown”, so the two numbers together are everything Sefer found. Nothing disappears without a trace.",
          },
          {
            label: "What we could do instead",
            text: "A separate settings page listing every suppression in the project. We chose to keep it beside the findings, where you were when you hid them.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: onFindings,
      ready: () => {
        openMore();
        return present("[role=menu]");
      },
      spotlight: {
        anchor: "[role=menu]",
        side: "right",
        title: "Behind ⋯, two bigger answers",
        body: "Fine here is about one place. These two are about many places at once, so they are tucked behind ⋯ where you will not press them by accident.",
        notes: [
          {
            label: "The ladder",
            text: "Fine here (this one), Always allow (this exact thing, everywhere in the project), Turn off (the whole kind of check). Each reaches further than the one before.",
          },
          {
            label: "Why behind a menu",
            text: "Most findings only need Fine here. Showing all three on every card would make the list busier and make the big answers easy to press by mistake.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: onFindings,
      ready: () => {
        openMore();
        return present("[data-testid=suppress-allow]");
      },
      spotlight: {
        anchor: "[data-testid=suppress-allow]",
        side: "right",
        title: "Always allow",
        body: "Some languages do on purpose what proofreading flags. Nyanja repeats words for meaning: “pang'ono pang'ono”, little by little. Pressing Fine here a hundred times would be tiresome. Always allow tells Sefer: this exact thing is normal here, never flag it in this project. Every OTHER doubled word is still checked, because those may be typos.",
        notes: [
          {
            label: "When to use it",
            text: "When you would otherwise press Fine here on the same thing over and over: a doubled word, a name always written in capitals, a mark this language puts before numbers.",
          },
          {
            label: "What “this exact thing” is",
            text: "It depends on the check: for a doubled word, that word doubled; for capitals, that word in that casing; for a mark next to something, that mark beside that kind of character.",
          },
          {
            label: "What we could do instead",
            text: "A project word list you fill in up front. We chose to learn from findings as they come, so nobody has to know the list in advance.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: onFindings,
      ready: () => {
        openMore();
        return present("[data-testid=suppress-turn-off]");
      },
      spotlight: {
        anchor: "[data-testid=suppress-turn-off]",
        side: "right",
        title: "Turn off the check",
        body: "The biggest answer, and not a suppression: nothing is saved against any finding. It is a proofreading setting, so Sefer simply stops looking for this kind of thing at all. Use it when a check does not fit the language, for example a script with no capital letters, where the capitals check only ever finds noise.",
        notes: [
          {
            label: "When to use it",
            text: "Rarely. If one check is mostly wrong for this language, turning it off is kinder than hiding its findings one by one. It can be turned back on in the proofreading settings (⚙ beside the filters).",
          },
          {
            label: "Could change",
            text: "Today the proofreading settings are the same for every project on this device, so turning a check off here turns it off everywhere. Should it be per project?",
          },
        ],
      },
      advance: "user",
    },
    {
      go: (context) => {
        if (present("[role=menu]"))
          document.querySelector<HTMLElement>("[data-tour=finding-more]")?.click();
        onFindings(context);
      },
      spotlight: {
        anchor: "[data-findings-count]",
        title: "These stay on this device, for now",
        body: "Everything you mark fine is kept on this computer only. It is not in the project's history, not in a zip you send, and not on a teammate's machine. If a colleague opens the same project, they see the findings you hid.",
        notes: [
          {
            label: "Why",
            text: "Sharing means two people changing the same list at once. Then Sefer needs a way to settle disagreements (you hid it, they did not), the way Review does for scripture. That is a bigger piece of work than this first version.",
          },
          {
            label: "What we could do instead",
            text: "Share the list with the team through the project, or export it to send. And lint findings (markers, verse numbers) get Fine here later; this first version is proofreading only.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: toEditorFinding,
      ready: () => present("[data-testid=editor-host] .usfm-lint-info"),
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-testid=editor-host]",
        title: "The same answers, in the editor",
        body: "You do not have to go to Findings to answer one. While you translate, proofreading findings are the faint dotted underlines in the text, and each has a small popup.",
        try: "Hover the dotted underline on the highlighted word to open its popup.",
        notes: [
          {
            label: "Why in both places",
            text: "Findings is for working through many at once; the editor is where you meet one while writing. The answer should not depend on where you happen to be.",
          },
        ],
      },
      advance: () => present(".cm-tooltip-lint"),
    },
    {
      go: (context) => {
        if (!on("/book/")) toEditorFinding(context);
      },
      ready: () => true,
      spotlight: {
        anchor: ".cm-tooltip-lint",
        side: "right",
        title: "Fine here, Always allow, Turn off",
        body: "The popup says what Sefer noticed, and below it the same three answers as on a Findings card. Pressing one hides the underline straight away, with the same Undo.",
        notes: [
          {
            label: "Why plain buttons here",
            text: "A popup has no room for a ⋯ menu, so all three are shown, Fine here first. On a Findings card the wider two stay behind ⋯.",
          },
          {
            label: "Could change",
            text: "Show only Fine here in the popup too, with a “More…” that opens the finding in Findings.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: restoreFilter,
      spotlight: {
        anchor: "[data-testid=editor-host]",
        title: "Now, something different: key terms",
        body: "That was proofreading: telling Sefer a finding is fine. Next is a separate job on its own screen, checking how key terms are translated. It is in this walk-through because it is the same idea underneath: you tell Sefer something about this project, and it remembers it next time.",
        notes: [
          {
            label: "What carries over",
            text: "Kept on this device. Saved against the words of the verse, so Sefer can tell when they change. Nothing is lost when it does: it is marked, and you decide.",
          },
          {
            label: "What is different",
            text: "Marking a finding fine hides something. Approving a key term records that you checked it, and it stays visible with a mark.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: (context) => {
        toTerms(context);
        approvedAtStart = false;
      },
      timeoutMs: DOWNLOAD_MS,
      ready: () => {
        if (!present(APPROVE)) return false;
        approvedAtStart = approveLabel().startsWith("Approved");
        return true;
      },
      spotlight: {
        anchor: APPROVE,
        title: "Approving a key term",
        body: "Key terms are words like “grace” or “Abba” that a translation should render carefully and consistently. Approve says: in this verse, the term is translated the way it should be. Like marking a finding fine, it is telling Sefer something about your project to remember next time.",
        try: "Press Approve. (If it already says Approved, press Next.)",
        notes: [
          {
            label: "What Sefer remembers",
            text: "The term, the verse, and a fingerprint of the verse's text as you approved it. Like what you mark fine, it is kept on this device.",
          },
        ],
      },
      advance: () => {
        const approved = approveLabel().startsWith("Approved");
        if (!approved) approvedAtStart = false;
        return approved && !approvedAtStart;
      },
    },
    {
      go: (context) => {
        if (!on("/terms")) toTerms(context);
      },
      ready: () => approveLabel().startsWith("Approved"),
      spotlight: {
        anchor: ACTIVE_CARD,
        title: "Now change the verse",
        body: "An approval is about the words you saw. If they change later, the approval should say so rather than quietly stand.",
        try: "Double-click the verse and type anything. Then press Save changes on the card.",
        notes: [
          {
            label: "What happens",
            text: "The card's state becomes “Text changed since last approved”. It does not matter how the text changed: here, in the editor, in Review, or from a teammate's work arriving.",
          },
        ],
      },
      advance: () => present(CHANGED),
    },
    {
      go: (context) => {
        if (!on("/terms")) toTerms(context);
      },
      ready: () => approveLabel().startsWith("Text changed"),
      timeoutMs: 600_000,
      spotlight: {
        anchor: APPROVE,
        title: "Text changed since last approved",
        body: "The approval is kept, but marked: the verse no longer says what was approved, so someone should look again.",
        try: "Press it to approve the text as it is now. It becomes “Approved with edits”: the verse was changed after its card was opened, then approved.",
        notes: [
          {
            label: "Why it works this way",
            text: "Sefer does not watch for edits. It compares the fingerprint with the text each time the card is drawn. So if the old words are put back, the approval is plain Approved again, with nothing to undo.",
          },
          {
            label: "Open question",
            text: "Should every verse whose text changed since it was approved be gathered somewhere on this screen, as a count or a filter, rather than found card by card?",
          },
        ],
      },
      advance: () => approveLabel().startsWith("Approved with edits"),
    },
    {
      go: (context) => {
        if (!on("/terms")) toTerms(context);
      },
      spotlight: {
        anchor: APPROVE,
        title: "That is the whole cycle",
        body: "Approve; the text changes; Sefer marks it; you approve again. Pressing the button once more takes an approval back.",
        notes: [
          {
            label: "Could change",
            text: "Approvals could be shared with the team, with the same caveat as hidden findings: two people approving and changing the same verse need a way to settle it.",
          },
        ],
      },
      advance: "user",
    },
  ],
};
