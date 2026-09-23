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
  /**
   * Where to WRITE a file the person will look for later — the save half of
   * `pickFiles`. `None` when they cancelled, and `None` on a host that has no
   * such place: a browser cannot name a path, so Web answers `None` and the
   * caller hands the same bytes to a download instead.
   *
   * That is the whole reason this is a separate member rather than a flag on
   * `pickFiles`: "pick a file that exists" and "name a file that does not"
   * are different questions, and only one of them has a Web answer.
   */
  readonly pickSaveFile: (
    title: string,
    suggestedName: string,
    filters: readonly FileFilter[],
  ) => Effect.Effect<Option.Option<string>>;
  /** `false` is the safe answer, so an absent dialog declines rather than proceeds. */
  readonly confirm: (message: string, options?: ConfirmOptions) => Effect.Effect<boolean>;
}

export class Dialogs extends Context.Service<Dialogs, DialogsService>()("Dialogs") {}

/**
 * Scripted answers for tests and dev pages. This is a real implementation of
 * the port with a deterministic host, not a mock: the same question always
 * gets the same configured answer, and the defaults are the refusing ones.
 */
interface DialogAnswers {
  readonly folder?: string | undefined;
  readonly files?: readonly string[] | undefined;
  readonly savePath?: string | undefined;
  readonly confirm?: boolean | undefined;
}

const HeadlessDialogsLive = (answers: DialogAnswers = {}): Layer.Layer<Dialogs> =>
  Layer.succeed(Dialogs, {
    pickFolder: () => Effect.succeed(Option.fromUndefinedOr(answers.folder)),
    pickFiles: () => Effect.succeed(answers.files ?? []),
    pickSaveFile: () => Effect.succeed(Option.fromUndefinedOr(answers.savePath)),
    confirm: () => Effect.succeed(answers.confirm ?? false),
  });
