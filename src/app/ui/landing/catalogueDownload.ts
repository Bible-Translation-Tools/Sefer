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
        state: "downloading",
        status: m.common_starting(),
        percent: undefined,
      },
      from,
    );
  return toast;
};

export const downloadEntry = (
  services: Services,
  downloads: DownloadSink,
  setBusy: (id: string, on: boolean) => void,
  entry: CatalogueEntry,
  from: DOMRect,
  open: (root: string) => void,
): void => {
  const kind: ArrivalKind = entry.type === "gateway" ? "sourceText" : "project";
  const into = arrivalRoot(services, kind, entry.gitUrl);
  let arrivedAt = into;
  setBusy(entry.id, true);
  const toast = beginTracking(downloads, entry, kind, into, from);
  const watching = watchProgress(services, entry, toast, downloads);
  const operation = services.composition.observability.operation("import.remote", {
    "import.source": "catalogue",
    "import.host": services.hostInfo.kind(),
    "catalogue.type": entry.type,
  });
  void services
    .run(
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
    )
    .then((outcome) => {
      operation.end("passed", { "import.phase": "complete", "import.outcome": outcome });
      announceDownloaded(outcome, entry, toast, downloads, () => {
        void announceSourceTexts(services, arrivedAt);
      });
    })
    .catch((cause: unknown) => {
      operation.end(remoteVerdict(remoteReasonOf(cause)), {
        "import.reason": reasonOf(cause) ?? "Unknown",
      });
      if (toast !== undefined) toasts.dismiss(toast);
      else downloads.update(entry.id, { state: "failed", status: describe(cause) });
      if (cause instanceof AlreadyHeld) {
        toasts.info({
          title: m.landing_already_on_this_device(),
          message: cause.description,
          action: { label: m.landing_open(), onPress: () => open(cause.root) },
        });
        return;
      }
      toasts.error({
        title: m.landing_could_not_download_name({ name: entry.repo }),
        message: describe(cause),
      });
    })
    .finally(() => {
      Effect.runFork(Fiber.interrupt(watching));
      setBusy(entry.id, false);
    });
};
