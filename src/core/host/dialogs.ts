/**
 * Dialogs — asking the person something the application cannot decide (seams 1.6).
 *
 * Every open, import and destructive flow needs one of these three questions,
 * and each host answers them with completely different machinery: a native
 * dialog on desktop, the File System Access API on Web, a script in a test.
 * Keeping them behind one small port is what lets those flows be written once.
 *
 * The returned strings are paths on a host with a real filesystem. On Web they
 * are display names of picked handles, which is a known gap — see the TODO in
 * `src/platform/web/dialogs.ts`.
 */
import { Context, Effect, Layer, Option } from "effect";

/** One entry in a file picker's type list, in the shape both hosts can render. */
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
  /** `None` when the person cancelled, or when this host has no picker. */
  readonly pickFolder: (title: string) => Effect.Effect<Option.Option<string>>;
  /** Empty when cancelled or unsupported; never fails. */
  readonly pickFiles: (filters: readonly FileFilter[]) => Effect.Effect<readonly string[]>;
  /** `false` is the safe answer, so an absent dialog declines rather than proceeds. */
  readonly confirm: (message: string, options?: ConfirmOptions) => Effect.Effect<boolean>;
}

export class Dialogs extends Context.Service<Dialogs, DialogsService>()("Dialogs") {}

/**
 * Scripted answers for tests and dev pages. This is a real implementation of
 * the port with a deterministic host, not a mock: the same question always
 * gets the same configured answer, and the defaults are the refusing ones.
 */
export interface DialogAnswers {
  readonly folder?: string | undefined;
  readonly files?: readonly string[] | undefined;
  readonly confirm?: boolean | undefined;
}

export const HeadlessDialogsLive = (answers: DialogAnswers = {}): Layer.Layer<Dialogs> =>
  Layer.succeed(Dialogs, {
    pickFolder: () => Effect.succeed(Option.fromUndefinedOr(answers.folder)),
    pickFiles: () => Effect.succeed(answers.files ?? []),
    confirm: () => Effect.succeed(answers.confirm ?? false),
  });
