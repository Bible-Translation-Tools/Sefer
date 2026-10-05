/**
 * Where the open project stands with the shared project, as ONE answer for
 * every surface that shows it: the app bar's cloud button, Review's status
 * line, the Record dialog's last line, and `/cloud`.
 *
 * It was `/cloud`'s alone, read when that screen mounted, so the only way to
 * learn that a send had been refused was to go and look. Now the check on
 * open, every send, and `/cloud` itself all leave their reading here, and the
 * surfaces read it — the way `syncStatus` holds the network for everyone. A
 * reading is local work (refs and logs already in the object database); the
 * network is touched only by the check and the send that call `refresh`.
 *
 * One project at a time, because one is open at a time: a reading for any
 * other root is not an answer, and `facts(root)` says so with `undefined`.
 */

import { Effect } from "effect";
import { createSignal, flush } from "solid-js";

import { Observability, type Operation } from "#core/observability";
import type { Project } from "#core/project/project";
import { emptyPlan, sync, type Sync } from "#core/sync";

import { rememberSync } from "./diagnostics";
import { contentHostFor } from "./endpoints";
import type { Services } from "./services";
import { syncStatus } from "./syncStatus";
import { readSync, type ReadSyncOptions, type SyncFacts } from "./ui/cloud/reading";

const [held, setHeld] = createSignal<
  { readonly root: string; readonly facts: SyncFacts } | undefined
>(undefined, { name: "syncWatchFacts" });
const [fetched, setFetched] = createSignal<ReadonlyMap<string, number>>(new Map(), {
  name: "syncWatchFetchedAt",
});

/**
 * Surveys are numbered as they start, and one is published only if nothing
 * newer has been: an older reading that lands late is dropped, and a newer
 * one still under way does not hold back one that has finished.
 */
let started = 0;
let published = 0;

/**
 * One pass over the repository, as two operations, published here.
 *
 * `sync.survey` is the reading and ends with the state it derived, which is
 * also handed to `rememberSync` for a diagnostics export — and `sync.plan` is
 * the incoming plan, opened only when the device is behind. The plan FOLLOWS
 * the survey rather than running inside it: the survey has already decided
 * the state and ended by the time the plan starts, so it is a cause and not a
 * parent.
 *
 * Counts and flags only. Never the origin URL, the account or a commit.
 */
const survey = async (services: Services, options: ReadSyncOptions): Promise<SyncFacts> => {
  const mine = ++started;
  const observability = services.composition.observability;
  const surveying = observability.operation("sync.survey", {
    "sync.online": options.online,
    ...(options.fetchedAt === undefined ? {} : { "sync.fetched_at": options.fetchedAt }),
  });
  let planning: Operation | undefined;
  try {
    const found = await services.run(
      Effect.provideService(readSync(options), Observability, surveying),
    );
    const { reading } = found;
    const state = sync(reading).state;
    rememberSync(options.root, {
      state,
      ahead: reading.ahead.length,
      behind: reading.behind.length,
      observedAt: Date.now(),
    });
    // `offline` is the device, or the last transfer, saying the network did
    // not answer: kept and exported, but not the alarm.
    surveying.end(state === "offline" ? "unavailable" : "passed", {
      "sync.state": state,
      "sync.ahead": reading.ahead.length,
      "sync.behind": reading.behind.length,
      "sync.remote": reading.origin !== undefined,
      "sync.signed_in": reading.signedIn,
      "sync.online": reading.online,
      "sync.uncommitted": reading.uncommitted,
      "sync.merge": reading.mergeInProgress,
      ...(reading.fetchedAt === undefined ? {} : { "sync.fetched_at": reading.fetchedAt }),
      ...(reading.lastFailure === undefined ? {} : { "sync.reason": reading.lastFailure }),
    });
    let facts: SyncFacts = { reading, plan: emptyPlan };
    if (found.plan !== undefined) {
      planning = observability.operation(
        "sync.plan",
        { "sync.behind": reading.behind.length },
        { cause: surveying.trace },
      );
      const plan = await services.run(Effect.provideService(found.plan, Observability, planning));
      planning.end("passed", {
        "sync.books": plan.books.length,
        "sync.contested": plan.contested.length,
        "sync.chapters": plan.chapterCount,
        "sync.overlap": plan.overlapCount,
        "sync.clean": plan.clean,
      });
      facts = { reading, plan };
    }
    if (mine > published) {
      published = mine;
      setHeld({ root: options.root, facts });
    }
    return facts;
  } catch (cause) {
    // Both programs are typed never-failing, so reaching here is a defect in
    // our code: the alarm. `end` is a no-op on whichever already ended.
    surveying.end("failed");
    planning?.end("failed");
    throw cause;
  }
};

/** What a reading of `project` depends on, as a snapshot of the signals now. */
const optionsFor = (services: Services, project: Project): ReadSyncOptions => ({
  root: project.root,
  project,
  host: contentHostFor(services.settings),
  online: syncStatus.online(),
  lastFailure: syncStatus.lastFailure(),
  checking: syncStatus.checking(project.root),
  sendRefused: syncStatus.sendRefused(),
  fetchedAt: fetched().get(project.root),
});

export const syncWatch = {
  /** The last reading of the project at `root`, or `undefined` when there is none yet. */
  facts: (root: string | undefined): SyncFacts | undefined => {
    const found = held();
    return root !== undefined && found?.root === root ? found.facts : undefined;
  },
  /** The same reading, decided: the state, the two clocks and the one right button. */
  sync: (root: string | undefined): Sync | undefined => {
    const facts = syncWatch.facts(root);
    return facts === undefined ? undefined : sync(facts.reading, facts.plan.contested.length > 0);
  },
  /** When this session last fetched the project at `root`. */
  fetchedAt: (root: string): number | undefined => fetched().get(root),
  /** A fetch got through: the shared side of the reading is as new as now. */
  noteFetched: (root: string): void => {
    setFetched((was) => new Map(was).set(root, Date.now()));
  },
  /** Read `options` and publish it; `/cloud` passes options its own signals gathered. */
  survey,
  /** Read the open project again and publish it; for after a check, a send or a record. */
  refresh: (services: Services, project: Project): Promise<SyncFacts> => {
    // A caller has usually just written one of the signals read below — a
    // check marking itself finished, a send noting how it ended — and Solid 2
    // applies a write at the next flush, so without one the reading would
    // describe the moment before.
    flush();
    return survey(services, optionsFor(services, project));
  },
};
