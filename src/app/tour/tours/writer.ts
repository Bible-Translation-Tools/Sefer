import type { Tour, TourContext } from "../machine";

/**
 * From BTT Writer to one project: the projects page's Writer repos, the
 * Migrate screen choosing between rival copies of a book, Assemble, the
 * Writer saves kept as History, Add a book, and the project still following
 * the Writer projects it came from.
 *
 * One browser, no sign-in: the Writer list and the clones are public. It
 * suggests bwc, which has books with more than one copy, so there is
 * a choice to make; any language works, and a step about a choice says what
 * to do when there is none.
 *
 * Steps that wait on the network or on assembly name their own `timeoutMs`.
 * Strings are raw and translated where they are drawn.
 */

const present = (selector: string): boolean => document.querySelector(selector) !== null;
const onPath = (part: string): boolean => window.location.pathname.includes(part);

/** Listing a language's books, opening each, and replaying their saves: minutes on a slow line. */
const PATIENT = 600_000;

/** The open project, or the one named in the address while it is still opening (a step's own link). */
const slugOf = (context: TourContext): string =>
  context.shell.slug() || (/^\/project\/([^/]+)/u.exec(window.location.pathname)?.[1] ?? "");

const toProjectPage = (context: TourContext, page: "history" | "settings"): void => {
  if (onPath(`/${page}`)) return;
  void context.navigate({
    to: page === "history" ? "/project/$slug/history" : "/project/$slug/settings",
    params: { slug: slugOf(context) },
    search: {},
  });
};

export const writerTour: Tour = {
  id: "writer",
  kind: "tutorial",
  audience: "internal",
  title: "From BTT Writer to one project",
  summary:
    "Gather a language's single-book Writer projects into one Bible, choosing between rival copies of a book, with every Writer save kept as history.",
  needsProject: false,
  start: "/projects",
  steps: [
    {
      go: (context) => {
        if (!onPath("/projects")) void context.navigate({ to: "/projects" });
      },
      ready: () => present("[data-tour=wacs-repos]"),
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-tour=wacs-repos]",
        title: "Two kinds of project on WACS",
        body: "Consolidated projects are already one Bible per language. BTT Writer made one project per book instead, often several copies of the same book by different people. Writer repos lists the languages that have them.",
        try: "Choose Writer repos.",
        notes: [
          {
            label: "Why gather them",
            text: "Until now someone assembled the consolidated repository by hand, outside any app, and the history of who wrote what was thrown away. Sefer does the same assembly and keeps it.",
          },
          {
            label: "Not a Writer mode",
            text: "Writer is a shape Sefer reads on the way in. Once assembled, the project is an ordinary one, like any other on this device.",
          },
        ],
      },
      advance: () => present("[data-writer-language]"),
    },
    {
      // The toolbar, not the language rows: the list takes seconds to arrive
      // from WACS, and none come at all if Writer repos was not chosen.
      ready: () => present("[data-tour=wacs-repos]"),
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-tour=wacs-repos]",
        title: "Find a language",
        body: "With Writer repos chosen, search by code or by name; a name matches from the start of any word in it. The list takes a few seconds to arrive from WACS. Choosing a language opens Migrate from Writer with its books.",
        try: "Type bwc and choose it.",
        notes: [
          {
            label: "Offline too",
            text: "Migrate also takes a folder or a zip of Writer projects, so a project handed over on a USB stick at a workshop arrives the same way, with no network.",
          },
        ],
      },
      advance: () => onPath("/migrate"),
    },
    {
      // Next pressed before a language was chosen: open the suggested one.
      go: (context) => {
        if (!onPath("/migrate"))
          void context.navigate({ to: "/migrate", search: { language: "bwc" } });
      },
      ready: () => present("[data-tour=migrate-books]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-tour=migrate-books]",
        side: "right",
        title: "Every book, checked before you choose",
        body: "Each book is listed under its testament with what it waits on: checking while its copy is opened and read, the owner's name when there is one copy, “choose” with a count when there are several, and refused (with the reason) when a copy is not the book it claims to be.",
        try: "Wait for the checking marks to settle.",
        notes: [
          {
            label: "Settled up front",
            text: "Choices are made here, before the editor, so a project never opens with two Johns. A Bible holds each book once, and everything else is checked against that.",
          },
          {
            label: "Inactive copies hidden",
            text: "Copies marked Inactive on WACS are left out unless you ask for them with “Show inactive”.",
          },
        ],
      },
      advance: "user",
    },
    {
      ready: () => present("[data-tour=migrate-book-pane]"),
      spotlight: {
        anchor: "[data-tour=migrate-book-pane]",
        title: "Choosing between copies",
        body: "Each copy of the selected book is a row: who made it, its status on WACS, when it was last changed, its chapter and verse count (red when it has errors or differs from the source text), and how many passages differ from the copy picked now.",
        try: "Choose a book marked “choose”, then press Compare on one of its rows to read the two side by side.",
        notes: [
          {
            label: "Facts first, text when needed",
            text: "The counts are there so most choices need no reading. Compare opens the same verse-by-verse reader Review uses, for the cases that do.",
          },
          {
            label: "No choice here?",
            text: "If every book has one copy, there is nothing to choose: press Next.",
          },
        ],
      },
      advance: "user",
    },
    {
      ready: () => present("[data-testid=migrate-next]"),
      spotlight: {
        anchor: "[data-testid=migrate-recommended], [data-testid=migrate-next]",
        title: "Or let Sefer choose",
        body: "“Use the recommended one” settles every remaining choice at once: the Primary copy (the one chosen for Bible in Every Language), else the newest Active one, never an Inactive one.",
        try: "Press Use the recommended one, if it is there.",
      },
      advance: () => !present("[data-testid=migrate-recommended]"),
    },
    {
      ready: () => present("[data-testid=migrate-next]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-testid=migrate-next]",
        title: "Assemble",
        body: "Assemble writes one project from the chosen books, named and described the way WA's consolidated repositories are, then opens it. There is no form to fill in first; anything to correct is edited in the project afterwards.",
        try: "Press Assemble. While it runs it reads “Writing N books' history…”.",
        notes: [
          {
            label: "It never arrives without its past",
            text: "If the history cannot be written, the assembly stops and leaves nothing behind, rather than giving you a project that has lost who wrote what.",
          },
        ],
      },
      advance: () => onPath("/project/"),
    },
    {
      go: (context) => toProjectPage(context, "history"),
      ready: () =>
        Number(document.querySelector("[data-commits]")?.getAttribute("data-commits")) > 0,
      timeoutMs: 60_000,
      spotlight: {
        anchor: "[data-testid=sidebar]",
        side: "right",
        title: "Every Writer save, kept",
        body: "Each Writer save that changed a book is a version here, under the name and date of the person who saved it, all the books interleaved by time. The assembly itself is the newest version, crediting everyone.",
        try: "Choose a version to see what it changed, verse by verse.",
        notes: [
          {
            label: "Said in verses",
            text: "Writer's own messages are only timestamps, so each version says which verses it changed instead (“TIT 1:6–7”).",
          },
        ],
      },
      advance: "user",
    },
    {
      go: (context) => {
        if (onPath("/book/")) return;
        void context.navigate({ to: "/project/$slug", params: { slug: slugOf(context) } });
      },
      ready: () => present("[data-testid=add-book]"),
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-testid=add-book]",
        side: "right",
        title: "A book that comes later",
        body: "When someone finishes another book in Writer, Add a book… opens the same Migrate screen for this project: only its language, only books it does not have yet. They arrive with their saves, as one version.",
      },
      advance: "user",
    },
    {
      go: (context) => toProjectPage(context, "settings"),
      ready: () => present("[data-cloud-card=writer]"),
      timeoutMs: 30_000,
      spotlight: {
        anchor: "[data-cloud-card=writer]",
        title: "Still following Writer",
        body: "The books keep following the Writer projects they came from. Every check for changes asks them for new work too, and anything new comes through Review as “From Writer”, only the verses changed since, for a person to accept.",
        try: "When the team has moved to Sefer, Stop following ends it. That is the tour.",
        notes: [
          {
            label: "Why follow at all",
            text: "A migration rarely happens on one day. Some translators keep working in Writer for a while, and their work should reach the project without anyone copying it across by hand.",
          },
        ],
      },
      advance: "user",
    },
  ],
};
