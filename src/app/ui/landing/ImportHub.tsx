import type { JSX } from "@solidjs/web";
import { useNavigate } from "@tanstack/solid-router";
import BookCopy from "lucide-solid/icons/book-copy";
import CloudDownload from "lucide-solid/icons/cloud-download";
import FileArchive from "lucide-solid/icons/file-archive";
import FolderOpen from "lucide-solid/icons/folder-open";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";

import type { RemoteRepo } from "#core/remote/gitea";

import { registerCommand } from "../../commands";
import { describe } from "../../describe";
import { contentHostFor } from "../../endpoints";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Dialog, Input, Menu, MenuItem, cx } from "../primitives";
import {
  STEPS,
  STEP_LABEL,
  cloneRepository,
  importFolder,
  importPicked,
  listCloneRepos,
  type ImportContext,
  type Progress,
} from "./importFlows";

type Picker = (source: "zip" | "folder") => void;

const ImportButtons = (props: { readonly pick: Picker }) => {
  const navigate = useNavigate();
  return (
    <div class="flex flex-wrap items-center justify-center gap-4">
      <Button
        variant="accent"
        size="lg"
        data-testid="import-zip"
        icon={<FileArchive size={24} aria-hidden="true" />}
        onClick={() => props.pick("zip")}
      >
        {t("Import zip")}
      </Button>
      <Button
        variant="accent"
        size="lg"
        data-testid="import-folder"
        icon={<FolderOpen size={24} aria-hidden="true" />}
        onClick={() => props.pick("folder")}
      >
        {t("Import folder")}
      </Button>
      <Button
        variant="accent"
        size="lg"
        data-testid="import-writer"
        icon={<BookCopy size={24} aria-hidden="true" />}
        onClick={() => void navigate({ to: "/migrate" })}
      >
        {t("Migrate from Writer")}
      </Button>
    </div>
  );
};

const ImportMenu = (props: {
  readonly pick: Picker;
  readonly endpoint: string | null;
  readonly trigger: JSX.Element | undefined;
  readonly onClone: () => void;
}) => {
  const navigate = useNavigate();
  return (
    <Menu label={t("Import")} side="bottom" align="end" class="w-56" trigger={props.trigger}>
      <MenuItem
        data-testid="import-zip"
        icon={<FileArchive aria-hidden="true" />}
        onSelect={() => props.pick("zip")}
      >
        {t("Import zip")}
      </MenuItem>
      <MenuItem
        data-testid="import-folder"
        icon={<FolderOpen aria-hidden="true" />}
        onSelect={() => props.pick("folder")}
      >
        {t("Import folder")}
      </MenuItem>

      <MenuItem
        data-testid="import-cloud"
        icon={<CloudDownload aria-hidden="true" />}
        disabled={props.endpoint === null}
        title={props.endpoint === null ? t("No WACS server is set for this build.") : undefined}
        onSelect={props.onClone}
      >
        {t("Clone from cloud")}
      </MenuItem>
      <MenuItem
        data-testid="import-writer"
        icon={<BookCopy aria-hidden="true" />}
        onSelect={() => void navigate({ to: "/migrate" })}
      >
        {t("Migrate from Writer")}
      </MenuItem>
    </Menu>
  );
};

const CloneDialog = (props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly note: string;
  readonly repos: readonly RemoteRepo[];
  readonly url: string;
  readonly onUrl: (url: string) => void;
  readonly onClone: (url: string) => void;
}) => (
  <Dialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t("Clone from cloud")}
    description={t("Repositories this signed-in account can write.")}
    footer={<Button onClick={() => props.onOpenChange(false)}>{t("Close")}</Button>}
  >
    <div class="space-y-3">
      <Show when={props.note !== ""}>
        <p class="text-small text-on-surface-tertiary">{props.note}</p>
      </Show>
      <Show when={props.repos.length > 0}>
        <ul class="max-h-64 space-y-1 overflow-y-auto" data-clone-repos={props.repos.length}>
          <For each={props.repos}>
            {(repo) => (
              <li class="flex items-center gap-3 rounded-md border border-surface-border px-3 py-2">
                <strong class="truncate text-small">{repo.fullName}</strong>
                <Button size="sm" class="ms-auto" onClick={() => props.onClone(repo.cloneUrl)}>
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
          props.onClone(props.url);
        }}
      >
        <Input
          type="url"
          wrapperClass="min-w-0 flex-1"
          placeholder={t("…or paste a repository URL")}
          value={props.url}
          onInput={(event) => props.onUrl(event.currentTarget.value)}
        />
        <Button type="submit" variant="primary">
          {t("Clone")}
        </Button>
      </form>
    </div>
  </Dialog>
);

const StepList = (props: {
  readonly step: NonNullable<Progress["step"]>;
  readonly detail: string | undefined;
}) => (
  <ol class="space-y-1" data-import-step={props.step}>
    <For each={STEPS}>
      {(each) => {
        const position = (): number => STEPS.indexOf(each) - STEPS.indexOf(props.step);
        const tone = (): string => {
          if (position() > 0) return "text-on-surface-tertiary";
          if (position() === 0) return "font-medium text-on-surface-primary";
          return "text-on-surface-secondary";
        };
        return (
          <li class={cx("flex items-center gap-2 text-small", tone())}>
            <span aria-hidden="true">{position() < 0 ? "✓" : "•"}</span>
            {t(STEP_LABEL[each])}
            <Show when={position() === 0 && props.detail !== undefined}>
              <span class="ms-auto text-smallest tabular-nums text-on-surface-tertiary">
                {props.detail}
              </span>
            </Show>
          </li>
        );
      }}
    </For>
  </ol>
);

const ProgressDialog = (props: { readonly state: Progress; readonly onClose: () => void }) => (
  <Dialog
    open
    onOpenChange={(open) => {
      if (!open && props.state.step === undefined) props.onClose();
    }}
    title={props.state.title}
    footer={
      <Show when={props.state.step === undefined}>
        <Button variant="primary" onClick={props.onClose}>
          {t("Close")}
        </Button>
      </Show>
    }
  >
    <Show
      when={props.state.step}
      fallback={
        <p
          class={cx(
            "break-words text-small",
            props.state.failed ? "text-on-surface-error" : "text-on-surface-secondary",
          )}
          data-import-state={props.state.failed ? "failed" : "done"}
        >
          {props.state.message}
        </p>
      }
    >
      {(step) => <StepList step={step()} detail={props.state.detail} />}
    </Show>
  </Dialog>
);

type HubServices = ImportContext["services"];

const createImportProgress = (
  services: HubServices,
  onImported: () => void,
  open: (root: string) => void,
) => {
  const [progress, setProgress] = createSignal<Progress | undefined>(undefined, {
    name: "importProgress",
  });
  const context: ImportContext = {
    services,
    running: (title, step, detail) =>
      setProgress({ title, step, message: "", failed: false, detail }),
    finished: (title, message, failed) => setProgress({ title, step: undefined, message, failed }),
    clear: () => setProgress(undefined),
    onImported,
    open,
  };
  return { progress, context };
};

const createCloneState = (services: HubServices, endpoint: string | null) => {
  const [cloneOpen, setCloneOpen] = createSignal(false, { name: "cloneOpen" });
  const [repos, setRepos] = createSignal<readonly RemoteRepo[]>([], { name: "cloneRepos" });
  const [cloneNote, setCloneNote] = createSignal("", { name: "cloneNote" });
  const [cloneUrl, setCloneUrl] = createSignal("", { name: "cloneUrl" });

  const openClone = (): void => {
    setCloneOpen(true);
    setCloneNote("");
    if (endpoint === null) return;
    void listCloneRepos(services, endpoint)
      .then((found) => {
        setRepos(found);
        if (found.length === 0)
          setCloneNote(t("Nothing to list yet — sign in under Settings → Cloud first."));
      })
      .catch((cause: unknown) => setCloneNote(describe(cause)));
  };
  return { cloneOpen, setCloneOpen, repos, cloneNote, cloneUrl, setCloneUrl, openClone };
};

export function ImportHub(props: {
  readonly onImported?: () => void;
  readonly variant?: "buttons" | "menu";
  readonly trigger?: JSX.Element;
}) {
  const shell = useShell();
  const { services } = shell;
  const capabilities = services.hostInfo.capabilities();
  const endpoint = contentHostFor(services.settings);

  const navigate = useNavigate();
  const { progress, context } = createImportProgress(
    services,
    () => props.onImported?.(),
    (root) => void navigate({ to: "/project/$slug", params: { slug: shell.slugFor(root) } }),
  );
  const { cloneOpen, setCloneOpen, repos, cloneNote, cloneUrl, setCloneUrl, openClone } =
    createCloneState(services, endpoint);

  const clone = (url: string): void => {
    if (url.trim() === "") return;
    setCloneOpen(false);
    cloneRepository(context, url);
  };

  const nativeFolder = capabilities.nativeDisk && capabilities.dialogs;

  const pick: Picker = (source) => {
    if (source === "zip") importPicked(context, t("Import from a zip"), "zip");
    else if (nativeFolder) importFolder(context);
    else importPicked(context, t("Import from a folder"), "folder");
  };

  if (untrack(() => props.variant) === "menu")
    onCleanup(
      registerCommand({
        id: "project.open",
        title: t("Open project…"),
        keys: "Mod-o",
        run: () => pick("folder"),
      }),
    );

  return (
    <>
      <Show when={props.variant === "menu"} fallback={<ImportButtons pick={pick} />}>
        <ImportMenu pick={pick} endpoint={endpoint} trigger={props.trigger} onClone={openClone} />
      </Show>

      <CloneDialog
        open={cloneOpen()}
        onOpenChange={setCloneOpen}
        note={cloneNote()}
        repos={repos()}
        url={cloneUrl()}
        onUrl={setCloneUrl}
        onClone={clone}
      />

      <Show when={progress()}>
        {(state) => <ProgressDialog state={state()} onClose={context.clear} />}
      </Show>
    </>
  );
}
