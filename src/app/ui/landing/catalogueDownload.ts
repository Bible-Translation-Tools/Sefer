import { Effect, Fiber, Option, Stream } from "effect";

import { Observability } from "#core/observability";
import { Remote, remoteVerdict } from "#core/remote/remote";

import { announceSourceTexts, arrivalRoot, cloneArrival, type ArrivalKind } from "../../arrival";
import { type CatalogueEntry } from "../../catalogue";
import { describe, describeTransfer, reasonOf, remoteReasonOf } from "../../describe";
import { t } from "../../i18n";
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
              title: t("Downloading {name}", { name: entry.repo }),
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
          ? t("Already on this device, under Source texts.")
          : t("Downloaded. Choose it as a source text beside any project."),
      tone: "success",
    });
  else {
    downloads.update(entry.id, { status: t("Done"), percent: 100 });
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
      ? toasts.progress({ title: t("Downloading {name}", { name: entry.repo }), message: "" })
      : undefined;
  if (toast === undefined)
    downloads.start(
      {
        id: entry.id,
        root: into,
        language: entry.naturalName,
        code: entry.code,
        state: "downloading",
        status: t("Starting…"),
        percent: undefined,
      },
      from,
    );
  return toast;
};

export const downloadEntry = (
  services: Services,
  downloads: DownloadSink,
  setBusy: (id: string) => void,
  entry: CatalogueEntry,
  from: DOMRect,
): void => {
  const kind: ArrivalKind = entry.type === "gateway" ? "sourceText" : "project";
  const into = arrivalRoot(services, kind, entry.gitUrl);
  setBusy(entry.id);
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
          yield* cloneArrival(services, kind, entry.gitUrl, { catalogueId: entry.id });
          return "cloned" as const;
        }),
        Observability,
        operation,
      ),
    )
    .then((outcome) => {
      operation.end("passed", { "import.phase": "complete", "import.outcome": outcome });
      announceDownloaded(outcome, entry, toast, downloads, () => {
        void announceSourceTexts(services, into);
      });
    })
    .catch((cause: unknown) => {
      operation.end(remoteVerdict(remoteReasonOf(cause)), {
        "import.reason": reasonOf(cause) ?? "Unknown",
      });
      if (toast !== undefined) toasts.dismiss(toast);
      else downloads.update(entry.id, { state: "failed", status: describe(cause) });
      toasts.error({
        title: t("Could not download {name}", { name: entry.repo }),
        message: describe(cause),
      });
    })
    .finally(() => {
      Effect.runFork(Fiber.interrupt(watching));
      setBusy("");
    });
};
