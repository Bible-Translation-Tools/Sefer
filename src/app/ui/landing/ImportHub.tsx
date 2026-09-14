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
 * Cloning is `cloneRepository` (`src/core/remote/clone.ts`) over the Gitea
 * session the cloud panel already holds — this screen does not log anyone in,
 * it only spends a session that exists.
 */

import type { JSX } from "@solidjs/web";
import { Effect, Option } from "effect";
import CloudDownload from "lucide-solid/icons/cloud-download";
import FileArchive from "lucide-solid/icons/file-archive";
import FolderOpen from "lucide-solid/icons/folder-open";
import { For, Show, createSignal } from "solid-js";

import { cloneRepository } from "../../../core/remote/clone";
import { Gitea, type RemoteRepo } from "../../../core/remote/gitea";
import { classify, commit, stage } from "../../../core/resources/import";
import { env, giteaHostFor } from "../../env";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, Dialog, Input, cx, toasts } from "../primitives";

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
}

const lastSegment = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/**
 * A rejection as one line. `services.run` rejects with the fiber's failure,
 * whose own string already carries a tagged error's reason and description;
 * reading the fields would mean asserting a shape the promise type lacks.
 */
const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

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
  const giteaHost = giteaHostFor(services.hostInfo.kind());
  const webNeedsProxy = services.hostInfo.kind() === "web" && env.gitCorsProxyUrl === null;

  const [progress, setProgress] = createSignal<Progress | undefined>(undefined, {
    name: "importProgress",
  });
  const [cloneOpen, setCloneOpen] = createSignal(false, { name: "cloneOpen" });
  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloneRepos" });
  const [cloneNote, setCloneNote] = createSignal("", { name: "cloneNote" });
  const [cloneUrl, setCloneUrl] = createSignal("", { name: "cloneUrl" });

  const running = (title: string, step: Step): void => {
    setProgress({ title, step, message: "", failed: false });
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

    void (async () => {
      const picked = await services.run(services.dialogs.pickFolder(t("Select a project folder")));
      const source = Option.getOrUndefined(picked);
      if (source === undefined) {
        setProgress(undefined);
        toasts.dismiss(toast);
        return;
      }

      running(title, "stage");
      toasts.update(toast, { title: t("Importing project"), message: t("Staging files") });
      const staged = await services.run(
        stage(services.fileSystem, [source], `${services.hostInfo.paths().temp}/import`),
      );

      running(title, "classify");
      const kind = await services.run(classify(services.fileSystem, staged));

      running(title, "commit");
      toasts.update(toast, { title: t("Importing project"), message: t("Committing books") });
      const into = `${services.projectsRoot}/${lastSegment(source)}`;
      const books = await services.run(commit(services.fileSystem, staged, { root: into }));

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
      props.onImported();
    })().catch((cause: unknown) => {
      const message = describe(cause);
      finished(t("Couldn't bring it in"), message, true);
      toasts.update(toast, { title: t("Import failed"), message, tone: "error", autoClose: false });
    });
  };

  /** Fills the clone dialog with the repositories this session may write. */
  const openClone = (): void => {
    setCloneOpen(true);
    setCloneNote("");
    if (giteaHost === null) return;
    void services
      .run(
        Effect.gen(function* () {
          const gitea = yield* Gitea;
          const held = yield* gitea.session(giteaHost);
          if (Option.isNone(held)) return [];
          return yield* gitea.listWritableRepos(giteaHost);
        }),
      )
      .then((found) => {
        setRepos(found);
        if (found.length === 0)
          setCloneNote(t("Nothing to list yet — sign in under Settings → Cloud first."));
      })
      .catch((cause: unknown) => setCloneNote(describe(cause)));
  };

  /** Exposed so the catalogue's Download column can reuse the same flow. */
  const clone = (url: string): void => {
    if (url.trim() === "") return;
    const name = lastSegment(url.replace(/\.git$/u, ""));
    const into = `${services.projectsRoot}/${name}`;
    setCloneOpen(false);
    const toast = toasts.progress({ title: t("Cloning {name}", { name }) });
    running(t("Clone from cloud"), "commit");
    void services
      .run(cloneRepository(url, into))
      .then(() => {
        finished(t("Ready"), t("Cloned into {root}.", { root: into }), false);
        toasts.update(toast, { title: t("Cloned {name}", { name }), tone: "success" });
        props.onImported();
      })
      .catch((cause: unknown) => {
        const message = describe(cause);
        finished(t("Couldn't bring it in"), message, true);
        toasts.update(toast, {
          title: t("Clone failed"),
          message,
          tone: "error",
          autoClose: false,
        });
      });
  };

  const folderExplainer = (): string => {
    if (!capabilities.nativeDisk)
      return t(
        "This host cannot read a folder outside its own storage: the browser picker hands back a handle, not a path.",
      );
    if (!capabilities.dialogs) return t("This host has no folder picker.");
    return t("Copy a Burrito, Resource Container or folder of USFM into Sefer.");
  };

  const cloudExplainer = (): string => {
    if (giteaHost === null)
      return t("Cloud is not configured for this build: set VITE_SEFER_GITEA_WEB_HOST.");
    if (webNeedsProxy)
      return t("Transfers need a proxy for this build: set VITE_SEFER_GIT_CORS_PROXY_URL.");
    return t("Clone a repository you can write from {host}.", { host: giteaHost });
  };

  const sources = (): readonly SourceCard[] => [
    {
      id: "zip",
      icon: <FileArchive size={18} aria-hidden="true" />,
      title: t("Import zip"),
      // Honest rather than hopeful: nothing in Sefer reads an archive yet, which
      // is why `ProjectAdmin.export` also refuses `usfm-zip`.
      explainer: t("Sefer has no archive reader yet — unzip it and use Open folder."),
      action: t("Choose file"),
      available: false,
      onRun: () => undefined,
    },
    {
      id: "folder",
      icon: <FolderOpen size={18} aria-hidden="true" />,
      title: t("Open folder"),
      explainer: folderExplainer(),
      action: t("Choose folder"),
      available: capabilities.nativeDisk && capabilities.dialogs,
      onRun: importFolder,
    },
    {
      id: "cloud",
      icon: <CloudDownload size={18} aria-hidden="true" />,
      title: t("Clone from cloud"),
      explainer: cloudExplainer(),
      action: t("Browse repositories"),
      available: giteaHost !== null && !webNeedsProxy,
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
