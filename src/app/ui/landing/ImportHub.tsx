/**
 * The import hub: the three ways a project gets onto this device, as three
 * cards that say up front which of them this host can actually do.
 *
 * The rule the whole component is built around: a source the host cannot serve
 * is rendered DISABLED with the reason in place of its explainer, never hidden
 * and never offered-then-failed. `HostCapabilities` and `env` are asked before
 * the button exists, which is what `HostInfo.capabilities()` is for.
 *
 * The folder flow is the real `stage → classify → commit` pipeline from
 * `src/core/resources/import.ts`, run one step at a time so the dialog can name
 * the step it is on. Nothing touches the project root until `commit`, so
 * cancelling or failing leaves a staging directory and nothing else.
 *
 * There are two ways into that pipeline and the difference is the FIRST step
 * only. A host with a native disk hands back a real path and `stage` copies it.
 * A browser has no path to hand back, so `src/platform/web/intake.ts` writes
 * the picked bytes into the staging directory itself and returns the same
 * `Staged` value — after which classify and commit are identical. Intake is
 * reached through a dynamic import, so the zip decoder is fetched by the people
 * who use it and never sits in the first load.
 *
 * Cloning is `cloneRepository` (`src/core/remote/clone.ts`) over the Gitea
 * session the cloud panel already holds — this screen does not log anyone in,
 * it only spends a session that exists.
 */

import type { JSX } from "@solidjs/web";
import { Effect, Option, Scope } from "effect";
import CloudDownload from "lucide-solid/icons/cloud-download";
import FileArchive from "lucide-solid/icons/file-archive";
import FolderOpen from "lucide-solid/icons/folder-open";
import { For, Show, createSignal } from "solid-js";

import { lastSegment } from "#core/fileSystem/path";
import { Observability } from "#core/observability";
import { cloneRepository } from "#core/remote/clone";
import { Gitea, type RemoteRepo } from "#core/remote/gitea";
import { classify, commit, stage } from "#core/resources/import";

import { describe, reasonOf } from "../../describe";
import { wacsUrlFor } from "../../endpoints";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import type { Domain } from "../../services";
import { Button, Card, Dialog, Input, cx, toasts } from "../primitives";
import { rememberProject } from "./summaries";

/** Each step the pipeline runs, in order. The dialog draws all four. */
const STEPS = ["pick", "stage", "classify", "commit"] as const;

type Step = (typeof STEPS)[number];

const STEP_LABEL: Readonly<Record<Step, string>> = {
  pick: "Selecting the source…",
  stage: "Copying files into staging…",
  classify: "Working out what it is…",
  commit: "Validating books and committing…",
};

/**
 * What the progress dialog is showing. `step` is the running one; `undefined`
 * means the run is over and `message` is the whole content.
 */
interface Progress {
  readonly title: string;
  readonly step: Step | undefined;
  readonly message: string;
  readonly failed: boolean;
  /** "12 of 66 files" while a step is running; the steps alone say too little. */
  readonly detail?: string;
}

interface SourceCard {
  readonly id: string;
  readonly icon: JSX.Element;
  readonly title: string;
  /** The one-line explainer — or, when unavailable, the reason. */
  readonly explainer: string;
  readonly action: string;
  readonly available: boolean;
  readonly onRun: () => void;
}

export function ImportHub(props: { readonly onImported: () => void }) {
  const shell = useShell();
  const { services } = shell;
  const capabilities = services.hostInfo.capabilities();
  // One endpoint, one condition. Not a Gitea host AND, on the Web, a CORS
  // proxy, which could disagree with each other: the endpoint IS whichever of
  // the two this build talks to.
  const endpoint = wacsUrlFor(services.settings, services.hostInfo.kind());

  const [progress, setProgress] = createSignal<Progress | undefined>(undefined, {
    name: "importProgress",
  });
  const [cloneOpen, setCloneOpen] = createSignal(false, { name: "cloneOpen" });
  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloneRepos" });
  const [cloneNote, setCloneNote] = createSignal("", { name: "cloneNote" });
  const [cloneUrl, setCloneUrl] = createSignal("", { name: "cloneUrl" });

  const running = (title: string, step: Step, detail?: string): void => {
    setProgress({ title, step, message: "", failed: false, detail });
  };

  const finished = (title: string, message: string, failed: boolean): void => {
    setProgress({ title, step: undefined, message, failed });
  };

  /**
   * The folder import, step by step.
   *
   * Each stage is its own `run` so the dialog can change between them; running
   * the three as one Effect would show one spinner for the whole thing, which
   * is exactly the information someone waiting wants.
   */
  const importFolder = (): void => {
    const title = t("Import from a folder");
    const toast = toasts.progress({
      title: t("Importing project"),
      message: t("Choosing a folder"),
    });
    running(title, "pick");
    const operation = services.composition.observability.operation("import.resource", {
      "import.source": "folder",
      "import.host": services.hostInfo.kind(),
    });
    let phase = "pick";
    const run = async <A, E>(
      effect: Effect.Effect<A, E, Domain | Scope.Scope>,
      stageName?: string,
    ): Promise<A> => {
      const stop = stageName === undefined ? undefined : operation.span(stageName);
      try {
        return await services.run(Effect.provideService(effect, Observability, operation));
      } finally {
        stop?.();
      }
    };

    void (async () => {
      const picked = await run(services.dialogs.pickFolder(t("Select a project folder")));
      const source = Option.getOrUndefined(picked);
      if (source === undefined) {
        operation.end("declined", { "import.phase": phase });
        setProgress(undefined);
        toasts.dismiss(toast);
        return;
      }

      running(title, "stage");
      phase = "stage";
      toasts.update(toast, { title: t("Importing project"), message: t("Staging files") });
      const staged = await run(
        stage(services.fileSystem, [source], `${services.hostInfo.paths().temp}/import`),
        "import.stage",
      );

      running(title, "classify");
      phase = "classify";
      const kind = await run(classify(services.fileSystem, staged), "import.classify");

      running(title, "commit");
      phase = "commit";
      toasts.update(toast, { title: t("Importing project"), message: t("Committing books") });
      const into = `${services.projectsRoot}/${lastSegment(source)}`;
      const books = await run(
        commit(services.fileSystem, staged, { root: into }, "folder"),
        "import.commit",
      );
      operation.attr({ "import.kind": kind, "import.books": books.length });

      finished(
        t("Ready"),
        t("{count} books imported as {kind} into {root}.", {
          count: books.length,
          kind,
          root: into,
        }),
        false,
      );
      toasts.update(toast, {
        title: t("Project imported"),
        message: t("{count} books", { count: books.length }),
        tone: "success",
      });
      // The projects index learns about the project HERE, at the one moment
      // this device knows a new one exists — before the list is told to
      // re-read, so the row it draws is the one just written.
      await run(rememberProject(services.projectsRoot, into, undefined));
      operation.end("passed", { "import.phase": "complete" });
      props.onImported();
    })().catch((cause: unknown) => {
      const message = describe(cause);
      operation.end("failed", {
        "import.phase": phase,
        "import.reason": reasonOf(cause) ?? "Unknown",
      });
      finished(t("Couldn't bring it in"), message, true);
      toasts.update(toast, { title: t("Import failed"), message, tone: "error", autoClose: false });
    });
  };

  /**
   * The browser's way in: pick, write the bytes into staging, then the same
   * classify and commit the native path runs. One function for both sources —
   * a zip and a folder differ only in which picker produced the files.
   */
  const importPicked = (title: string, source: "folder" | "zip"): void => {
    const toast = toasts.progress({ title: t("Importing project"), message: t("Choosing files") });
    running(title, "pick");
    const operation = services.composition.observability.operation("import.resource", {
      "import.source": source,
      "import.host": services.hostInfo.kind(),
    });
    let phase = "pick";
    const run = async <A, E>(
      effect: Effect.Effect<A, E, Domain | Scope.Scope>,
      stageName?: string,
    ): Promise<A> => {
      const stop = stageName === undefined ? undefined : operation.span(stageName);
      try {
        return await services.run(Effect.provideService(effect, Observability, operation));
      } finally {
        stop?.();
      }
    };

    void (async () => {
      const intake = await import("#platform/web/intake");
      const picked =
        source === "zip" ? await intake.pickZip(operation) : await intake.pickFolder(operation);
      if (picked === undefined) {
        operation.end("declined", { "import.phase": phase });
        setProgress(undefined);
        toasts.dismiss(toast);
        return;
      }

      running(title, "stage", t("0 of {total} files", { total: picked.files.length }));
      phase = "stage";
      toasts.update(toast, { title: t("Importing project"), message: t("Copying files in") });
      const staged = await run(
        intake.intake(
          services.fileSystem,
          `${services.hostInfo.paths().temp}/import`,
          picked,
          (written, total) =>
            running(
              title,
              "stage",
              t("{written} of {total} files", {
                written,
                total,
              }),
            ),
        ),
        "import.stage",
      );

      running(title, "classify");
      phase = "classify";
      const kind = await run(classify(services.fileSystem, staged), "import.classify");

      running(title, "commit");
      phase = "commit";
      toasts.update(toast, { title: t("Importing project"), message: t("Committing books") });
      const into = `${services.projectsRoot}/${picked.name}`;
      const books = await run(
        commit(services.fileSystem, staged, { root: into }, source),
        "import.commit",
      );
      operation.attr({
        "import.kind": kind,
        "import.books": books.length,
        "import.files": picked.files.length,
      });

      finished(
        t("Ready"),
        t("{count} books imported as {kind} into {root}.", {
          count: books.length,
          kind,
          root: into,
        }),
        false,
      );
      toasts.update(toast, {
        title: t("Project imported"),
        message: t("{count} books", { count: books.length }),
        tone: "success",
      });
      // The projects index learns about the project HERE, at the one moment
      // this device knows a new one exists — before the list is told to
      // re-read, so the row it draws is the one just written.
      await run(rememberProject(services.projectsRoot, into, undefined));
      operation.end("passed", { "import.phase": "complete" });
      props.onImported();
    })().catch((cause: unknown) => {
      const message = describe(cause);
      operation.end("failed", {
        "import.phase": phase,
        "import.reason": reasonOf(cause) ?? "Unknown",
      });
      finished(t("Couldn't bring it in"), message, true);
      toasts.update(toast, { title: t("Import failed"), message, tone: "error", autoClose: false });
    });
  };

  /** Fills the clone dialog with the repositories this session may write. */
  const openClone = (): void => {
    setCloneOpen(true);
    setCloneNote("");
    if (endpoint === null) return;
    void services
      .run(
        Effect.gen(function* () {
          const gitea = yield* Gitea;
          const held = yield* gitea.session(endpoint);
          if (Option.isNone(held)) return [];
          return yield* gitea.listWritableRepos(endpoint);
        }),
      )
      .then((found) => {
        setRepos(found);
        if (found.length === 0)
          setCloneNote(t("Nothing to list yet — sign in under Settings → Cloud first."));
      })
      .catch((cause: unknown) => setCloneNote(describe(cause)));
  };

  /** Clone a remote repository into a new project under the projects root. */
  const clone = (url: string): void => {
    if (url.trim() === "") return;
    const name = lastSegment(url.replace(/\.git$/u, ""));
    const into = `${services.projectsRoot}/${name}`;
    setCloneOpen(false);
    const toast = toasts.progress({ title: t("Cloning {name}", { name }) });
    running(t("Clone from cloud"), "commit");
    const operation = services.composition.observability.operation("import.remote", {
      "import.source": "cloud",
      "import.host": services.hostInfo.kind(),
    });
    let phase = "clone";
    let ended = false;
    const end = (
      verdict: "passed" | "failed",
      attrs: Parameters<typeof operation.end>[1],
    ): void => {
      if (ended) return;
      ended = true;
      operation.end(verdict, attrs);
    };
    const run = async <A, E>(
      effect: Effect.Effect<A, E, Domain | Scope.Scope>,
      stageName: string,
    ): Promise<A> => {
      const stop = operation.span(stageName);
      try {
        return await services.run(Effect.provideService(effect, Observability, operation));
      } finally {
        stop();
      }
    };

    void (async () => {
      const cloned = await run(cloneRepository(url, into), "remote.clone");
      operation.attr({
        "remote.progress.phase": cloned.progress.phase,
        "remote.progress.loaded": cloned.progress.loaded,
        ...(cloned.progress.total === undefined
          ? {}
          : { "remote.progress.total": cloned.progress.total }),
      });
      phase = "register";
      await run(rememberProject(services.projectsRoot, into, undefined), "import.register");
      end("passed", { "import.phase": "complete" });
      finished(t("Ready"), t("Cloned into {root}.", { root: into }), false);
      toasts.update(toast, { title: t("Cloned {name}", { name }), tone: "success" });
      props.onImported();
    })().catch((cause: unknown) => {
      const message = describe(cause);
      end("failed", { "import.phase": phase, "import.reason": reasonOf(cause) ?? "Unknown" });
      finished(t("Couldn't bring it in"), message, true);
      toasts.update(toast, {
        title: t("Clone failed"),
        message,
        tone: "error",
        autoClose: false,
      });
    });
  };

  /** True when the host reads a real path; false when the browser must copy. */
  const nativeFolder = capabilities.nativeDisk && capabilities.dialogs;

  const folderExplainer = (): string =>
    nativeFolder
      ? t("Copy a Burrito, Resource Container or folder of USFM into Sefer.")
      : t(
          "Choose a folder and the browser copies its files into Sefer's own storage — the files on your disk are left alone.",
        );

  const cloudExplainer = (): string => {
    if (endpoint === null)
      return t("No WACS endpoint: set one in Settings, or VITE_SEFER_WACS_WEB_URL at build.");
    return t("Clone a repository you can write from {host}.", { host: endpoint });
  };

  const sources = (): readonly SourceCard[] => [
    {
      id: "zip",
      icon: <FileArchive size={18} aria-hidden="true" />,
      title: t("Import zip"),
      explainer: t(
        "A .zip of a Burrito, a Resource Container or a folder of USFM. It is read here, in the page.",
      ),
      action: t("Choose file"),
      available: true,
      onRun: () => importPicked(t("Import from a zip"), "zip"),
    },
    {
      id: "folder",
      icon: <FolderOpen size={18} aria-hidden="true" />,
      title: t("Open folder"),
      explainer: folderExplainer(),
      action: t("Choose folder"),
      available: true,
      onRun: () =>
        nativeFolder ? importFolder() : importPicked(t("Import from a folder"), "folder"),
    },
    {
      id: "cloud",
      icon: <CloudDownload size={18} aria-hidden="true" />,
      title: t("Clone from cloud"),
      explainer: cloudExplainer(),
      action: t("Browse repositories"),
      available: endpoint !== null,
      onRun: openClone,
    },
  ];

  return (
    <>
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-import-hub>
        <For each={sources()}>
          {(source) => (
            <li class="contents">
              <Card
                class="flex flex-col gap-2"
                data-source={source.id}
                data-available={String(source.available)}
              >
                <div class="flex items-center gap-2">
                  <span
                    class="flex size-8 items-center justify-center rounded-md bg-surface-secondary text-on-surface-secondary"
                    aria-hidden="true"
                  >
                    {source.icon}
                  </span>
                  <h3 class="text-small font-semibold text-on-surface-primary">{source.title}</h3>
                </div>
                <p class="min-h-10 text-smallest text-on-surface-tertiary">{source.explainer}</p>
                <Button
                  size="sm"
                  class="mt-auto self-start"
                  disabled={!source.available}
                  onClick={source.onRun}
                >
                  {source.action}
                </Button>
              </Card>
            </li>
          )}
        </For>
      </ul>

      <Dialog
        open={cloneOpen()}
        onOpenChange={setCloneOpen}
        title={t("Clone from cloud")}
        description={t("Repositories this signed-in account can write.")}
        footer={<Button onClick={() => setCloneOpen(false)}>{t("Close")}</Button>}
      >
        <div class="space-y-3">
          <Show when={cloneNote() !== ""}>
            <p class="text-small text-on-surface-tertiary">{cloneNote()}</p>
          </Show>
          <Show when={repos().length > 0}>
            <ul class="max-h-64 space-y-1 overflow-y-auto" data-clone-repos={repos().length}>
              <For each={repos()}>
                {(repo) => (
                  <li class="flex items-center gap-3 rounded-md border border-surface-border px-3 py-2">
                    <strong class="truncate text-small">{repo.fullName}</strong>
                    <Button size="sm" class="ms-auto" onClick={() => clone(repo.cloneUrl)}>
                      {t("Clone")}
                    </Button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <form
            class="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              clone(cloneUrl());
            }}
          >
            <Input
              type="url"
              wrapperClass="min-w-0 flex-1"
              placeholder={t("…or paste a repository URL")}
              value={cloneUrl()}
              onInput={(event) => setCloneUrl(event.currentTarget.value)}
            />
            <Button type="submit" variant="primary">
              {t("Clone")}
            </Button>
          </form>
        </div>
      </Dialog>

      <Show when={progress()}>
        {(state) => (
          <Dialog
            open
            onOpenChange={(open) => {
              // A running import cannot be dismissed: the dialog IS the record
              // that something is writing to the project root.
              if (!open && state().step === undefined) setProgress(undefined);
            }}
            title={state().title}
            footer={
              <Show when={state().step === undefined}>
                <Button variant="primary" onClick={() => setProgress(undefined)}>
                  {t("Close")}
                </Button>
              </Show>
            }
          >
            <Show
              when={state().step}
              fallback={
                <p
                  class={cx(
                    "break-words text-small",
                    state().failed ? "text-on-surface-error" : "text-on-surface-secondary",
                  )}
                  data-import-state={state().failed ? "failed" : "done"}
                >
                  {state().message}
                </p>
              }
            >
              {(step) => (
                <ol class="space-y-1" data-import-step={step()}>
                  <For each={STEPS}>
                    {(each) => {
                      const position = (): number => STEPS.indexOf(each) - STEPS.indexOf(step());
                      const tone = (): string => {
                        if (position() > 0) return "text-on-surface-tertiary";
                        if (position() === 0) return "font-medium text-on-surface-primary";
                        return "text-on-surface-secondary";
                      };
                      return (
                        <li class={cx("flex items-center gap-2 text-small", tone())}>
                          <span aria-hidden="true">{position() < 0 ? "✓" : "•"}</span>
                          {t(STEP_LABEL[each])}
                          <Show when={position() === 0 && state().detail !== undefined}>
                            <span class="ms-auto text-smallest tabular-nums text-on-surface-tertiary">
                              {state().detail}
                            </span>
                          </Show>
                        </li>
                      );
                    }}
                  </For>
                </ol>
              )}
            </Show>
          </Dialog>
        )}
      </Show>
    </>
  );
}
