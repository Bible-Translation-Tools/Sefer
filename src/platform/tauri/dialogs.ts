/**
 * The desktop host's Dialogs — one plugin call each.
 *
 * The handle-to-path gap the Web implementation carries does not exist here:
 * `open` returns real absolute paths, so a folder a translator picks is a
 * folder the `FileSystem` layer can read. That is the single biggest
 * difference between the two hosts' open flows.
 *
 * Every method is contractually infallible, so a plugin rejection becomes the
 * refusing answer (`None` / `[]` / `false`) rather than a failure: a cancelled
 * dialog and a broken dialog lead to the same place, which is "do nothing".
 */
import { confirm as tauriConfirm, open, save } from "@tauri-apps/plugin-dialog";
import { Effect, Layer, Option } from "effect";

import { Dialogs } from "#core/host/dialogs";

const asFilters = (
  filters: readonly { readonly name: string; readonly extensions: readonly string[] }[],
): { name: string; extensions: string[] }[] =>
  filters.map((filter) => ({
    name: filter.name,
    // The plugin wants bare extensions; a caller may spell them either way.
    extensions: filter.extensions.map((extension) => extension.replace(/^\./u, "")),
  }));

export const TauriDialogsLive: Layer.Layer<Dialogs> = Layer.succeed(Dialogs, {
  pickFolder: (title) =>
    Effect.orElseSucceed(
      Effect.map(
        Effect.tryPromise(() => open({ directory: true, multiple: false, title })),
        (picked) => (typeof picked === "string" ? Option.some(picked) : Option.none<string>()),
      ),
      () => Option.none<string>(),
    ),

  pickFiles: (filters) =>
    Effect.orElseSucceed(
      Effect.map(
        Effect.tryPromise(() => open({ multiple: true, filters: asFilters(filters) })),
        (picked): readonly string[] => (Array.isArray(picked) ? picked : []),
      ),
      () => [],
    ),

  /**
   * The save half, and the thing Web cannot do: a real absolute path, chosen
   * by the person, that the `FileSystem` layer can then write through. The
   * plugin already warns about overwriting, so nothing here asks twice.
   *
   * `defaultPath` carries the suggested name rather than a folder, which is
   * how the plugin pre-fills the name field and lets the OS remember where
   * this kind of thing was last saved.
   */
  pickSaveFile: (title, suggestedName, filters) =>
    Effect.orElseSucceed(
      Effect.map(
        Effect.tryPromise(() =>
          save({ title, defaultPath: suggestedName, filters: asFilters(filters) }),
        ),
        (picked) => (typeof picked === "string" ? Option.some(picked) : Option.none<string>()),
      ),
      () => Option.none<string>(),
    ),

  // `false` is the safe answer, so a dialog that will not open declines.
  confirm: (message, options) =>
    Effect.orElseSucceed(
      Effect.tryPromise(() =>
        tauriConfirm(message, {
          ...(options?.title === undefined ? {} : { title: options.title }),
          ...(options?.confirmLabel === undefined ? {} : { okLabel: options.confirmLabel }),
          ...(options?.cancelLabel === undefined ? {} : { cancelLabel: options.cancelLabel }),
        }),
      ),
      () => false,
    ),
});
