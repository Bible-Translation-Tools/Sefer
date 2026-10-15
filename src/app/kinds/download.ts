/**
 * Downloading reference material from the reference column's menu (and
 * removing it again, `removeHelp`): one
 * `import.remote` operation and one progress toast that moves the whole way —
 * git's own steps while the bytes arrive, then reading, then each book
 * packed — and ends saying what happened. A failure stays on screen.
 */

import { Effect } from "effect";
import { createSignal } from "solid-js";

import { Observability } from "#core/observability";
import { remoteVerdict } from "#core/remote/remote";
import type { Resource } from "#core/resources/library";

import { describeCopy, noteLibraryChanged, referenceCopy } from "../arrival";
import type { HelpText } from "../catalogue";
import { describe, remoteReasonOf } from "../describe";
import { t } from "../i18n";
import type { Services } from "../services";
import { toasts } from "../ui/primitives";

/**
 * The repositories being downloaded right now, so the menu that offers one
 * can show its row as busy, and a second press does not start a second copy.
 */
const [downloading, setDownloading] = createSignal<ReadonlySet<string>>(new Set(), {
  name: "helpDownloads",
});
export const helpDownloads = downloading;

/** Downloads in flight, by repository: a second ask joins the first. */
const inFlight = new Map<string, Promise<Resource>>();

/**
 * Downloads `help` into the Library (once per device), with its progress
 * toast. Asked again while it is downloading (the menu of another open
 * project, or the same row pressed twice), it answers with the same download rather than
 * starting a second one into the same folder, whose failure would remove
 * what the first registers.
 */
export const downloadHelp = (services: Services, help: HelpText): Promise<Resource> => {
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

const startDownload = (services: Services, help: HelpText): Promise<Resource> => {
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

/**
 * Takes reference material off this device: the Library forgets it, and its
 * folder goes when it is in the Library's own directory (a reference copy,
 * nobody's work; a folder someone picked stays where it is). A project that
 * had picked it simply shows nothing for it. Says how it went in a toast, as
 * the projects page's Remove did before it moved here; no confirm, no undo —
 * downloading it again is the undo.
 */
export const removeHelp = (services: Services, resource: Resource): Promise<void> =>
  services
    .run(
      Effect.gen(function* () {
        yield* services.library.remove(resource.id);
        if (resource.root.startsWith(`${services.libraryRoot}/`))
          yield* Effect.ignore(services.fileSystem.remove(resource.root, { recursive: true }));
      }),
    )
    .then(() => {
      noteLibraryChanged();
      toasts.success({ title: t("Removed {title}", { title: resource.title }) });
    })
    .catch((cause: unknown) => {
      toasts.error({
        title: t("Could not remove {title}", { title: resource.title }),
        message: describe(cause),
      });
    });
