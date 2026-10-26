import { Effect, Option } from "effect";

import { Git } from "#core/git/git";
import { sourceOf } from "#core/project/shareLink";
import { COPY_REMOTE, Remote } from "#core/remote/remote";

import type { Step, Tour, TourContext } from "../machine";

/**
 * Where your work lives, as two of you: the charter's online, offline, WACS
 * and save requirements walked on a real project, each stop saying why it is
 * built the way it is. The tester plays both people, in two browsers on the
 * same account (two browsers keep separate storage, so Sefer sees two
 * devices), and the cards hand over between them by hand.
 *
 *   A  downloads Will's sandbox, which the tester may not write to, and
 *      makes their own copy (a fork) of it.
 *   B  downloads that copy. The tester owns it, so B works straight in it:
 *      the "may write" mode, the way a team on a Tech_advance repository does.
 *   A  edits, saves (to the copy), reads History.
 *   B  receives A's version, changes a verse of its own, saves.
 *   A  receives B's, offers both as a suggestion, and opens the pull request
 *      it made on WACS.
 *
 * Design builds only (`audience: "internal"`). The editor's side of a
 * suggestion needs write access to Will's sandbox, so it is described, not
 * walked.
 */

const OWNER = "will-kelly-test";
const REPO = "x-en-ulb";
const HOST = "content.bibletranslationtools.org";
const SHARED_PAGE = `https://${HOST}/${OWNER}/${REPO}`;

const WINDOW_A = "two-of-you-a";
const WINDOW_B = "two-of-you-b";

/** Long enough for a person to read, open a popover, or wait on the network. */
const PATIENT = 600_000;

const present = (selector: string): boolean => document.querySelector(selector) !== null;
const onPath = (part: string): boolean => window.location.pathname.includes(part);

const syncState = (): string | undefined =>
  document.querySelector("[data-testid=app-bar-sync]")?.getAttribute("data-sync-state") ??
  undefined;
const popoverOpen = (): boolean => present("[data-sync-popover]");
/** Pressing Next is a click outside the popover, which closes it; a step inside it opens it again. */
const openPopover = (): void => {
  setTimeout(() => {
    if (!popoverOpen()) document.querySelector<HTMLElement>("[data-testid=app-bar-sync]")?.click();
  }, 150);
};
const closePopover = (): void => {
  if (popoverOpen()) document.querySelector<HTMLElement>("[data-testid=app-bar-sync]")?.click();
};
const signedIn = (): boolean => {
  const state = syncState();
  return state !== undefined && state !== "unknown" && state !== "unauthorized";
};

const focusedUnsaved = (context: TourContext, bookId: string): boolean => {
  const book = context.shell.focused();
  return book !== undefined && book.id === bookId && context.shell.unsaved(book);
};

const toBook = (context: TourContext, book: string): void => {
  closePopover();
  if (onPath(`/book/${book}`)) return;
  void context.navigate({
    to: "/project/$slug/book/$book",
    params: { slug: context.shell.slug(), book },
  });
};

const toHistory = (context: TourContext): void => {
  if (onPath("/history")) return;
  void context.navigate({
    to: "/project/$slug/history",
    params: { slug: context.shell.slug() },
    search: {},
  });
};

const toSuggestions = (context: TourContext): void => {
  closePopover();
  if (onPath("/suggestions")) return;
  void context.navigate({
    to: "/project/$slug/suggestions",
    params: { slug: context.shell.slug() },
  });
};

/** The number of the suggestion still waiting, from the Suggestions screen's own list. */
const waitingSuggestion = (): string | undefined =>
  document
    .querySelector("[data-suggestion][data-state=waiting]")
    ?.getAttribute("data-suggestion") ?? undefined;

const copyText = (text: string): void => {
  void navigator.clipboard.writeText(text).catch(() => window.prompt("Copy this link", text));
};

/** Window A's own copy on WACS, once it has one: where window B downloads from. */
const copyOwner = { value: "" };
const copyRepo = { value: "" };
const learnCopy = (context: TourContext): void => {
  const project = context.shell.project();
  if (project === undefined) return;
  void context.shell.services
    .run(
      Effect.orElseSucceed(
        Effect.gen(function* () {
          const git = yield* Git;
          const remote = yield* Remote;
          return Option.getOrUndefined(
            yield* remote.urlOf(yield* git.open(project.root), COPY_REMOTE),
          );
        }),
        () => undefined,
      ),
    )
    .then((url) => {
      const source = url === undefined ? undefined : sourceOf(url);
      copyOwner.value = source?.owner ?? "";
      copyRepo.value = source?.repo ?? "";
    });
};
const copyKnown = (): boolean => copyOwner.value !== "";
const windowBLink = (): string =>
  `${window.location.origin}/r/${copyOwner.value}/${copyRepo.value}/book/JHN?host=${HOST}&tour=${WINDOW_B}`;
const copyPage = (): string => `https://${HOST}/${copyOwner.value}/${copyRepo.value}`;

const handOver = (to: "A" | "B", body: string): Step => ({
  go: closePopover,
  panel: { title: `Over to window ${to}`, body },
});

// Stops both windows make, worded once.

const signIn = (body: string): Step => ({
  go: openPopover,
  ready: popoverOpen,
  timeoutMs: PATIENT,
  spotlight: {
    anchor: "[data-sync-account]",
    title: "Sign in to WACS",
    body,
    try: "Sign in with your WACS username and password.",
    notes: [
      {
        label: "What signing in is for",
        text: "Sending your saved work to WACS, receiving other people's, and putting your name on your versions. Nothing about editing needs it.",
      },
      {
        label: "Every worried state ends the same way",
        text: "Signed out, offline, or refused, the words always end by saying the work is safe on this device. That is a translator's first worry, so it is answered first.",
      },
      { label: "Charter", text: "REQ-19, SC-06." },
    ],
  },
  advance: signedIn,
});

const editIn = (book: string, title: string, body: string): Step => ({
  go: (context) => toBook(context, book),
  ready: () => onPath(`/book/${book}`) && present("[data-testid=editor-host]"),
  spotlight: {
    anchor: "[data-testid=editor-host]",
    side: "right",
    title,
    body,
    try: "Change a word in a verse.",
  },
  advance: (context) => focusedUnsaved(context, book),
});

const saveKey: Step = {
  spotlight: {
    anchor: "[data-testid=app-bar]",
    title: "Save, with a look first",
    body: "Press Ctrl+S (Cmd+S on a Mac). Save never writes straight away: it opens Review, showing every change you are about to keep.",
    try: "Press Ctrl+S or Cmd+S.",
    notes: [
      {
        label: "Why the wording is careful",
        text: "Most saves are of everyday work, so it would be easy to make Save instant. But then a stray key in a verse you were not looking at would be kept and sent. The menu says “Save & Review…” for that reason.",
      },
      {
        label: "A decision for Operations",
        text: "Settings has “Skip review of my changes”, which makes Save instant. Design worries the look first is friction, and it may be for someone saving only to their own copy. On a project a team shares, an unseen change goes to everyone. Operations can choose to keep the switch, or to remove it so every save is seen first.",
      },
      { label: "Charter", text: "REQ-07, SC-05." },
    ],
  },
  advance: () => onPath("/review") || onPath("/history"),
};

const saveButton = (title: string, body: string): Step => ({
  ready: () => present("[data-review-record]"),
  timeoutMs: PATIENT,
  spotlight: {
    anchor: "[data-review-record]",
    title,
    body,
    try: "Press Save, fill in the two lines, and Save. Read the receipt, then press Done.",
    notes: [
      {
        label: "Saved here, sent there",
        text: "The receipt says both things separately: saved on this device, and sent (or not yet, and why). Signed out or offline, the save still happens and only the sending waits.",
      },
      { label: "Charter", text: "REQ-20, REQ-21, REQ-22." },
    ],
  },
  advance: () => present("[data-review-record-done]"),
});

const incomingReview = (who: string): Step => ({
  ready: () => present("[data-review-units]"),
  timeoutMs: PATIENT,
  spotlight: {
    anchor: "[data-review-units]",
    title: `${who}'s change, verse by verse`,
    body: "Each card says where its change came from: changed there (in the other window), changed here (in this one), or changed in both places. The first two already have a side chosen, theirs and yours; changed in both places has none, and you choose.",
    try: "Read the change. Keep or Take on any card changes its side.",
    notes: [
      {
        label: "Never merged on its own",
        text: "Sefer never mixes two people's wording automatically, and never brings someone else's Scripture changes in unseen. Incoming work goes through the same Review as your own saves.",
      },
      {
        label: "The one that asks something",
        text: "Only “changed in both places” is coloured, because it is the only kind that needs a person. Change the same verse in both windows to see one.",
      },
      { label: "Charter", text: "REQ-09, REQ-20, REQ-22." },
    ],
  },
  advance: "user",
});

const history = (title: string, body: string): Step => ({
  go: toHistory,
  ready: () => present("[data-commits]"),
  timeoutMs: PATIENT,
  spotlight: {
    anchor: "[data-testid=sidebar]",
    side: "right",
    title,
    body,
    try: "Choose a version to see what it changed, verse by verse, the same way Review shows it.",
    notes: [
      {
        label: "Why History is in the product",
        text: "So a team can answer “who changed this verse, and when” without going to WACS, and so nothing done in Sefer is ever beyond getting back: Adopt, on any change, brings that earlier wording back as a new change, to be reviewed and saved like any other.",
      },
      {
        label: "Who a version is by",
        text: "The WACS username when signed in, or the name given the first time someone saved on that device.",
      },
    ],
  },
  advance: "user",
});

export const windowATour: Tour = {
  id: WINDOW_A,
  kind: "tutorial",
  audience: "internal",
  title: "Two of you (window A): your own copy, and a suggestion",
  summary:
    "Start here. Two browsers, both you: a project you may not change, your own copy of it, a second device working in that copy, and the suggestion it all ends in on WACS.",
  needsProject: true,
  start: `/r/${OWNER}/${REPO}/book/JHN?host=${HOST}`,
  steps: [
    {
      go: (context) => toBook(context, "JHN"),
      panel: {
        title: "Two of you, in two browsers",
        body: "You will play two people: window A (this browser) and window B (a second browser, say Firefox, with the same WACS account). Two browsers keep separate storage, so Sefer sees two devices. The cards say when to switch. This window has just downloaded Will's sandbox (will-kelly-test/x-en-ulb) into this browser's storage, so it works with the network off from here on.",
      },
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar]",
        title: "Every other way in",
        body: "The projects page brings a project in from WACS, a zip, a folder, or BTT Writer. Every one ends as the same kind of copy on this device.",
        try: "Later, on the projects page: drop a zip or folder on it, choose one, or paste a repository link into the WACS search. A choice this device cannot use is shown greyed out with the reason, never hidden.",
        notes: [
          {
            label: "Why a zip and a folder",
            text: "Because the network is not always there. At a workshop a colleague can hand over a project on a USB stick, as a zip or a plain folder, and it opens the same way a WACS download does.",
          },
          {
            label: "Already here",
            text: "Downloading a project this device already has opens the one here instead of making a second copy of the same work.",
          },
          { label: "Charter", text: "REQ-13 to REQ-18; SC-02, SC-03." },
        ],
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar-sync]",
        title: "One button says where your work is",
        body: "The cloud button reads this project and the one on WACS and shows one state: up to date, saved but not sent, updates waiting, offline, or signed out. Inside it there is one main action, the one that state needs.",
        try: "Open the cloud button.",
        notes: [
          {
            label: "Why one action, not Push and Pull",
            text: "A row of Send, Receive, Check and Publish with three greyed out asks a translator to work out which one applies. Sefer works it out and offers that one.",
          },
          {
            label: "Verses, not versions",
            text: "It counts what differs in verses and books (“3 verses in 2 books”), never in versions. Versions are how the computer keeps track; verses are what a translator has to read.",
          },
          { label: "Charter", text: "REQ-12, REQ-22." },
        ],
      },
      advance: popoverOpen,
    },
    signIn(
      "Signed out, you can read and change everything here; only sending and receiving wait. Sign in with your WACS account.",
    ),
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-collab]",
        title: "Work in your own copy",
        body: "Your account may not write to Will's sandbox, so the popover says you can suggest changes. Work in my own copy makes a copy of it under your WACS account (a fork). From now on your saves are sent there, and nothing reaches Will's until you offer it.",
        try: "Press Work in my own copy.",
        notes: [
          {
            label: "Why copies exist",
            text: "Operations decides who may write to a project. A team can be given write access to one, for example a project started from a Tech_advance repository, and then everyone works in it directly. Anyone else can still contribute, through their own copy, without Operations doing anything first.",
          },
          {
            label: "Not by default",
            text: "Nothing is copied until you ask. And a second device asking again gets the same copy, never a second one.",
          },
        ],
      },
      advance: () => present("[data-sync-collab=copy]"),
    },
    {
      go: (context) => {
        closePopover();
        learnCopy(context);
      },
      panel: {
        title: "Open window B",
        body: "Your copy is on WACS now. Copy window B's link, open it in your second browser, and follow the cards there until they send you back here. Window B downloads your copy, not Will's.",
        actions: [
          {
            label: () => (copyKnown() ? "Copy window B's link" : undefined),
            run: () => copyText(windowBLink()),
          },
          {
            label: () => (copyKnown() ? "Open your copy on WACS" : undefined),
            run: () => window.open(copyPage(), "_blank", "noopener"),
          },
        ],
      },
    },
    editIn(
      "JHN",
      "Change a verse",
      "Back in window A. Type anywhere in John. Half a second after you stop, Sefer backs the change up on this device, outside the project. The project file itself is not touched yet.",
    ),
    editIn(
      "RUT",
      "And one in another book",
      "Now Ruth. Changes can sit in as many books as you like before you save; the next step shows them all together.",
    ),
    saveKey,
    {
      ready: () => present("[data-review-units]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-review-units]",
        title: "Every change, verse by verse",
        body: "Each change is a card named by its book, chapter and verse, with the file's text on one side and yours on the other, across every book. Changes and Whole book switch between the cards and the whole book with its changes drawn in place.",
        try: "Look at your two changes. Take the file's undoes one; Keep the editor's keeps it.",
        notes: [
          {
            label: "Backup is not saving",
            text: "Until now your changes were only backed up, so a crash or a closed tab loses nothing; the file waits because a slip of the keyboard should never become the project's text unseen.",
          },
          {
            label: "Nothing is hidden",
            text: "Every change to the Scripture text is shown here, however small, including spaces and markers. For the same reason there is no one-step replace across the project that you do not see verse by verse.",
          },
          { label: "Charter", text: "REQ-10, REQ-11, REQ-21." },
        ],
      },
      advance: "user",
    },
    saveButton(
      "Save keeps a version",
      "Save writes the books, keeps that moment as a version with your name and a line about it, and sends it to your copy on WACS.",
    ),
    history(
      "History: every version, and where it is",
      "Every version, newest first, with who made it and when. “Only on this device” have not reached WACS; the rest have. That divider is the answer to “has my work been uploaded?”.",
    ),
    handOver(
      "B",
      "In window B, press Next. It will receive what you just saved, change a verse of its own, and send you back here.",
    ),
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-popover]",
        title: "Your copy has changed",
        body: "Window B sent a version to your copy. The popover says your copy has changes this device does not, from another device. Nothing here has changed yet.",
        try: "Press See the changes. If it is not there yet, press the check button.",
      },
      advance: () => onPath("/review"),
    },
    incomingReview("Window B"),
    saveButton(
      "Save brings it in",
      "Save takes the changes you kept into this project and records them as a version, so both windows now hold the same text.",
    ),
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-collab]",
        title: "Offer your changes",
        body: "Your work, from both windows, is in your copy on WACS. Offer my changes asks Will's project's editors to bring it in: a suggestion, which WACS calls a pull request.",
        try: "Press Offer my changes.",
        notes: [
          {
            label: "One suggestion, kept up to date",
            text: "Save again later and the new versions are added to the same suggestion, until an editor brings it in or closes it. The popover says which it is.",
          },
        ],
      },
      advance: () => present("[data-sync-suggestion=waiting]"),
    },
    {
      go: toSuggestions,
      ready: () => present("[data-screen=suggestions]"),
      timeoutMs: PATIENT,
      panel: {
        title: "Your suggestion, on WACS",
        body: "Suggestions lists what you have offered and what became of it. It is a real pull request on WACS, from your copy to Will's sandbox, so the team can see and discuss it there too.",
        actions: [
          {
            label: () => (waitingSuggestion() === undefined ? undefined : "Open it on WACS"),
            run: () => {
              const number = waitingSuggestion();
              if (number !== undefined)
                window.open(`${SHARED_PAGE}/pulls/${number}`, "_blank", "noopener");
            },
          },
        ],
      },
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar-sync]",
        title: "Now go offline",
        body: "Turn off Wi-Fi (or unplug), then open the cloud button. It says you are offline, that your saved work waits here, and that it is safe.",
        try: "Turn the network off. This card says so when Sefer notices.",
        notes: [
          {
            label: "The calmest state",
            text: "Offline is normal for many teams, so it is drawn as the least alarming state there is. You keep editing, backing up and saving; what is waiting to be sent is still counted, and goes the next time you save or open the project online.",
          },
          {
            label: "How Sefer knows",
            text: "Two ways together: the computer saying it has no network, and a send or check that failed on the way out. The first is instant but can be fooled by hotel Wi-Fi; the second is slower but cannot.",
          },
          { label: "Charter", text: "REQ-10, REQ-12." },
        ],
      },
      advance: () => syncState() === "offline",
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar-sync]",
        title: "And back on",
        body: "Turn the network back on. What waited goes with Send my changes, or with your next save.",
      },
      advance: () => syncState() !== "offline" && signedIn(),
    },
    {
      panel: {
        title: "The editor's side",
        body: "Will's project's editors see “1 suggestion is waiting” in their cloud button and open it from the Suggestions tab, in the same Review: only what the suggestion offers, with who sent it and why. Keep what is right and Save, which brings it into the project and closes it; keeping none of it is Decline, with a note you read. That side needs write access to the project, so Will shows it.",
      },
    },
  ],
};

export const windowBTour: Tour = {
  id: WINDOW_B,
  kind: "tutorial",
  audience: "internal",
  title: "Two of you (window B): working straight in your copy",
  summary: "The second browser in “Two of you”. Start it from window A's link, not from here.",
  needsProject: true,
  steps: [
    {
      go: (context) => toBook(context, "JHN"),
      panel: {
        title: "This is window B",
        body: "This browser downloaded your own copy, the one window A just made. Sefer sees it as a second device of yours.",
      },
    },
    signIn("Sign in with the same WACS account as window A."),
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-popover]",
        title: "Here, you may write",
        body: "This project is yours, so there is nothing to suggest: this window sends straight to it. That is how a team works when Operations gives it write access to a project, for example one started from a Tech_advance repository.",
        notes: [
          {
            label: "Two ways to work, one tutorial",
            text: "Window A works in your copy and suggests to Will's project; this window works straight in your copy. The same project can be either, depending on who may write to it.",
          },
        ],
      },
      advance: "user",
    },
    handOver(
      "A",
      "In window A, press Next. Come back here when it says “Over to window B”, and press Next.",
    ),
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-popover]",
        title: "Check for changes",
        body: "Window A saved and sent a version. Sefer checks when a project opens and when you save, not constantly, so ask it now.",
        try: "Press the check button, then See the changes.",
        notes: [
          {
            label: "Why not constantly",
            text: "Checking is a network request, and many teams pay for every one. It happens when you open the project, when you save, and when you ask.",
          },
        ],
      },
      advance: () => onPath("/review"),
    },
    incomingReview("Window A"),
    saveButton(
      "Save brings it in",
      "Save takes window A's changes into this project and records them as a version.",
    ),
    history(
      "Window A's version, in History",
      "Window A's version is here now, under your name, with the one you just saved on top of it.",
    ),
    editIn(
      "JHN",
      "Now a change of your own",
      "Change a different verse in John from the one window A changed. (The same verse would be “changed in both places”: try that another time.)",
    ),
    saveKey,
    saveButton(
      "Save and send",
      "This window may write to your copy, so Save sends straight to it.",
    ),
    handOver("A", "Window B is done. In window A, press Next."),
  ],
};
