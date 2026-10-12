/**
 * Downloading reference material, said the same way wherever it starts (the
 * reference column's menu, the projects page's Notes section): one
 * `import.remote` operation and one progress toast that moves the whole way —
 * git's own steps while the bytes arrive, then reading, then each book
 * packed — and ends saying what happened. A failure stays on screen.
 */

import { Effect } from "effect";
import { createSignal } from "solid-js";

import { Observability } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import type { Resource } from "#core/resources/library";

import { describeCopy, referenceCopy } from "../arrival";
import type { HelpText } from "../catalogue";
import { describe, remoteReasonOf } from "../describe";
import { contentHostFor } from "../endpoints";
import { t } from "../i18n";
import type { Services } from "../services";
import { toasts } from "../ui/primitives";

/** Where a help is cloned from on the configured content host, or `undefined` with none. */
export const helpUrl = (services: Services, help: HelpText): string | undefined => {
  const host = contentHostFor(services.settings);
  return host === null ? undefined : `${host}/${help.repository}`;
};

/**
 * The repositories being downloaded right now, so every screen that offers
 * one can show it as busy, and a second press does not start a second copy.
 */
const [downloading, setDownloading] = createSignal<ReadonlySet<string>>(new Set(), {
  name: "helpDownloads",
});
export const helpDownloads = downloading;

/** Downloads `help` into the Library (once per device), with its progress toast. */
export const downloadHelp = (services: Services, help: HelpText): Promise<Resource> => {
  const url = helpUrl(services, help);
  if (url === undefined) return Promise.reject(new Error(t("No cloud is configured.")));
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
          // Git reports every object; the toast changes only when its words do.
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
