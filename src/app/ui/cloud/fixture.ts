/**
 * `?syncState=behind` — every state of the sync screen, on demand, in a dev
 * build, with no Gitea instance and no network.
 *
 * This is a FIXTURE, not a second implementation. It builds a `SyncReading`
 * and an `IncomingPlan` — the same two values `./reading.ts` produces from the
 * real services — and hands them to the same pure derivation and the same
 * components. There is no branch anywhere in the rendering that asks whether
 * the data came from here, and the application's composition is untouched:
 * `src/app/services.ts` does not know this file exists.
 *
 * Nothing below is bundled into a production build. `CloudScreen` reaches for
 * it only inside an `import.meta.env.DEV` branch, the same arrangement
 * `/dev/fixture` uses (documentation/architecture/shell.md).
 */

import type { Commit } from "../../../core/git/git";
import { emptyPlan, incomingPlan, type SyncReading, type SyncState } from "../../../core/sync";
import type { SyncFacts } from "./reading";

/** A fixed clock, so two screenshots of the same state look the same. */
const NOW = Date.UTC(2026, 8, 14, 9, 0, 0);
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

/** A tiny two-chapter book, as three revisions of one file. */
const MARK_BASE = "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The beginning.\n\\c 2\n\\v 1 And again.\n";
const MARK_CLOUD =
  "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The beginning of it.\n\\c 2\n\\v 1 And again.\n";
const MARK_HERE = MARK_BASE;
const MARK_HERE_TOUCHED =
  "\\id MRK\n\\h Mark\n\\c 1\n\\v 1 The very beginning.\n\\c 2\n\\v 1 And again.\n";
const LUKE_BASE = "\\id LUK\n\\h Luke\n\\c 1\n\\v 1 Many have undertaken.\n";
const LUKE_CLOUD = "\\id LUK\n\\h Luke\n\\c 1\n\\v 1 Many people have undertaken.\n";

const planFor = (contested: boolean) =>
  incomingPlan(theirs, [
    {
      path: "41-MRK.usfm",
      bookId: "MRK",
      kind: "modified",
      base: MARK_BASE,
      cloud: MARK_CLOUD,
      here: contested ? MARK_HERE_TOUCHED : MARK_HERE,
    },
    {
      path: "42-LUK.usfm",
      bookId: "LUK",
      kind: "modified",
      base: LUKE_BASE,
      cloud: LUKE_CLOUD,
      here: LUKE_BASE,
    },
  ]);

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

/** Every state the screen can be in, as the facts that produce it. */
const FIXTURES: Readonly<Record<SyncState, SyncFacts>> = {
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

// SAFETY: FIXTURES is typed `Record<SyncState, SyncFacts>`, so its keys are
// exactly the members of `SyncState` — the assertion recovers what
// `Object.keys` widens to `string[]`, and a missing state is a type error at
// the literal above rather than a wrong list here.
const NAMES = Object.keys(FIXTURES) as readonly SyncState[];

/** `?syncState=diverged`, honoured only in a dev build. */
export const fixtureStateRequested = (): SyncState | undefined => {
  if (!import.meta.env.DEV || typeof location !== "object") return undefined;
  const asked = new URLSearchParams(location.search).get("syncState");
  return NAMES.find((name) => name === asked);
};

export const fixtureFacts = (state: SyncState): SyncFacts => FIXTURES[state];

/** The whole list, for the dev switcher the screen shows beside the fixture. */
export const fixtureStates = NAMES;
