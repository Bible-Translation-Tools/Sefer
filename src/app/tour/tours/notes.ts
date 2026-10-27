import type { Tour, TourContext } from "../machine";

/**
 * Translation Notes, end to end: opening a project, choosing (and, the first
 * time, downloading) them in the right half of the reference column's split
 * dropdown, the notes following the caret, and Find searching them. The
 * projects page lists no notes (Will, 2026-10-15).
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

/** The open project, or the one named in the address while it is still opening (a step's own link). */
const slugOf = (context: TourContext): string =>
  context.shell.slug() || (/^\/project\/([^/]+)/u.exec(window.location.pathname)?.[1] ?? "");

const toBook = (context: TourContext): void => {
  context.shell.setReferenceSplit(true);
  const slug = slugOf(context);
  // Next pressed before the project arrived: there is no project to go to yet.
  if (slug === "") return;
  void context.navigate({ to: "/project/$slug/book/$book", params: { slug, book: "JHN" } });
};

const present = (selector: string): boolean => document.querySelector(selector) !== null;

const placeShown = (): string =>
  document.querySelector("[data-testid=notes-pane]")?.getAttribute("data-place") ?? "";

/**
 * Where the notes stood when the caret step was first on screen: they open
 * already showing a place, which is not the person putting the caret anywhere.
 */
let openedAt: string | undefined;
let firstPlace = "";

/** Ten minutes: en_tn is about 8.5 MB, a little under three minutes on slow 3G. */
const DOWNLOAD_MS = 600_000;

export const notesTour: Tour = {
  id: "notes",
  kind: "tutorial",
  audience: "internal",
  title: "Translation Notes",
  summary:
    "Download WA's Translation Notes, read them beside your text as you move verse to verse, and search them in Find.",
  needsProject: false,
  start: "/projects",
  steps: [
    {
      go: (context) => void context.navigate({ href: PROJECT }),
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
      ready: () => present("[data-testid=gateway-picker]"),
      timeoutMs: DOWNLOAD_MS,
      spotlight: {
        anchor: "[data-testid=gateway-picker]",
        side: "right",
        title: "Choose them beside the text",
        body: "The control at the top of this column has two halves: the language on the left, and what to read in it on the right. With English on the left, open the right half and choose Translation Notes. The first time, they download once for this device (a spinner shows on the row), and they open here when they arrive.",
      },
      advance: () => present("[data-testid=notes-pane]"),
    },
    {
      go: () => {
        openedAt = undefined;
      },
      ready: () => present("[data-testid=notes-pane]"),
      timeoutMs: DOWNLOAD_MS,
      spotlight: {
        anchor: "[data-testid=editor-host]",
        title: "Put the caret in a verse",
        body: "Click anywhere in a verse of John. The notes for that verse appear beside it, each one on its own: the phrase it explains, then the note.",
      },
      advance: () => {
        if (openedAt === undefined) {
          openedAt = placeShown();
          return false;
        }
        firstPlace = placeShown();
        return firstPlace !== "" && firstPlace !== openedAt;
      },
    },
    {
      ready: () => present("[data-testid=notes-pane]"),
      timeoutMs: DOWNLOAD_MS,
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
          params: { slug: slugOf(context) },
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
