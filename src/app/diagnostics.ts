// diagnostics.ts
//
// The two things done with the evidence beyond the ring: writing it to disk
// as it happens, and handing it to someone as one file. The formats and the
// safety rules are core's (`src/core/diagnostics/`); this is where they meet
// the services — the FileSystem, the idle scheduler, the open project.
//
// Writing starts when the services exist, because that is when there is a
// FileSystem; the queue has held every event since boot. It is skipped over
// the seeded fixture, whose FileSystem is memory: a log there would be kept
// nowhere and cost a copy of every event.

import { Effect, Option } from "effect";

import { lastSyncObserved, renderExport, type ProjectSnapshot } from "#core/diagnostics/export";
import { channelOf, UNKNOWN, type SessionHeader } from "#core/diagnostics/header";
import { listParts, makeLogWriter, pruneLogs } from "#core/diagnostics/logFiles";
import type { Project } from "#core/project/project";
import { idle } from "#platform/observability";

import { describe } from "./describe";
import { resolveEndpoints } from "./endpoints";
import { env } from "./env";
import { t } from "./i18n";
import type { Services } from "./services";
import { shellKeys } from "./settings";
import { downloadBytes } from "./ui/landing/download";
import { toasts } from "./ui/primitives";

/** What writing and the header need: the services, before the log files are among them. */
type Grounds = Pick<
  Services,
  | "composition"
  | "hostInfo"
  | "settings"
  | "galley"
  | "hostFacts"
  | "storage"
  | "fileSystem"
  | "run"
>;

/** The least time between two drains: a batch per burst of work, not per event. */
const FLUSH_INTERVAL_MS = 2000;

/** What the header says about the endpoints, and whether a preference moved them. */
const endpointsOf = (services: Grounds): SessionHeader["endpoints"] => {
  const host = services.hostInfo.kind();
  const keys = shellKeys(services.settings);
  const resolved = resolveEndpoints(services.settings, host);
  const edited = (key: typeof keys.wacsUrl): boolean => services.settings.get(key).trim() !== "";
  const out: Record<string, { readonly url: string; readonly edited: boolean }> = {};
  if (resolved.wacsUrl !== null) out.wacs = { url: resolved.wacsUrl, edited: edited(keys.wacsUrl) };
  if (resolved.languageApiUrl !== null)
    out.languageApi = { url: resolved.languageApiUrl, edited: edited(keys.languageApiUrl) };
  if (env.updaterHost !== null) out.updater = { url: env.updaterHost, edited: false };
  return out;
};

const sessionHeader = (services: Grounds): SessionHeader => {
  const session = services.composition.observability.session();
  const build = session.build ?? UNKNOWN;
  return {
    schema: 1,
    kind: "sefer.session",
    session: session.id,
    started: session.started,
    build,
    channel: channelOf(build),
    engine: services.galley.version().tag,
    ...services.hostFacts,
    endpoints: endpointsOf(services),
  };
};

export interface LogFiles {
  /** Writes whatever is pending now, and resolves when it is on disk. */
  readonly flush: () => Promise<void>;
  readonly stop: () => void;
}

const NO_FILES: LogFiles = { flush: () => Promise.resolve(), stop: () => {} };

/**
 * Starts writing the queue to `HostInfo.paths().logs`: prune first, then
 * drain on idle at most every `FLUSH_INTERVAL_MS`, and at once when the page
 * is hidden or closed. Writes are chained, never concurrent. The first write
 * that fails stops the writer for the session and says so once, as
 * `unavailable` — a full disk or a revoked permission is the world saying no,
 * and the ring still holds the recent past.
 */
export const startLogFiles = (services: Grounds): LogFiles => {
  if (services.storage === "fixture") return NO_FILES;
  const observability = services.composition.observability;
  const queue = services.composition.logs;
  const directory = services.hostInfo.paths().logs;
  const header = sessionHeader(services);
  const writer = makeLogWriter(services.fileSystem, directory, header);
  const schedule = idle();
  let chain: Promise<void> = services
    .run(pruneLogs(services.fileSystem, directory, Date.now(), header))
    .then(
      () => {},
      () => {},
    );
  let stopped = false;
  let armed = false;
  let last = 0;

  const flush = (): Promise<void> => {
    armed = false;
    last = Date.now();
    const { events, dropped } = queue.take();
    if (stopped || (events.length === 0 && dropped === 0)) return chain;
    chain = chain.then(async () => {
      if (stopped) return;
      try {
        await services.run(writer.append(events, dropped));
      } catch (cause) {
        stopped = true;
        observability.note("diagnostics.persist", "unavailable", describe(cause), {
          "diagnostics.events": events.length,
        });
      }
    });
    return chain;
  };

  const wake = (): void => {
    if (armed || stopped) return;
    armed = true;
    setTimeout(
      () => schedule(() => void flush()),
      Math.max(0, FLUSH_INTERVAL_MS - (Date.now() - last)),
    );
  };

  const hidden = (): void => {
    if (typeof document === "object" && document.visibilityState === "hidden") void flush();
  };
  const leaving = (): void => void flush();
  if (typeof window === "object") {
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leaving);
  }
  queue.onPending(wake);

  return {
    flush,
    stop: () => {
      stopped = true;
      if (typeof window === "object") {
        document.removeEventListener("visibilitychange", hidden);
        window.removeEventListener("pagehide", leaving);
      }
    },
  };
};

/**
 * Where the open project stands, from local reads only. `sync` is the newest
 * `sync.survey` in the ring: the last state the app observed, never a fresh
 * fetch — an export must not wait on the network.
 */
const snapshotOf = async (
  services: Services,
  project: Project | undefined,
): Promise<ProjectSnapshot> => {
  const sync = lastSyncObserved(services.composition.observability.recent());
  if (project === undefined)
    return {
      open: false,
      project: "",
      remote: UNKNOWN,
      branch: UNKNOWN,
      head: UNKNOWN,
      unsavedBooks: UNKNOWN,
      journalPending: UNKNOWN,
      sync,
    };
  const local = await services
    .run(
      Effect.gen(function* () {
        const repo = yield* services.git.open(project.root);
        const head = yield* services.git.resolve(repo, "HEAD");
        const branch = yield* services.git.branch(repo);
        const origin = yield* Effect.orElseSucceed(services.remote.origin(repo), () =>
          Option.none<string>(),
        );
        return {
          head: Option.getOrElse(head, () => UNKNOWN),
          branch: Option.getOrElse(branch, () => UNKNOWN),
          remote: Option.isSome(origin),
        };
      }),
    )
    .catch((): { head: string; branch: string; remote: boolean | typeof UNKNOWN } => ({
      head: UNKNOWN,
      branch: UNKNOWN,
      remote: UNKNOWN,
    }));
  const pending = await services
    .run(
      services.recovery.pending((bookId) => {
        const book = project.books.find((one) => one.id === bookId);
        return book === undefined ? Option.none() : services.save.baseline(book);
      }),
    )
    .then(
      (found): boolean | typeof UNKNOWN => found.length > 0,
      (): boolean | typeof UNKNOWN => UNKNOWN,
    );
  return {
    open: true,
    project: project.root.slice(project.root.lastIndexOf("/") + 1),
    ...local,
    // The shell's own rule (`shellStores.ts`): a book with no baseline was
    // never read from disk as saved, so "dirty" there is not "unsaved".
    unsavedBooks: project.books.filter(
      (book) => Option.isSome(services.save.baseline(book)) && services.save.dirty(book),
    ).length,
    journalPending: pending,
    sync,
  };
};

/**
 * The whole export, as text: header and snapshot, the failure ring, the main
 * ring, and every part on disk (this session's too, flushed first, because
 * the disk has what the ring has already let go of).
 */
const diagnosticsText = async (
  services: Services,
  project: Project | undefined,
): Promise<string> => {
  await services.logFiles.flush();
  const observability = services.composition.observability;
  const directory = services.hostInfo.paths().logs;
  const disk =
    services.storage === "fixture"
      ? []
      : await services
          .run(
            Effect.gen(function* () {
              const parts = yield* listParts(services.fileSystem, directory);
              return yield* Effect.forEach(parts, (part) =>
                services.fileSystem.readFileString(part.path),
              );
            }),
          )
          .catch(() => []);
  return renderExport({
    header: sessionHeader(services),
    exported: Date.now(),
    snapshot: await snapshotOf(services, project),
    failures: observability.failures(),
    recent: observability.recent(),
    dropped: observability.dropped(),
    disk,
  });
};

/** `sefer-diagnostics-20260924T111500Z.jsonl`. */
const diagnosticsFileName = (now: number): string => {
  const at = new Date(now)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z");
  return `sefer-diagnostics-${at}.jsonl`;
};

const JSONL_FILTERS = [{ name: "JSON Lines", extensions: ["jsonl"] }] as const;

/**
 * Settings → Advanced → "Export diagnostics": the file, handed over.
 *
 * The same two endings as saving a project copy: a named file on a host with
 * real disk, a download in a browser. One `diagnostics.export` operation
 * records that it happened and how big it was — never what was in it.
 */
export const exportDiagnostics = async (
  services: Services,
  project: Project | undefined,
): Promise<void> => {
  const now = Date.now();
  const fileName = diagnosticsFileName(now);
  const operation = services.composition.observability.operation("diagnostics.export", {
    "app.host": services.hostInfo.kind(),
  });
  const nativeDisk = services.hostInfo.capabilities().nativeDisk;
  const destination = nativeDisk
    ? await services.run(
        services.dialogs.pickSaveFile(t("Save diagnostics"), fileName, JSONL_FILTERS),
      )
    : Option.none<string>();
  if (nativeDisk && Option.isNone(destination)) {
    operation.end("declined");
    return;
  }
  const notice = toasts.progress({ title: t("Preparing diagnostics") });
  try {
    const text = await diagnosticsText(services, project);
    const lines = text.split("\n").length - 1;
    if (Option.isSome(destination))
      await services.run(services.fileSystem.writeFileString(destination.value, text));
    else downloadBytes(fileName, new TextEncoder().encode(text), "application/x-ndjson");
    operation.end("passed", { "diagnostics.lines": lines, "diagnostics.chars": text.length });
    toasts.update(notice, {
      title: t("Diagnostics exported"),
      message: Option.isSome(destination) ? destination.value : fileName,
      tone: "success",
    });
  } catch (cause) {
    operation.end("failed", { "error.type": cause instanceof Error ? cause.name : "unknown" });
    toasts.update(notice, {
      title: t("Could not export diagnostics"),
      message: describe(cause),
      tone: "error",
      autoClose: false,
    });
  }
};
