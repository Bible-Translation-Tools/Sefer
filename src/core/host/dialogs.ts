import { Context, Effect, Option } from "effect";

export interface FileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
}

export interface ConfirmOptions {
  readonly title?: string | undefined;
  readonly confirmLabel?: string | undefined;
  readonly cancelLabel?: string | undefined;
}

export interface DialogsService {
  readonly pickFolder: (title: string) => Effect.Effect<Option.Option<string>>;
  readonly pickFiles: (filters: readonly FileFilter[]) => Effect.Effect<readonly string[]>;
  readonly pickSaveFile: (
    title: string,
    suggestedName: string,
    filters: readonly FileFilter[],
  ) => Effect.Effect<Option.Option<string>>;
  readonly confirm: (message: string, options?: ConfirmOptions) => Effect.Effect<boolean>;
}

export class Dialogs extends Context.Service<Dialogs, DialogsService>()("Dialogs") {}
