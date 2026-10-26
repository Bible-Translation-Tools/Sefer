import { useNavigate } from "@tanstack/solid-router";
import BookCopy from "lucide-solid/icons/book-copy";
import FileArchive from "lucide-solid/icons/file-archive";
import FolderOpen from "lucide-solid/icons/folder-open";
import GitBranch from "lucide-solid/icons/git-branch";
import Upload from "lucide-solid/icons/upload";
import { For, Show, createSignal, onCleanup, untrack } from "solid-js";

import { registerCommand } from "../../commands";
import { t } from "../../i18n";
import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { Button, Dialog, cx, toasts } from "../primitives";
import {
  STEPS,
  STEP_LABEL,
  cloneRepository,
  importFolder,
  importPicked,
  type ImportContext,
  type Progress,
} from "./importFlows";

type Picker = (source: "zip" | "folder") => void;

type Dropper = (transfer: DataTransfer) => void;

/** The drop hint split round its three links, so a translation can put them anywhere in it. */
const hintParts = (): readonly string[] =>
  m
    .landing_drop_hint({
      zip: "\u0000zip\u0000",
      folder: "\u0000folder\u0000",
      writer: "\u0000writer\u0000",
    })
    .split("\u0000")
    .filter((part) => part !== "");

const DropZone = (props: { readonly pick: Picker; readonly drop: Dropper }) => {
  const navigate = useNavigate();
  const [over, setOver] = createSignal(false, { name: "importDropOver" });
  return (
    <div
      data-testid="import-drop"
      data-over={over() ? "true" : undefined}
      class={cx(
        "flex flex-col items-center gap-3 rounded-md border-2 border-dashed p-6 text-center transition-colors",
        over() ? "border-brand bg-surface-secondary" : "border-surface-border",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        const into = event.relatedTarget;
        if (!(into instanceof Node && event.currentTarget.contains(into))) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer !== null) props.drop(event.dataTransfer);
      }}
    >
      <Upload size={20} aria-hidden="true" class="text-on-surface-secondary" />
      <p class="text-small text-on-surface-secondary">
        <For each={hintParts()}>
          {(part) => {
            const link = (testid: string, label: string, onClick: () => void) => (
              <Button variant="link" size="flush" data-testid={testid} onClick={onClick}>
                {label}
              </Button>
            );
            if (part === "zip")
              return link("import-zip", m.landing_import_zip_short(), () => props.pick("zip"));
            if (part === "folder")
              return link("import-folder", m.landing_import_folder_short(), () =>
                props.pick("folder"),
              );
            if (part === "writer")
              return link(
                "import-writer",
                m.landing_import_writer_short(),
                () => void navigate({ to: "/migrate" }),
              );
            return part;
          }}
        </For>
      </p>
    </div>
  );
};

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

const createImportProgress = (services: HubServices, onImported: () => void) => {
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
  };
  return { progress, context };
};

export function ImportHub(props: { readonly variant: "buttons" | "drop" }) {
  const shell = useShell();
  const { services } = shell;
  const capabilities = services.hostInfo.capabilities();

  const { progress, context } = createImportProgress(services, () => undefined);

  const nativeFolder = capabilities.nativeDisk && capabilities.dialogs;

  const pick: Picker = (source) => {
    if (source === "zip") importPicked(context, t("Import from a zip"), "zip");
    else if (nativeFolder) importFolder(context);
    else importPicked(context, t("Import from a folder"), "folder");
  };

  const drop: Dropper = (transfer) => {
    // Taken now, inside the drop event: the browser empties the transfer once the handler returns.
    const dropped = {
      entry: transfer.items[0]?.webkitGetAsEntry() ?? null,
      file: transfer.files[0],
    };
    if (dropped.entry?.isDirectory === true)
      importPicked(context, t("Import from a folder"), "folder", dropped);
    else if (dropped.file !== undefined && /\.zip$/iu.test(dropped.file.name))
      importPicked(context, t("Import from a zip"), "zip", dropped);
    else toasts.error({ title: m.landing_drop_not_project(), message: m.landing_drop_one() });
  };

  // The drop zone is the projects page's own import, so it owns `Mod-o` while that page is up.
  if (untrack(() => props.variant) === "drop")
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
      <Show when={props.variant === "drop"} fallback={<ImportButtons pick={pick} />}>
        <DropZone pick={pick} drop={drop} />
      </Show>

      <Show when={progress()}>
        {(state) => <ProgressDialog state={state()} onClose={context.clear} />}
      </Show>
    </>
  );
}

/**
 * A repository URL typed into the catalogue's search: one button that clones it through the same
 * pipeline and progress dialog as every other import. For technicians; most people never see it.
 */
export function CloneFromUrl(props: { readonly url: string }) {
  const { services } = useShell();
  const { progress, context } = createImportProgress(services, () => undefined);
  return (
    <>
      <Button
        variant="primary"
        size="md"
        data-testid="clone-url"
        icon={<GitBranch size={20} aria-hidden="true" />}
        onClick={() => cloneRepository(context, props.url)}
      >
        {m.landing_clone_repository()}
      </Button>
      <Show when={progress()}>
        {(state) => <ProgressDialog state={state()} onClose={context.clear} />}
      </Show>
    </>
  );
}
