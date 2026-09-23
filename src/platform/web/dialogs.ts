/**
 * The Web host's Dialogs: `window.confirm` and the File System Access API,
 * each used only when the browser actually has it.
 *
 * Deliberately thin. The point is the seam, not a good browser file-picking
 * experience: a browser that cannot pick answers `None`/`[]` with a note, so
 * the calling flow shows "not supported here" instead of failing.
 *
 * TODO(seam): the pickers return `FileSystemHandle`s, not paths. We surface
 * `handle.name`, which is enough to show and enough for OPFS-rooted projects,
 * but a real Web open flow needs a handle registry that maps a picked handle
 * to a path the OPFS FileSystem layer can read. That registry belongs with
 * the project/library slice, not here.
 */
import { Effect, Layer, Option } from "effect";

import { Dialogs, type FileFilter } from "#core/host/dialogs";
import { Observability } from "#core/observability";

const RULE = "dialogs";

interface PickedHandle {
  readonly name: string;
}

type DirectoryPicker = (options?: { readonly id?: string }) => Promise<PickedHandle>;

interface FilePickerType {
  readonly description: string;
  readonly accept: Readonly<Record<string, readonly string[]>>;
}

type FilePicker = (options?: {
  readonly multiple?: boolean;
  readonly types?: readonly FilePickerType[];
}) => Promise<readonly PickedHandle[]>;

interface Pickers {
  readonly showDirectoryPicker?: DirectoryPicker;
  readonly showOpenFilePicker?: FilePicker;
  readonly confirm?: (message?: string) => boolean;
}

// SAFETY: a read-only view of three optional globals; every use checks the
// property is a function before calling it, so an absent global stays absent.
const pickers = (): Pickers => globalThis as Pickers;

/**
 * Browsers describe accepted files by MIME type mapped to extensions. We have
 * only extensions, so one wildcard MIME entry carries them all and the
 * description names the filter.
 */
const asTypes = (filters: readonly FileFilter[]): readonly FilePickerType[] =>
  filters.map((filter) => ({
    description: filter.name,
    accept: { "*/*": filter.extensions.map((extension) => `.${extension.replace(/^\./, "")}`) },
  }));

export const WebDialogsLive: Layer.Layer<Dialogs> = Layer.effect(
  Dialogs,
  Effect.gen(function* () {
    const observability = yield* Effect.serviceOption(Observability);
    const note = (verdict: "declined" | "consumed", detail: string): void => {
      Option.getOrUndefined(observability)?.note(RULE, verdict, detail);
    };

    return {
      pickFolder: (title) =>
        Effect.gen(function* () {
          const pick = pickers().showDirectoryPicker;
          if (typeof pick !== "function") {
            note("declined", "pickFolder unsupported");
            return Option.none();
          }
          const picked = yield* Effect.orElseSucceed(
            Effect.tryPromise(() => pick({ id: title })),
            () => undefined,
          );
          if (picked === undefined) {
            note("declined", "pickFolder cancelled");
            return Option.none();
          }
          note("consumed", "pickFolder");
          return Option.some(picked.name);
        }),

      pickFiles: (filters) =>
        Effect.gen(function* () {
          const pick = pickers().showOpenFilePicker;
          if (typeof pick !== "function") {
            note("declined", "pickFiles unsupported");
            return [];
          }
          const picked = yield* Effect.orElseSucceed(
            Effect.tryPromise(() => pick({ multiple: true, types: asTypes(filters) })),
            () => undefined,
          );
          if (picked === undefined) {
            note("declined", "pickFiles cancelled");
            return [];
          }
          note("consumed", `pickFiles ${picked.length}`);
          return picked.map((handle) => handle.name);
        }),

      /**
       * Always `None`, and that is the honest Web answer rather than a gap.
       *
       * A browser has no path to hand back: `showSaveFilePicker` would give us
       * a handle, and the OPFS `FileSystem` layer cannot write through one.
       * Web saves a copy by downloading it (`src/app/projectCommands.ts`), so
       * the caller reads `None` as "use the download" — which is why this
       * notes `declined` rather than looking for a picker it could not use.
       */
      pickSaveFile: (_title, suggestedName) =>
        Effect.sync(() => {
          note("declined", `pickSaveFile unsupported: ${suggestedName} goes to a download`);
          return Option.none();
        }),

      confirm: (message) =>
        Effect.sync(() => {
          const ask = pickers().confirm;
          if (typeof ask !== "function") {
            note("declined", "confirm unsupported");
            return false;
          }
          return ask(message);
        }),
    };
  }),
);
