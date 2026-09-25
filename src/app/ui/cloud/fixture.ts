/**
 * `?syncState=behind` — every state of the sync screen, on demand, in a dev
 * build, with no Gitea instance and no network.
 *
 * This is a FIXTURE, not a second implementation. It writes out a
 * `SyncReading` and an `IncomingPlan` — the same two values `./reading.ts`
 * produces from the real services — and hands them to the same pure
 * derivation and the same components. There is no branch anywhere in the rendering that asks whether
 * the data came from here, and the application's composition is untouched:
 * `src/app/services.ts` does not know this file exists.
 *
 * Nothing below is bundled into a production build. `CloudScreen` reaches for
 * it only inside an `import.meta.env.DEV` branch, the same arrangement
 * `/dev/fixture` uses (documentation/architecture/shell.md).
 */

import type { Commit } from "#core/git/git";
import {
  combineMessage,
  emptyPlan,
  type CombineReplay,
  type IncomingPlan,
  type SyncReading,
  type SyncState,
} from "#core/sync";

import type { SyncFacts } from "./reading";

/**
 * The clock the fixture's versions hang off: when the module loaded.
 *
 * Relative rather than absolute so the clock lines read the way they will in
 * real use — "25 minutes ago", not "eight months ago". A screenshot taken
 * twice therefore differs by the minute, which is the right trade: the point
 * of the fixture is to show what a translator would see.
 */
const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const commit = (id: string, message: string, name: string, agoMs: number): Commit => ({
  id,
  message,
  author: { name, email: `${name.toLowerCase().replace(/\s+/gu, ".")}@example.org` },
  at: NOW - agoMs,
});

const mine = [
  commit("a1b2c3d4", "Mark 4 — reworked the parable headings", "Ana Ruiz", 25 * MINUTE),
  commit("b2c3d4e5", "Mark 3 — verse 14 wording", "Ana Ruiz", 3 * HOUR),
];

const theirs = [commit("c3d4e5f6", "Mark 1–2 — reviewer's corrections", "Tomás Beye", 40 * MINUTE)];

/**
 * What arrives: Mark 1 and Luke 1, as the plan names them. `contested` is the
 * same pull after this device also touched Mark 1.
 *
 * LITERAL plans rather than `incomingPlan` over three revisions of a toy
 * book, because the plan's chapters come from the engine and a module-level
 * constant has no engine to ask — the Galley is a Layer, built at boot, and
 * this file must not reach for it. What a fixture owes the screen is the
 * VALUE, not the arithmetic: these are what `incomingPlan` answered for the
 * two-line Mark and Luke revisions that used to sit here.
 */
const planFor = (contested: boolean): IncomingPlan => ({
  commits: theirs,
  books: [
    {
      bookId: "LUK",
      path: "42-LUK.usfm",
      kind: "modified",
      chapters: [1],
      alsoHere: [],
      contested: false,
    },
    {
      bookId: "MRK",
      path: "41-MRK.usfm",
      kind: "modified",
      chapters: [1],
      alsoHere: contested ? [1] : [],
      contested,
    },
  ],
  contested: contested ? ["MRK"] : [],
  chapterCount: 2,
  overlapCount: contested ? 1 : 0,
  clean: !contested,
});

const attached: SyncReading = {
  origin: "https://content.example.org/ana/mark-project.git",
  branch: "main",
  signedIn: true,
  online: true,
  fetchedAt: NOW - 2 * MINUTE,
  remoteKnown: true,
  localHead: mine[0],
  remoteHead: theirs[0],
  ahead: [],
  behind: [],
  uncommitted: 0,
  mergeInProgress: false,
  lastFailure: undefined,
};

/**
 * The fixtures' names: every state, plus one extra.
 *
 * `diverged` and `diverged-apart` are the same STATE and two different
 * screens, which is the whole point of routing on the plan as well as the
 * state: when the two sides touched the same book the primary action is
 * Compare, and when they touched different ones it is Combine. A fixture list
 * that only had "diverged" would never show the second.
 */
export type FixtureName = SyncState | "diverged-apart";

/** Every state the screen can be in, as the facts that produce it. */
const FIXTURES: Readonly<Record<FixtureName, SyncFacts>> = {
  detached: {
    reading: {
      ...attached,
      origin: undefined,
      remoteKnown: false,
      remoteHead: undefined,
      fetchedAt: undefined,
    },
    plan: emptyPlan,
  },
  unpublished: {
    reading: { ...attached, remoteKnown: false, remoteHead: undefined, ahead: mine },
    plan: emptyPlan,
  },
  "attached-clean": { reading: attached, plan: emptyPlan },
  ahead: { reading: { ...attached, ahead: mine }, plan: emptyPlan },
  behind: { reading: { ...attached, behind: theirs }, plan: planFor(false) },
  diverged: { reading: { ...attached, ahead: mine, behind: theirs }, plan: planFor(true) },
  // Both sides moved, but on different books: the safe combine is available.
  "diverged-apart": {
    reading: { ...attached, ahead: mine, behind: theirs },
    plan: planFor(false),
  },
  conflicted: {
    reading: { ...attached, ahead: mine, behind: theirs, mergeInProgress: true, uncommitted: 2 },
    plan: planFor(true),
  },
  offline: { reading: { ...attached, online: false, ahead: mine }, plan: emptyPlan },
  unauthorized: {
    reading: { ...attached, signedIn: false, lastFailure: "Unauthorized", ahead: mine },
    plan: emptyPlan,
  },
};

// SAFETY: FIXTURES is typed `Record<FixtureName, SyncFacts>`, so its keys are
// exactly the members of `FixtureName` — the assertion recovers what
// `Object.keys` widens to `string[]`, and a missing state is a type error at
// the literal above rather than a wrong list here.
const NAMES = Object.keys(FIXTURES) as readonly FixtureName[];

/** `?syncState=diverged`, honoured only in a dev build. */
export const fixtureStateRequested = (): FixtureName | undefined => {
  if (!import.meta.env.DEV || typeof location !== "object") return undefined;
  const asked = new URLSearchParams(location.search).get("syncState");
  return NAMES.find((name) => name === asked);
};

export const fixtureFacts = (state: FixtureName): SyncFacts => FIXTURES[state];

/**
 * What a combine would replay, for the states that offer one.
 *
 * The real answer comes from `previewCombine`, which reads the repository; a
 * fixture has none, and the confirmation dialog has to be reachable without
 * one for the same reason every other card is. These are the books THIS device
 * changed — different from the incoming plan's, which are the shared
 * project's, and that difference is the whole point of the screen.
 */
export const fixtureReplay = (state: FixtureName): CombineReplay | undefined =>
  state === "diverged-apart"
    ? {
        branch: "main",
        from: "a1b2c3d4",
        onto: "c3d4e5f6",
        paths: ["40-MAT.usfm", "41-MRK.usfm"],
        message: combineMessage(2),
      }
    : undefined;

/** The whole list, for the dev switcher the screen shows beside the fixture. */
export const fixtureStates = NAMES;
