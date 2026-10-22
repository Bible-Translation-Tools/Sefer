import type { Tour, TourContext } from "../machine";

/**
 * Line by line (form mode, first attempt): one verse per line over the same
 * text, its keys, and what it will not let you change. For the PO and the
 * designer to try and argue with, so each stop says why it is so and what
 * could change. Design builds only, like the control it uses.
 *
 * Key steps move on when the caret actually lands where the key sends it:
 * the start of the next (or previous) verse.
 */

const present = (selector: string): boolean => document.querySelector(selector) !== null;

/** The verse the caret is in, and whether it sits exactly at that verse's first letter. */
const caretVerse = (context: TourContext): { index: number; atStart: boolean } | undefined => {
  const caret = context.shell.caret();
  const book = context.shell.focused();
  if (caret === undefined || book === undefined) return undefined;
  const verses = book.structure().verses;
  let index = -1;
  for (let k = 0; k < verses.length; k++) {
    if (verses[k].markerFrom > caret) break;
    index = k;
  }
  if (index < 0) return undefined;
  return { index, atStart: verses[index].contentFrom === caret };
};

/** True once the caret moves `by` verses and lands at that verse's start; it watches from wherever the caret is first seen. */
const steppedBy = (by: number): ((context: TourContext) => boolean) => {
  let seen: number | undefined;
  return (context) => {
    const now = caretVerse(context);
    if (now === undefined) return false;
    if (seen !== undefined && now.index === seen + by && now.atStart) {
      seen = undefined;
      return true;
    }
    seen = now.index;
    return false;
  };
};

const toBook = (context: TourContext): void => {
  if (present("[data-testid=editor-host]")) return;
  const book = context.shell.focused()?.id ?? context.shell.project()?.books[0]?.id;
  if (book === undefined) return;
  void context.navigate({
    to: "/project/$slug/book/$book",
    params: { slug: context.shell.slug(), book },
  });
};

/** On the fixture, BAD chapter 2 holds the synthetic cases: verses run together, empty verses, headings, poetry. */
const FIXTURE_BOOK = "BAD";
const FIXTURE_CHAPTER = "2";

const toFixtureCases = (context: TourContext): void => {
  void context.navigate({
    to: "/project/$slug/book/$book",
    params: { slug: context.shell.slug(), book: FIXTURE_BOOK },
  });
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const book = context.shell.focused();
    const ordinal =
      book?.id === FIXTURE_BOOK
        ? book.structure().chapters.findIndex((chapter) => chapter.label === FIXTURE_CHAPTER)
        : -1;
    if (ordinal >= 0) context.shell.showChapter(ordinal);
    if (ordinal >= 0 || Date.now() - startedAt > 10_000) clearInterval(timer);
  }, 200);
};

export const lineByLineTour: Tour = {
  id: "line-by-line",
  kind: "tutorial",
  title: "Line by line",
  summary:
    "A view of your book with one verse per line, for typing in or copying from paper one verse at a time. Its keys, and what it keeps you from changing.",
  needsProject: true,
  steps: [
    {
      go: (context) => {
        if (context.shell.mode() === "usfm") context.shell.setMode("default");
        if (context.shell.services.fixtureProject === context.shell.project()?.root)
          toFixtureCases(context);
        else toBook(context);
      },
      ready: () => present("#editor-view-switch"),
      spotlight: {
        anchor: "#editor-view-switch",
        title: "Choose Line by line",
        body: "A second way to show the same book: every verse on its own line, numbered, with nothing else in the way.",
        try: "Choose Line by line. The walk-through moves on when you do.",
        notes: [
          {
            label: "What this walk-through is",
            text: "The first attempt at form mode. Each stop says what the view does, why, and what we could do instead. Tell us where it gets in your way.",
          },
          {
            label: "Same text, not a copy",
            text: "This is the editor you already use, drawn differently. What you type here is in the book the moment you type it, proofreading keeps working, and switching back loses nothing.",
          },
        ],
      },
      advance: (context) => context.shell.lineByLine() && context.shell.mode() !== "usfm",
    },
    {
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "One verse, one line",
        body: "Each verse starts a new line, however the file is laid out: one verse per line already, or several verses run together on one line. Nothing is written to the file to do it.",
        notes: [
          {
            label: "Poetry and paragraphs",
            text: "Poetry already in the file shows a faint / where each poetry line breaks, to give an idea of its shape. Paragraphs cannot show here at all: this view promises one verse, one line, and a paragraph break would split it. Both stay in the file exactly as they are.",
          },
          {
            label: "Headings",
            text: "The grey capitals are section headings (\\s1 in the file). Few of our projects have them. They show one way this view can still show what is in the file without making it the focus of editing here: you see a heading, and change it in Reading or USFM.",
          },
        ],
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "Enter: the next verse",
        body: "Pressing the Enter key on your keyboard never starts a new line here. It takes you to the start of the next verse, ready to type, which is what you want when you copy a passage verse by verse.",
        try: "Click in a verse, then press Enter.",
        notes: [
          {
            label: "Why not a new line",
            text: "A line break (what the Enter key on your keyboard makes) means nothing in USFM, and in this view a new line is a new verse. So Enter moves you instead of adding anything.",
          },
        ],
      },
      advance: steppedBy(1),
    },
    {
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "Shift+Enter: the verse before",
        body: "Shift+Enter goes back one verse, to its start.",
        try: "Press Shift+Enter.",
      },
      advance: steppedBy(-1),
    },
    {
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "Tab: the next empty verse",
        body: "Tab jumps to the next verse that has no text yet, and Shift+Tab to the one before. For filling in a chapter that is only verse numbers so far.",
        try: "Press Tab. If every verse after this one has text, nothing happens.",
        notes: [
          {
            label: "Home and End",
            text: "Home goes to the start of this verse and End to the end of it, never into the verse next door.",
          },
        ],
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "What it keeps safe",
        body: "Verse numbers, and the paragraph and poetry breaks between verses, cannot be deleted here. Backspace at the start of a verse, or Delete at its end, does nothing, so two verses never merge by accident.",
        try: "Put the caret at the start of a verse and press Backspace.",
        notes: [
          {
            label: "Changing structure",
            text: "Choose Reading or USFM to change paragraphs, poetry or headings. Headings cannot be typed into here.",
          },
          {
            label: "Paste and select",
            text: "Text you paste that has line breaks in it (copied across several lines) comes in as one line, so it can never make a verse. A selection stays inside the verse it starts in.",
          },
        ],
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "A verse number's menu",
        body: "Click a verse number. If proofreading found something wrong with it, a repeated or missing number, that comes first. Change number renumbers it, and when Sefer is sure what the number should be, the box already holds it: press Enter. Remove verse marker takes the number away; its text stays and joins the verse before. Add verse after puts a new, empty verse below it, ready to type.",
        try: "Click a verse number to open its menu. Escape closes it.",
        notes: [
          {
            label: "Splitting a verse",
            text: "Add verse after, then cut and paste the text that belongs in it. Ctrl+Shift+V (Cmd+Shift+V on a Mac) also puts a verse number at the caret, which splits the verse there.",
          },
          {
            label: "In Reading too",
            text: "The same menu opens from a verse number in Reading, so there is one way to change a number in either view. USFM shows the marker itself, to edit as text.",
          },
          {
            label: "What it does not do",
            text: "It does not renumber the verses after. Proofreading flags a number that is out of order or repeated, and Fix it from there.",
          },
        ],
      },
      advance: () => present(".usfm-verse-menu"),
    },
    {
      spotlight: {
        anchor: "#editor-view-switch",
        title: "Back to the full view",
        body: "Choose Reading to see paragraphs, poetry and headings again, or USFM to see the markers themselves. This device remembers which you used last.",
      },
      advance: "user",
    },
  ],
};
