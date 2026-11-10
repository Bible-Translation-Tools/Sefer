import { Effect, Fiber, Option, Stream } from "effect";

import { m } from "#app/paraglide/messages";
import { Observability } from "#core/observability";
import { Remote, remoteVerdict } from "#core/remote/remote";

import {
  AlreadyHeld,
  announceSourceTexts,
  arrivalRoot,
  cloneArrival,
  type ArrivalKind,
} from "../../arrival";
import { type CatalogueEntry } from "../../catalogue";
import { describe, describeTransfer, reasonOf, remoteReasonOf } from "../../describe";
import { DOWNLOAD_WINDOW_MS, downloadRuns } from "../../downloadRuns";
import type { Services } from "../../services";
import { toasts } from "../primitives";
import type { PendingDownload } from "./downloads";

interface DownloadSink {
  readonly start: (download: PendingDownload, from: DOMRect) => void;
  readonly update: (id: string, patch: Partial<PendingDownload>) => void;
}

type Toast = ReturnType<typeof toasts.progress>;

const watchProgress = (
  services: Services,
  entry: CatalogueEntry,
  toast: Toast | undefined,
  downloads: DownloadSink,
) =>
  services.runtime.runFork(
    Effect.flatMap(Remote, (remote) =>
      Stream.runForEach(remote.progress(), (progress) =>
        Effect.sync(() => {
          const percent =
            progress.total === undefined || progress.total === 0
              ? undefined
              : Math.min(100, Math.round((progress.loaded / progress.total) * 100));
          if (toast === undefined)
            downloads.update(entry.id, {
              status: progress.unit === "bytes" ? describeTransfer(progress) : progress.phase,
              ...(progress.unit === "bytes" ? {} : { percent }),
            });
          else
            toasts.advance(toast, {
              title: m.common_downloading_name({ name: entry.repo }),
              message: describeTransfer(progress),
            });
        }),
      ),
    ),
  );

const announceDownloaded = (
  outcome: "held" | "cloned",
  entry: CatalogueEntry,
  toast: Toast | undefined,
  downloads: DownloadSink,
  announce: () => void,
): void => {
  if (toast !== undefined)
    toasts.update(toast, {
      title: entry.repo,
      message:
        outcome === "held"
          ? m.landing_already_on_this_device_under()
          : m.landing_downloaded_choose_it_as_a(),
      tone: "success",
    });
  else {
    downloads.update(entry.id, { status: m.common_done(), percent: 100 });
    announce();
  }
};

const beginTracking = (
  downloads: DownloadSink,
  entry: CatalogueEntry,
  kind: ArrivalKind,
  into: string,
  from: DOMRect,
): Toast | undefined => {
  const toast =
    kind === "sourceText"
      ? toasts.progress({ title: m.common_downloading_name({ name: entry.repo }), message: "" })
      : undefined;
  if (toast === undefined)
    downloads.start(
      {
        id: entry.id,
        root: into,
        language: entry.naturalName,
        code: entry.code,
        status: m.common_starting(),
        percent: undefined,
      },
      from,
    );
  return toast;
};

/**
 * Download a catalogue row. The download is one machine (`src/core/remote/download.ts`),
 * keyed by the row: a project waits out the cancel window with its card already in the list,
 * where Cancel is; a source text has no card to hold a Cancel, so it starts at once.
 */
export const downloadEntry = (
  services: Services,
  downloads: DownloadSink,
  entry: CatalogueEntry,
  from: DOMRect,
  open: (root: string) => void,
): void => {
  if (downloadRuns.busy(entry.id)) return;
  const kind: ArrivalKind = entry.type === "gateway" ? "sourceText" : "project";
  const into = arrivalRoot(services, kind, entry.gitUrl);
  if (kind === "project") beginTracking(downloads, entry, kind, into, from);
  downloadRuns.ask(
    entry.id,
    () => fetchEntry(services, downloads, entry, kind, into, from, open),
    kind === "project" ? DOWNLOAD_WINDOW_MS : 0,
  );
};

const fetchEntry = async (
  services: Services,
  downloads: DownloadSink,
  entry: CatalogueEntry,
  kind: ArrivalKind,
  into: string,
  from: DOMRect,
  open: (root: string) => void,
): Promise<void> => {
  let arrivedAt = into;
  const toast =
    kind === "sourceText" ? beginTracking(downloads, entry, kind, into, from) : undefined;
  const watching = watchProgress(services, entry, toast, downloads);
  const operation = services.composition.observability.operation("import.remote", {
    "import.source": "catalogue",
    "import.host": services.hostInfo.kind(),
    "catalogue.type": entry.type,
  });
  try {
    const outcome = await services.run(
      Effect.provideService(
        Effect.gen(function* () {
          if (kind === "sourceText") {
            const held = yield* services.library.cloned(entry.gitUrl);
            if (Option.isSome(held)) return "held" as const;
          }
          const arrived = yield* cloneArrival(services, kind, entry.gitUrl, {
            catalogueId: entry.id,
          });
          arrivedAt = arrived.root;
          return "cloned" as const;
        }),
        Observability,
        operation,
      ),
    );
    operation.end("passed", { "import.phase": "complete", "import.outcome": outcome });
    announceDownloaded(outcome, entry, toast, downloads, () => {
      void announceSourceTexts(services, arrivedAt);
    });
  } catch (cause) {
    operation.end(remoteVerdict(remoteReasonOf(cause)), {
      "import.reason": reasonOf(cause) ?? "Unknown",
    });
    if (toast !== undefined) toasts.dismiss(toast);
    else downloads.update(entry.id, { status: describe(cause) });
    if (cause instanceof AlreadyHeld)
      toasts.info({
        title: m.landing_already_on_this_device(),
        message: cause.description,
        action: { label: m.landing_open(), onPress: () => open(cause.root) },
      });
    else
      toasts.error({
        title: m.landing_could_not_download_name({ name: entry.repo }),
        message: describe(cause),
      });
    // The machine's `failed`: the card and the row read it.
    throw cause;
  } finally {
    Effect.runFork(Fiber.interrupt(watching));
  }
};
