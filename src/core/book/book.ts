// book.ts
//
// The Book port: one addressable USFM document and the ONE write path into
// its canonical text. Every module that edits — keyboard, paste, satellite
// windows, fixes, search-and-replace, revert, recovery, multi-book operations —
// ends in `book.apply(changes, origin, trust)`. There is no second write path,
// which is what lets Save, Recovery, ProjectAnalysis and the UI subscribe once
// and trust that they saw every edit.
//
// Two implementations satisfy the port: the plain in-memory Book here (text
// held as a `Source`; no rules, no history) and the editor-backed Book in
// `src/editor`, whose canonical text is a CodeMirror state and whose `apply`
// runs the editing phases before accepting. Readers cannot tell them apart.
//
// Publication is synchronous and explicit — a Set of subscribers run in order
// after acceptance, never a bus or an async queue — because the keystroke path
// (phases → analyze → mutate → publish) must finish inside one frame.

import { Data, Effect, FileSystem, Option, Result, type PlatformError } from "effect";

import { Observability, type ObservabilityService } from "../observability";
import {
  apply as applyToSource,
  decode,
  type Change,
  type Source,
  type SourceChangeError,
  type SourceDecodeError,
  type SourceStamp,
} from "../source/source";

/** The `\id` code when the text declares one, otherwise the file stem. */
export type BookId = string;

/** A scripture reference in the vocabulary the shell and Findings navigate by. */
export interface Ref {
  readonly book: BookId;
  readonly chapter: number;
  readonly verse?: number;
}

/**
 * Who asked for an edit. Trusted origins (fix, format, project.*, recovery,
 * revert) bypass the keyboard guards the way a fix-it does; untrusted ones are
 * judged by every rule. The editor records the origin as CodeMirror's
 * `userEvent`, so it is a string rather than an enum.
 */
export type Origin =
  | "keyboard"
  | "paste"
  | "window"
  | "fix"
  | "format"
  | "overlay"
  | "replace"
  | "recovery"
  | "revert"
  | `project.${string}`
  | (string & {});

export type Trust = { readonly trusted: false } | { readonly trusted: true; readonly by: string };

export const UNTRUSTED: Trust = { trusted: false };

export const trustedBy = (by: string): Trust => ({ trusted: true, by });

/** What an accepted edit did to a Book, in stamps. Refusals carry no receipt. */
export interface Receipt {
  readonly before: SourceStamp;
  readonly after: SourceStamp;
  readonly origin: Origin;
}

/**
 * Why an edit did not land. `rule` names the admission rule (or `source.apply`
 * for the plain Book's range checks) so a trace can say which door closed;
 * `reason` is that rule's own vocabulary.
 */
export class Refusal extends Data.TaggedError("Refusal")<{
  readonly rule: string;
  readonly reason: string;
  readonly description: string;
}> {}

/** Undo history, present only when a CodeMirror state holds the text. */
export interface History {
  undo(): boolean;
  redo(): boolean;
  depth(): { readonly undo: number; readonly redo: number };
}

export type ChangeListener = (receipt: Receipt, changes: readonly Change[]) => void;

export interface Book {
  readonly id: BookId;
  readonly path: string;
  /** Canonical text and stamp, from whichever seat holds it. */
  source(): Source;
  /**
   * The one write path. `changes` are in the coordinates of the text BEFORE
   * the edit (CodeMirror's change-set convention) and must not overlap.
   * Synchronous: returns after every subscriber has run.
   */
  apply(
    changes: Change | readonly Change[],
    origin: Origin,
    trust?: Trust,
  ): Result.Result<Receipt, Refusal>;
  /** Synchronous fan-out in subscription order, after acceptance. */
  changes(fn: ChangeListener): () => void;
  /** CodeMirror history when instantiated; `null` for the plain Book. */
  history(): History | null;
}

const ID_MARKER = /^\\id[ \t]+(\S+)/;

const fileStem = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

export const identifyBook = (text: string, path: string): BookId =>
  ID_MARKER.exec(text)?.[1] ?? fileStem(path);

export const asChangeList = (changes: Change | readonly Change[]): readonly Change[] =>
  // SAFETY: the parameter is a Change or a readonly Change[]; when it is not an
  // array it can only be the single Change.
  Array.isArray(changes) ? changes : [changes as Change];

const refuse = (error: SourceChangeError): Refusal =>
  new Refusal({ rule: "source.apply", reason: error.reason, description: error.description });

/**
 * Applies a change list to a Source. The list is in before-text coordinates,
 * so it is applied back to front: each later range is untouched by the
 * splices before it. Overlapping ranges are refused as out of range once the
 * earlier splice has moved them.
 */
export const applyAll = (
  source: Source,
  changes: readonly Change[],
): Result.Result<Source, Refusal> => {
  const ordered = [...changes].sort((a, b) => b.from - a.from);
  let current = source;
  for (const change of ordered) {
    const next = applyToSource(current, change);
    if (Result.isFailure(next)) return Result.fail(refuse(next.failure));
    // Each splice counts one revision in Source; a Book edit is one revision,
    // so the loop keeps the text and lets the caller stamp it once below.
    current = { text: next.success.text, stamp: source.stamp, form: source.form };
  }
  return Result.succeed({
    text: current.text,
    stamp: { revision: source.stamp.revision + 1, length: current.text.length },
    // The disk form is a property of the bytes, not of the edit: it survives
    // every apply and is only ever set by `decode`.
    form: source.form,
  });
};

/**
 * A small subscriber set shared by both Book implementations: snapshot the set
 * before iterating so a listener may unsubscribe itself, and never let one
 * listener's throw hide the edit from the rest.
 */
export const makeListeners = (): {
  add: (fn: ChangeListener) => () => void;
  publish: (receipt: Receipt, changes: readonly Change[]) => void;
} => {
  const set = new Set<ChangeListener>();
  return {
    add: (fn) => {
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    publish: (receipt, changes) => {
      for (const fn of Array.from(set)) fn(receipt, changes);
    },
  };
};

/**
 * The plain Book: text held as a `Source`, no admission rules beyond Source's
 * own, no history. Used for census, project analysis, search and multi-book
 * operations over books the user is not editing.
 */
export const makeBook = (
  path: string,
  initial: Source,
  observability?: ObservabilityService,
): Book => {
  const id = identifyBook(initial.text, path);
  const listeners = makeListeners();
  let current = initial;

  return {
    id,
    path,
    source: () => current,
    apply: (changes, origin) => {
      const list = asChangeList(changes);
      const before = current.stamp;
      const next = applyAll(current, list);
      if (Result.isFailure(next)) {
        observability?.note("book.apply", "refused", next.failure.reason, {
          "book.id": id,
          "book.origin": origin,
          "book.revision": before.revision,
        });
        return Result.fail(next.failure);
      }
      current = next.success;
      const receipt: Receipt = { before, after: current.stamp, origin };
      observability?.note("book.apply", "rewrote", undefined, {
        "book.id": id,
        "book.origin": origin,
        "book.revision": receipt.after.revision,
        "book.revision_before": before.revision,
        "book.changes": list.length,
      });
      listeners.publish(receipt, list);
      return Result.succeed(receipt);
    },
    changes: listeners.add,
    history: () => null,
  };
};

export const openBook = (
  path: string,
): Effect.Effect<Book, PlatformError.PlatformError | SourceDecodeError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = yield* Effect.serviceOption(Observability);
    const bytes = yield* fileSystem.readFile(path);
    const source = yield* Effect.fromResult(decode(bytes));
    return makeBook(path, source, Option.getOrUndefined(observability));
  });
