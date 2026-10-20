import { confirm as tauriConfirm, open, save } from "@tauri-apps/plugin-dialog";
import { Effect, Layer, Option } from "effect";

import { Dialogs } from "#core/host/dialogs";

const asFilters = (
  filters: readonly { readonly name: string; readonly extensions: readonly string[] }[],
): { name: string; extensions: string[] }[] =>
  filters.map((filter) => ({
    name: filter.name,
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
