import type { Tour, TourContext } from "../machine";

/**
 * Translation Notes, end to end: where to get them (the projects page's
 * Notes section), downloading them, opening a project, choosing them in the
 * reference column, the notes following the caret, and Find searching them.
 *
 * It needs no project to start: it begins on `/projects`, and opens a
 * translation, the Bisa Bible, through its share link with the host named
 * (`host=content.bibletranslationtools.org`), so the step works on any
 * channel and downloads the project first where it is not on the device.
 *
 * Steps that wait on the network (the notes, the project) name their own
 * `timeoutMs`: a slow line is minutes, and the machine's default is 10 s.
 * Strings are raw and translated where they are drawn.
 */

const PROJECT = "/r/Will_Kelly/leb-x-bisa_reg/book/JHN?host=content.bibletranslationtools.org";

/** On the open project's book screen, in John, with the reference column open. */
const toBook = (context: TourContext): void => {
  context.shell.setReferenceOpen(true);
  void context.navigate({
    to: "/project/$slug/book/$book",
    params: { slug: context.shell.slug(), book: "JHN" },
  });
};

const present = (selector: string): boolean => document.querySelector(selector) !== null;

/** What the notes pane says it is answering, or "" before the caret is in a verse. */
const placeShown = (): string =>
  document.querySelector("[data-testid=notes-pane]")?.getAttribute("data-place") ?? "";

/** The place the "move to another verse" step started from. */
let firstPlace = "";

/** Ten minutes: en_tn is about 8.5 MB, a little under three minutes on slow 3G. */
const DOWNLOAD_MS = 600_000;

export const notesTour: Tour = {
  id: "notes",
  kind: "tutorial",
  title: "Translation Notes",
  summary:
    "Download WA's Translation Notes, read them beside your text as you move verse to verse, and search them in Find.",
  needsProject: false,
  start: "/projects",
  steps: [
    {
      go: (context) => void context.navigate({ to: "/projects" }),
      spotlight: {
        anchor: "[data-tour=notes-section]",
        title: "Translation Notes",
        body: "Reference material lives here, on the projects page: the notes on this device, and the ones you can download. The search box filters them by language or title.",
      },
      advance: "user",
    },
    {
      ready: () => present("[data-tour=notes-download]") || present("[data-tour=notes-remove]"),
      spotlight: {
        anchor: "[data-tour=notes-download], [data-tour=notes-remove]",
        title: "Download them",
        body: "Press Download. The notes come down once for this device, newest version only, and a toast in the corner shows how far it has got. If this row already says Remove, they are here already: press Next.",
      },
      // Moves on as soon as the download has started (or was never needed).
      advance: () =>
        present("[data-tour=notes-remove]") ||
        document.querySelector("[data-tour=notes-download] [class*=animate-spin]") !== null,
    },
    {
      // Waits for the download to finish: the row turns into "on this device".
      ready: () => present("[data-tour=notes-remove]"),
      timeoutMs: DOWNLOAD_MS,
      spotlight: {
        anchor: "[data-tour=notes-remove]",
        title: "On this device",
        body: "That is all 29,000 notes files, kept as one file per book. Remove takes them off again; nothing else depends on them.",
      },
      advance: "user",
    },
    {
      go: (context) => void context.navigate({ href: PROJECT }),
      // Either the link's Download (the project is not here yet) or the
      // project opening straight away (it is).
      ready: () =>
        present("[data-tour=open-by-link-download]") || present("[data-testid=editor-host]"),
      timeoutMs: 60_000,
      spotlight: {
        anchor: "[data-tour=open-by-link-download], [data-testid=editor-host]",
        title: "Open a project",
        body: "Notes are read beside a translation. This opens a real one, the Bisa Bible, from WACS through its share link: if it is not on this device, press Download and it opens when it arrives (with its English source text).",
      },
      advance: () => present("[data-testid=editor-host]"),
    },
    {
      go: toBook,
      ready: () => present("[data-testid=reference-language]"),
      timeoutMs: DOWNLOAD_MS,
      spotlight: {
        // The whole column, with the card beside it: a card below the menu's
        // button would cover the menu it asks you to open.
        anchor: "aside[data-references]",
        side: "right",
        title: "Choose them beside the text",
        body: "Open the Reference language menu at the top of this column and choose “Translation Notes · English (en)”. It is with the texts on this device; until you download them, it is under Reference material.",
      },
      advance: () => present("[data-testid=notes-pane]"),
    },
    {
      ready: () => present("[data-testid=notes-pane]"),
      spotlight: {
        anchor: "[data-testid=editor-host]",
        title: "Put the caret in a verse",
        body: "Click anywhere in a verse of John. The notes for that verse appear beside it, each one on its own: the phrase it explains, then the note.",
      },
      advance: () => {
        firstPlace = placeShown();
        return firstPlace !== "";
      },
    },
    {
      spotlight: {
        anchor: "[data-testid=notes-pane]",
        title: "They follow you",
        body: "Now move to another verse, with the arrow keys or a click. The notes move with you; a note that covers several verses says which.",
      },
      advance: () => {
        const now = placeShown();
        return now !== "" && now !== firstPlace;
      },
    },
    {
      go: (context) =>
        void context.navigate({
          to: "/project/$slug/find",
          params: { slug: context.shell.slug() },
          search: { q: "believe", scope: "helps" },
        }),
      ready: () => present("[data-tour=find-helps]"),
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-tour=find-helps]",
        title: "Search the notes",
        body: "Find can search the notes instead of your text. Each note that matches is shown beside your verse it is about, so you read the note and edit the verse in one place.",
      },
      advance: "user",
    },
    {
      ready: () => {
        const count = document.querySelector("[data-count]")?.getAttribute("data-count");
        return count !== undefined && count !== null && count !== "0";
      },
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-count]",
        title: "Your verse, their note",
        body: "Turn the switch off and the same search runs over your own text again. That is the tour: the notes are yours to read beside any project on this device.",
      },
      advance: "user",
    },
  ],
};
