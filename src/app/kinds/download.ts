import { Effect } from "effect";
import { createSignal } from "solid-js";

import { Observability } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import type { Resource } from "#core/resources/library";

import { describeCopy, referenceCopy } from "../arrival";
import type { ListedText } from "../catalogue";
import { describe, remoteReasonOf } from "../describe";
import { t } from "../i18n";
import type { Services } from "../services";
import { toasts } from "../ui/primitives";

const [downloading, setDownloading] = createSignal<ReadonlySet<string>>(new Set(), {
  name: "helpDownloads",
});
export const helpDownloads = downloading;

const inFlight = new Map<string, Promise<Resource>>();

export const downloadHelp = (services: Services, help: ListedText): Promise<Resource> => {
  const running = inFlight.get(help.repository);
  if (running !== undefined) return running;
  const started = startDownload(services, help);
  inFlight.set(help.repository, started);
  void started.then(
    () => inFlight.delete(help.repository),
    () => inFlight.delete(help.repository),
  );
  return started;
};

const startDownload = (services: Services, help: ListedText): Promise<Resource> => {
  const url = help.url;
  const title = t("Downloading {title}", { title: help.title });
  const toast = toasts.progress({ title, message: t("Starting…") });
  const operation = services.composition.observability.operation("import.remote", {
    "import.source": "reference-material",
    "import.host": services.hostInfo.kind(),
  });
  setDownloading((held) => new Set([...held, help.repository]));
  let said = "";
  return services
    .run(
      Effect.provideService(
        referenceCopy(services, url, (progress) => {
          const message = describeCopy(progress);
          if (message === said) return;
          said = message;
          toasts.advance(toast, { title, message });
        }),
        Observability,
        operation,
      ),
    )
    .then((resource) => {
      operation.end("passed", {
        "import.phase": "complete",
        "resource.content": resource.content,
      });
      toasts.update(toast, {
        title: help.title,
        message: t("On this device. Choose it beside any project."),
        tone: "success",
      });
      return resource;
    })
    .catch((cause: unknown) => {
      operation.end(remoteVerdict(remoteReasonOf(cause)));
      toasts.update(toast, {
        title: t("Could not download {title}", { title: help.title }),
        message: describe(cause),
        tone: "error",
      });
      throw cause;
    })
    .finally(() => {
      setDownloading((held) => new Set([...held].filter((each) => each !== help.repository)));
    });
};
