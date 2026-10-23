import { Effect } from "effect";
import { createSignal, flush } from "solid-js";

import { Observability, type Operation } from "#core/observability";
import type { Project } from "#core/project/project";
import { emptyPlan, sync, type Sync } from "#core/sync";

import { rememberSync } from "./diagnostics";
import { contentHostFor } from "./endpoints";
import type { Services } from "./services";
import { chosenMode } from "./syncSettings";
import { syncStatus } from "./syncStatus";
import { readSync, type ReadSyncOptions, type SyncFacts } from "./ui/cloud/reading";

const [held, setHeld] = createSignal<
  { readonly root: string; readonly facts: SyncFacts } | undefined
>(undefined, { name: "syncWatchFacts" });
const [fetched, setFetched] = createSignal<ReadonlyMap<string, number>>(new Map(), {
  name: "syncWatchFetchedAt",
});

let started = 0;
let published = 0;

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
    surveying.end("failed");
    planning?.end("failed");
    throw cause;
  }
};

const optionsFor = (services: Services, project: Project): ReadSyncOptions => ({
  root: project.root,
  project,
  host: contentHostFor(services.settings),
  online: syncStatus.online(),
  lastFailure: syncStatus.lastFailure(),
  checking: syncStatus.checking(project.root),
  sendRefused: syncStatus.sendRefused(),
  fetchedAt: fetched().get(project.root),
  chosenMode: chosenMode(services.settings, project.root),
});

export const syncWatch = {
  facts: (root: string | undefined): SyncFacts | undefined => {
    const found = held();
    return root !== undefined && found?.root === root ? found.facts : undefined;
  },
  sync: (root: string | undefined): Sync | undefined => {
    const facts = syncWatch.facts(root);
    return facts === undefined ? undefined : sync(facts.reading, facts.plan.contested.length > 0);
  },
  fetchedAt: (root: string): number | undefined => fetched().get(root),
  noteFetched: (root: string): void => {
    setFetched((was) => new Map(was).set(root, Date.now()));
  },
  survey,
  refresh: (services: Services, project: Project): Promise<SyncFacts> => {
    flush();
    return survey(services, optionsFor(services, project));
  },
};
