import { Effect, Option } from "effect";

import { renderExport, type ProjectSnapshot } from "#core/diagnostics/export";
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

const FLUSH_INTERVAL_MS = 2000;

const endpointsOf = (services: Grounds): SessionHeader["endpoints"] => {
  const keys = shellKeys(services.settings);
  const resolved = resolveEndpoints(services.settings);
  const edited = (key: typeof keys.contentHost): boolean =>
    services.settings.get(key).trim() !== "";
  const out: Record<string, { readonly url: string; readonly edited: boolean }> = {};
  if (resolved.contentHost !== null)
    out.contentHost = { url: resolved.contentHost, edited: edited(keys.contentHost) };
  if (resolved.catalogueUrl !== null)
    out.catalogue = { url: resolved.catalogueUrl, edited: edited(keys.catalogueUrl) };
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
  readonly flush: () => Promise<void>;
  readonly stop: () => void;
  readonly status: () => {
    readonly state: "writing" | "stopped" | "off";
    readonly reason?: string;
  };
}

const NO_FILES: LogFiles = {
  flush: () => Promise.resolve(),
  stop: () => {},
  status: () => ({ state: "off" }),
};

export const startLogFiles = (services: Grounds): LogFiles => {
  if (services.storage === "fixture") return NO_FILES;
  const observability = services.composition.observability;
  const queue = services.composition.logs;
  const directory = services.hostInfo.paths().logs;
  const header = sessionHeader(services);
  const writer = makeLogWriter(services.fileSystem, directory, header);
  const schedule = idle();
  let stopped = false;
  let reason: string | undefined;
  let armed = false;
  let last = 0;
  let writing: Promise<void> = services
    .run(pruneLogs(services.fileSystem, directory, Date.now(), header))
    .then(
      () => {},
      () => {},
    );
  let busy = true;
  let again = false;
  void writing.then(() => {
    busy = false;
    if (again) void flush();
  });

  const write = async (): Promise<void> => {
    do {
      again = false;
      const { events, dropped } = queue.take();
      if (stopped || (events.length === 0 && dropped === 0)) return;
      try {
        await services.run(writer.append(events, dropped));
      } catch (cause) {
        stopped = true;
        reason = describe(cause);
        observability.note("diagnostics.persist", "unavailable", reason, {
          "diagnostics.events": events.length,
        });
      }
    } while (again && !stopped);
  };

  const flush = (): Promise<void> => {
    armed = false;
    last = Date.now();
    if (busy) {
      again = true;
      return writing.then(() => (busy ? writing : undefined));
    }
    busy = true;
    writing = write().finally(() => {
      busy = false;
      if (queue.size() > 0) wake();
    });
    return writing;
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
    status: () =>
      stopped && reason !== undefined ? { state: "stopped", reason } : { state: "writing" },
    stop: () => {
      stopped = true;
      if (typeof window === "object") {
        document.removeEventListener("visibilitychange", hidden);
        window.removeEventListener("pagehide", leaving);
      }
    },
  };
};

type ObservedSync = Exclude<ProjectSnapshot["sync"], typeof UNKNOWN>;

const observed = new Map<string, ObservedSync>();

export const rememberSync = (root: string, sync: ObservedSync): void => {
  observed.set(root, sync);
};

const snapshotOf = async (
  services: Services,
  project: Project | undefined,
): Promise<ProjectSnapshot> => {
  const sync = project === undefined ? UNKNOWN : (observed.get(project.root) ?? UNKNOWN);
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
    unsavedBooks: project.books.filter(
      (book) => Option.isSome(services.save.baseline(book)) && services.save.dirty(book),
    ).length,
    journalPending: pending,
    sync,
  };
};

const diagnosticsText = async (
  services: Services,
  project: Project | undefined,
): Promise<{ readonly text: string; readonly missing: string | undefined }> => {
  await services.logFiles.flush();
  const observability = services.composition.observability;
  const directory = services.hostInfo.paths().logs;
  const read =
    services.storage === "fixture"
      ? { disk: [], status: { state: "none" as const } }
      : await services
          .run(
            Effect.gen(function* () {
              const parts = yield* listParts(services.fileSystem, directory);
              return yield* Effect.forEach(parts, (part) =>
                services.fileSystem.readFileString(part.path),
              );
            }),
          )
          .then(
            (disk) => ({ disk, status: { state: "complete" as const } }),
            (cause: unknown) => ({
              disk: [],
              status: { state: "unavailable" as const, reason: describe(cause) },
            }),
          );
  const persist = services.logFiles.status();
  const missing =
    read.status.state === "unavailable"
      ? t("The log files could not be read: {reason}", { reason: read.status.reason })
      : persist.state === "stopped"
        ? t("Writing the log stopped this session: {reason}", { reason: persist.reason ?? "" })
        : undefined;
  const text = renderExport({
    header: sessionHeader(services),
    exported: Date.now(),
    snapshot: await snapshotOf(services, project),
    failures: observability.failures(),
    recent: observability.recent(),
    dropped: observability.dropped(),
    persist,
    diskStatus: read.status,
    disk: read.disk,
  });
  return { text, missing };
};

const diagnosticsFileName = (now: number): string => {
  const at = new Date(now)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "Z");
  return `sefer-diagnostics-${at}.jsonl`;
};

const JSONL_FILTERS = [{ name: "JSON Lines", extensions: ["jsonl"] }] as const;

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
    const { text, missing } = await diagnosticsText(services, project);
    const lines = text.split("\n").length - 1;
    if (Option.isSome(destination))
      await services.run(services.fileSystem.writeFileString(destination.value, text));
    else downloadBytes(fileName, new TextEncoder().encode(text), "application/x-ndjson");
    operation.end(missing === undefined ? "passed" : "unavailable", {
      "diagnostics.lines": lines,
      "diagnostics.chars": text.length,
      "diagnostics.complete": missing === undefined,
    });
    const where = Option.isSome(destination) ? destination.value : fileName;
    toasts.update(notice, {
      title: missing === undefined ? t("Diagnostics exported") : t("Diagnostics exported, in part"),
      message: missing === undefined ? where : `${where} — ${missing}`,
      tone: missing === undefined ? "success" : "info",
      ...(missing === undefined ? {} : { autoClose: false }),
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
