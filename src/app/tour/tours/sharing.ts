import type { Tour, TourContext } from "../machine";

/**
 * Where your work lives, in two parts, for the PO and the testers: the
 * charter's online, offline, WACS and save requirements walked on a real
 * shared project, each stop saying why it is built the way it is. Part one is
 * one person on one device; part two is a second person (a private window, a
 * second browser, or the WACS web editor) changing the same project, and what
 * the first person sees arrive. Both start from a share link, so a tester
 * with nothing on their device downloads the same project everyone else has.
 *
 * Design builds only (`audience: "internal"`). The project is Will's sandbox
 * on WACS; a tester who cannot write to it meets the own-copy-and-suggestions
 * path, which is half of what part two is about.
 */

const OWNER = "will-kelly-test";
const REPO = "x-en-ulb";
const HOST = "content.bibletranslationtools.org";
const SHARED_PAGE = `https://${HOST}/${OWNER}/${REPO}`;
const linkTo = (rest: string): string => `/r/${OWNER}/${REPO}${rest}?host=${HOST}`;

const PART_ONE = "where-work-lives";
const PART_TWO = "someone-else";

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

const focusedUnsaved = (context: TourContext, bookId?: string): boolean => {
  const book = context.shell.focused();
  if (book === undefined || (bookId !== undefined && book.id !== bookId)) return false;
  return context.shell.unsaved(book);
};

const toBook = (context: TourContext, book: string): void => {
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

/** True once a Save's receipt has been shown and then closed, so the receipt is read before the tour moves on. */
const savedAndClosed = (): (() => boolean) => {
  let seen = false;
  return () => {
    if (present("[data-review-record-done]")) seen = true;
    else if (seen) {
      seen = false;
      return true;
    }
    return false;
  };
};

const copyText = (text: string): void => {
  void navigator.clipboard.writeText(text).catch(() => window.prompt("Copy this link", text));
};

export const whereWorkLivesTour: Tour = {
  id: PART_ONE,
  kind: "tutorial",
  audience: "internal",
  title: "Where your work lives (1 of 2): one person",
  summary:
    "A shared WACS project from a link: what is on this device, what is backed up, what Save does, what is sent, and what offline looks like.",
  needsProject: true,
  start: linkTo("/book/JHN"),
  steps: [
    {
      go: (context) => toBook(context, "JHN"),
      panel: {
        title: "You opened a link, and now you have a copy",
        body: "The link named a shared project on WACS (will-kelly-test/x-en-ulb), not a file. Sefer downloaded it into its own storage on this device, so everything from here on works with the network off. On the web that storage is the browser's; in the desktop app it is a folder on the disk. Either way nothing points back at where it came from: getting work out is sending it, or exporting a zip.",
      },
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar-import]",
        title: "Every other way in",
        body: "Import brings a project in from WACS, a zip, a folder, or BTT Writer. Every one ends as the same kind of copy on this device.",
        try: "Open Import to see the choices. A choice this device cannot use is shown greyed out with the reason, never hidden.",
        notes: [
          {
            label: "Why a zip and a folder",
            text: "Because the network is not always there. At a workshop a colleague can hand over a project on a USB stick, as a zip or a plain folder, and it opens the same way a WACS download does.",
          },
          {
            label: "Writer",
            text: "BTT Writer projects convert on this device, with no network, and every Writer save comes across as a version in History.",
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
        body: "The cloud button reads the project and the shared project and shows one state: up to date, saved but not sent, updates waiting, offline, or signed out. Inside it there is one main action, the one that state needs.",
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
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-account]",
        title: "Sign in to WACS",
        body: "Signed out, you can read and change everything here; only sending and receiving wait. Sign in with your WACS account.",
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
    },
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-popover]",
        title: "Can you change it, or suggest changes?",
        body: "If your account may write to this project, your work is sent straight to it. If not, as with most people on this sandbox, the popover says you can suggest changes, and offers Work in my own copy.",
        notes: [
          {
            label: "Your own copy",
            text: "Work in my own copy makes a copy of the project under your WACS account (a fork). Your saves are sent there, and when you are ready, Offer my changes asks the project's editors to bring them in (a suggestion, which WACS calls a pull request). Later sends add to the same suggestion.",
          },
          {
            label: "Why both",
            text: "Operations decides who may write to a project. A team can be given write access to one, for example a project started from a Tech_advance repository, and then everyone works in it directly. Anyone else can still contribute, through their own copy, without Operations doing anything first.",
          },
          {
            label: "Part two",
            text: "Part two shows the other side: what arrives when someone else sends to the same project.",
          },
        ],
      },
      advance: "user",
    },
    {
      go: (context) => {
        closePopover();
        toBook(context, "JHN");
      },
      ready: () => present("[data-testid=editor-host]"),
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "Change a verse",
        body: "Type anywhere in John. Half a second after you stop, Sefer backs the change up on this device, outside the project. The project file itself is not touched yet.",
        try: "Change a word in a verse.",
        notes: [
          {
            label: "Backup is not saving",
            text: "The backup is there so a crash, a closed tab or a flat battery loses nothing: open the project again and Sefer offers the work back. It is not a version, and nobody else sees it.",
          },
          {
            label: "Why the file waits",
            text: "Because a slip of the keyboard should never become the project's text without anyone seeing it. The file only changes when you Save, and Save shows you every change first.",
          },
          { label: "Charter", text: "REQ-10, REQ-11, REQ-21." },
        ],
      },
      advance: (context) => focusedUnsaved(context, "JHN"),
    },
    {
      go: (context) => toBook(context, "RUT"),
      ready: () => onPath("/book/RUT") && present("[data-testid=editor-host]"),
      spotlight: {
        anchor: "[data-testid=editor-host]",
        side: "right",
        title: "And one in another book",
        body: "Now Ruth. Changes can sit in as many books as you like before you save; the next step shows them all together.",
        try: "Change a word in Ruth.",
      },
      advance: (context) => focusedUnsaved(context, "RUT"),
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar]",
        title: "Save, with a look first",
        body: "Press Ctrl+S (Cmd+S on a Mac). Save never writes straight away: it opens Review, showing every change you are about to keep.",
        try: "Press Ctrl+S or Cmd+S.",
        notes: [
          {
            label: "Why the wording is careful",
            text: "Most saves are of everyday work, so it would be easy to make Save instant. But then a stray key in a verse you were not looking at would be kept and sent. The menu says “Save & Review…” for that reason. A person who wants the instant kind can turn on “Skip review of my changes” in Settings.",
          },
          { label: "Charter", text: "REQ-07, SC-05." },
        ],
      },
      advance: () => onPath("/review") || onPath("/history"),
    },
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
            label: "Cards or the whole chapter",
            text: "Cards suit changes spread over many books: you read each one in its verse, with a Chapter button for more context. A handful of changes in one book can be easier to read as the whole book. Both views are the same changes.",
          },
          {
            label: "Nothing is hidden",
            text: "Every change to the Scripture text is shown here, however small, including spaces and markers. That is the rule: no change reaches the file, or anyone else, without passing through a screen like this.",
          },
          {
            label: "No replace-all",
            text: "For the same reason there is no one-step replace across the project that you do not see verse by verse.",
          },
        ],
      },
      advance: "user",
    },
    {
      ready: () => present("[data-review-record]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-review-record]",
        title: "Save keeps a version",
        body: "Save writes the books and keeps that moment as a version, with your name and a line about what you changed. If you are signed in, it then sends it to WACS.",
        try: "Press Save, fill in the two lines, and Save. Read the receipt, then press Done.",
        notes: [
          {
            label: "Saved here, sent there",
            text: "The receipt says both things separately: saved on this device, and sent (or not yet, and why). Signed out or offline, the save still happens and only the sending waits.",
          },
          { label: "Charter", text: "REQ-20, REQ-21, REQ-22." },
        ],
      },
      advance: savedAndClosed(),
    },
    {
      go: toHistory,
      ready: () => present("[data-commits]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-testid=sidebar]",
        side: "right",
        title: "History: every version, and where it is",
        body: "Every version of the project, newest first, with who made it and when. The ones under “Only on this device” have not reached WACS yet; the ones under “On the shared project” are what everyone has.",
        try: "Choose a version to see what it changed, verse by verse, the same way Review shows it.",
        notes: [
          {
            label: "Why History is in the product",
            text: "So a team can answer “who changed this verse, and when” without going to WACS, and so nothing done in Sefer is ever beyond getting back: Adopt, on any change, brings that earlier wording back as a new change, to be reviewed and saved like any other.",
          },
          {
            label: "The line between the two",
            text: "That divider is the answer to “has my work been uploaded?”, version by version.",
          },
        ],
      },
      advance: "user",
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar-sync]",
        title: "Now go offline",
        body: "Turn off Wi-Fi (or unplug), then open the cloud button. It says you are offline, that your saved work waits here, and that it is safe.",
        try: "Turn the network off. This step moves on when Sefer notices.",
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
        body: "Turn the network back on. Open the cloud button: the waiting work goes with Send my changes, or with your next save.",
        try: "Turn the network on and send what is waiting.",
      },
      advance: () => syncState() !== "offline" && syncState() !== "ahead" && signedIn(),
    },
    {
      panel: {
        title: "Next: someone else",
        body: "Part two is about a second person changing this same project. You play both people: this window, and a private window or another browser. Start it from Settings, Tutorials, “Where your work lives (2 of 2)”.",
      },
    },
  ],
};

export const someoneElseTour: Tour = {
  id: PART_TWO,
  kind: "tutorial",
  audience: "internal",
  title: "Where your work lives (2 of 2): someone else",
  summary:
    "A second person changes the same project, from a private window, another browser or WACS itself. What arrives, how it is reviewed, and how a suggestion works.",
  needsProject: true,
  start: linkTo("/book/JHN"),
  steps: [
    {
      go: (context) => toBook(context, "JHN"),
      panel: {
        title: "Be someone else",
        body: "You need a second person. Pick one: (1) a private window, or another browser such as Firefox, which Sefer sees as a different device: open part one's link there, sign in (a second WACS account is best), change John 3 and save. (2) Or open the project on WACS and edit a file in its web editor, if your account may write to it. Then come back to this window.",
        actions: [
          {
            label: () => "Copy part one's link",
            run: () => copyText(`${window.location.origin}${linkTo("/book/JHN")}&tour=${PART_ONE}`),
          },
          {
            label: () => "Open the project on WACS",
            run: () => window.open(SHARED_PAGE, "_blank", "noopener"),
          },
        ],
      },
    },
    {
      spotlight: {
        anchor: "[data-testid=app-bar-sync]",
        title: "Check for changes",
        body: "Sefer checks on its own when the project opens, but not while you work. Open the cloud button and press the check button.",
        try: "Open the cloud button and check. This step moves on when the other person's change shows up.",
        notes: [
          {
            label: "Why not constantly",
            text: "Checking is a network request, and many teams pay for every one. It happens when you open the project, when you save, and when you ask.",
          },
        ],
      },
      advance: () => syncState() === "behind" || syncState() === "diverged",
    },
    {
      go: openPopover,
      ready: popoverOpen,
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-sync-popover]",
        title: "What is coming, before it comes",
        body: "Incoming changes lists the books, and how many verses in each differ, before anything on this device changes.",
        try: "Press See the changes.",
        notes: [
          {
            label: "Never merged on its own",
            text: "Sefer never mixes two people's wording automatically, and never brings someone else's Scripture changes in unseen. Incoming work goes through the same Review as your own saves.",
          },
          { label: "Charter", text: "REQ-09, REQ-20, REQ-22." },
        ],
      },
      advance: () => onPath("/review"),
    },
    {
      ready: () => present("[data-review-units]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-review-units]",
        title: "Theirs and yours, verse by verse",
        body: "Each card says where its change came from: changed there (by the other person), changed here (by you), or changed in both places. The first two already have a side chosen, theirs and yours; changed in both places has none, and you choose.",
        try: "Read their change. Press Keep or Take on any card to change its side.",
        notes: [
          {
            label: "The one that asks something",
            text: "Only “changed in both places” is coloured, because it is the only kind that needs a person. Change the same verse in both windows to see one.",
          },
          {
            label: "The same screen as Save",
            text: "Your own changes, someone else's, a suggestion and an old version are all read on this one screen, so there is one thing to learn.",
          },
        ],
      },
      advance: "user",
    },
    {
      ready: () => present("[data-review-record]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-review-record]",
        title: "Save settles it",
        body: "Save takes their changes you kept into the project, records the result as one version, and sends it. Until every “changed in both places” has a choice, Save waits.",
        try: "Press Save, then Save, then Done.",
      },
      advance: savedAndClosed(),
    },
    {
      go: toHistory,
      ready: () => present("[data-commits]"),
      timeoutMs: PATIENT,
      spotlight: {
        anchor: "[data-testid=sidebar]",
        side: "right",
        title: "Their version, in your History",
        body: "The other person's version is now in History, under their name, and the one you just saved sits on top of it. Choose either to read what it changed, verse by verse.",
        notes: [
          {
            label: "Who a version is by",
            text: "The WACS username when they were signed in, or the name they gave the first time they saved on that device.",
          },
        ],
      },
      advance: "user",
    },
    {
      panel: {
        title: "When the other person cannot write",
        body: "Most people on this sandbox cannot write to it, so in their window the popover offered Work in my own copy. Their saves went to their copy, and Offer my changes made a suggestion. The project's editors see “1 suggestion is waiting” in the cloud button and open it from the Suggestions tab, beside Changes and History, in the same Review: it shows only what the suggestion offers, with who sent it and why. Keep what is right and Save, which brings it into the shared project and closes it; keeping none of it is Decline, with a note the author reads. You will not see the editor's side unless you can write to a project; Will can show it on this one.",
      },
    },
    {
      panel: {
        title: "What to try next",
        body: "Change the same verse in both windows and save in both: that is the case that goes to Compare. Or go offline in one window, keep working, and come back. Tell us where the words did not match what you expected.",
      },
    },
  ],
};
