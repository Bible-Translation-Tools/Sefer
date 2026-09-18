/**
 * One bound reference, as a read-only editor over the SAME book the reader
 * has open.
 *
 * This is the second place in the shell that touches CodeMirror, and it is
 * allowed to be for the reason the first one is not: there is no Book here.
 * `BookEditor` owns the one Solid/Book subscription because its text is
 * canonical and every keystroke has to become a receipt. A reference is a
 * string read off another resource's disk — nothing writes it, nothing
 * publishes it, and no Book in this process describes it — so the rule it has
 * to keep is simply that it can never be edited, which
 * `src/editor/recipes/reference.ts` says twice.
 *
 * What the pane adds over the recipe is the shell's half of the wiring:
 *
 *  - the TEXT, from `Library.readBook` — the whole book, because the engine
 *    parses a book and not a passage;
 *  - the MODE, from `shell.mode()`, so Regular/USFM switches both panes at
 *    once and a translator comparing markup sees markup on both sides;
 *  - the PLACE, from the main editor's location watcher, so scrolling the
 *    book scrolls the reference beside it.
 *
 * Sync is CHAPTER-level, and by the chapter's own `\c` number rather than by
 * ordinal: the two texts are different files of the same book, so an ordinal
 * into one chapter table means nothing in the other, and the number a
 * translator reads is the only thing they are guaranteed to agree about.
 *
 * ## The paired block
 *
 * Below the chapter, the pane answers a finer question: **"what is that `\q2`
 * in the source text"**. The caret is in a block of the reader's own book; the
 * block at the same ADDRESS in this text is marked.
 *
 * The address is `(sid, where, ordinal)` — which verse, whether the block
 * leads the verse or sits inside it, which one of those — and it is the only
 * thing two texts of different lengths and different words can share. The
 * MARKER is deliberately not part of it: a `\q1` here against a `\q2` there
 * is precisely the correspondence worth seeing, and matching on the name would
 * hide it by never pairing them (`core/galley/overlay.ts`).
 *
 * Both skeletons are fetched ONCE — the source's at mount, the target's per
 * edit — and matched in TypeScript as the caret moves, which is the shape
 * `overlay.md` asks for by name: `targetNodeFor`/`sourceNodeFor` are ~1.4 ms
 * and are for one-off questions, not for a per-keystroke loop.
 *
 * A reference that simply has no file for this book is the ordinary case and
 * gets one line, not an empty editor.
 */

import { Effect, Fiber, Option, Result, Stream } from "effect";
import X from "lucide-solid/icons/x";
import {
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";

import {
  blockAtOffset,
  blockExtents,
  equivalentExtent,
  equivalentVerse,
  verseAtOffset,
  type BlockExtent,
  type Skeleton,
} from "../../../core/galley";
import type { Resource, Role } from "../../../core/resources/library";
import { mountReference, type PairedRange, type ReferenceMount } from "../../../editor";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { IconButton } from "../primitives";
import { bookName } from "./books";
import { metadataOf } from "./project";

// The editor's own stylesheet, for the same reason `BookEditor` imports it:
// the pane paints with `usfm-*` classes and a route that never opens a book
// never loads them.
import "../../../editor/editor.css";

export interface ReferencePaneProps {
  readonly resource: Resource;
  readonly role: Role;
  /** The book the reader has open; the reference is asked for the same one. */
  readonly bookId: string;
  /** The chapter NUMBER at the top of the main editor, when it is known. */
  readonly at: () => number | undefined;
  /** The chapter NUMBER the main editor is clipped to, or `null` for whole-book. */
  readonly clip: () => number | null;
  readonly onUnbind: () => void;
}

/** What the pane is showing, once the read has answered. */
type Held =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "text"; readonly text: string };

export function ReferencePane(props: ReferencePaneProps) {
  const shell = useShell();
  const { services } = shell;
  // Read once, and said so: this component is remounted whenever the binding
  // set or the open book changes (see `ReferenceColumn`), so neither of these
  // can move under a mounted view.
  const resourceId = untrack(() => props.resource.id);
  const bookId = untrack(() => props.bookId);

  const [held, setHeld] = createSignal<Held>({ kind: "loading" }, { name: "referenceText" });
  const [host, setHost] = createSignal<HTMLDivElement | undefined>(undefined, {
    name: "referenceHost",
  });
  const [mounted, setMounted] = createSignal<ReferenceMount | undefined>(undefined, {
    name: "referenceView",
  });

  // The read. One per pane, started at setup rather than from an effect: its
  // two inputs are constants for this instance's whole life, so an effect
  // would be a dependency list with nothing in it. `onCleanup` here is at the
  // COMPONENT's own owner — which is a real owner, unlike one inside an
  // effect callback — so a pane unbound mid-read writes no signal after it is
  // gone.
  let gone = false;
  onCleanup(() => {
    gone = true;
  });
  void services
    .run(Effect.result(services.library.readBook(resourceId, bookId)))
    .then((outcome) => {
      if (gone) return;
      if (Result.isFailure(outcome)) {
        setHeld({ kind: "failed", reason: outcome.failure.description });
        return;
      }
      const text = Option.getOrUndefined(outcome.success);
      setHeld(text === undefined ? { kind: "missing" } : { kind: "text", text });
    });

  // An effect and not a render effect: CodeMirror measures itself, so the view
  // is built after its parent is in the document.
  createEffect(
    () => ({ parent: host(), text: held() }),
    ({ parent, text }) => {
      if (parent === undefined || text.kind !== "text") return;
      const view = mountReference({
        parent,
        text: text.text,
        // This pane's own memo. One per view, for the reason composition gives
        // each Book one: a shared memo between two documents is a memo that
        // never hits.
        analyze: services.galley.memoize(),
        mode: untrack(() => shell.mode()),
        pairBlocks: untrack(() => services.settings.get(shellKeys(services.settings).pairBlocks)),
      });
      setMounted(view);
      // RETURNED, not `onCleanup`: a Solid 2 effect's cleanup is its return
      // value, and `onCleanup` inside an effect callback runs outside any
      // owner and never fires (see `BookEditor` for the same note).
      return () => {
        setMounted(undefined);
        view.destroy();
      };
    },
  );

  // The mode follows the main editor through the recipe's compartment. A
  // render effect, like the editor's own: it is a reconfigure and not a
  // measurement.
  createRenderEffect(
    () => ({ view: mounted(), mode: shell.mode() }),
    ({ view, mode }) => {
      view?.setMode(mode);
    },
  );

  // And the place follows the reader: the clip first (it decides what is on
  // screen at all), then the scroll.
  createEffect(
    () => ({ view: mounted(), clip: props.clip(), at: props.at() }),
    ({ view, clip, at }) => {
      if (view === undefined) return;
      view.clipTo(clip);
      if (at !== undefined) view.showChapter(at);
    },
  );

  // --- the paired block ------------------------------------------------------

  /**
   * This text, registered with the engine so its skeleton can be asked for.
   *
   * Under a PANE-SCOPED id, and as a REFERENCE with `keepText`. Three reasons
   * it is not the registration `bindReferences` already made:
   *
   *  - that one is keyed by FILE PATH, which this pane does not have — it
   *    reads through `Library.readBook(resourceId, bookId)` and never learns
   *    where the bytes came from;
   *  - it may not exist. References are registered when a screen that needs
   *    the corpus opens, and a pane must not silently stop pairing because
   *    nobody happened to have done that yet;
   *  - and it might describe different bytes. The skeleton has to be cut from
   *    the exact text this view is showing, or the offsets it answers with
   *    point into a document nobody is looking at.
   *
   * `updateReference` and not `update`: a reference publishes no findings, and
   * registering another project's book as a proofreading TARGET would put its
   * diagnostics in this project's list.
   */
  const paneId = `sefer.pane.${resourceId}\u0000${bookId}`;

  const sourceSkeleton = createMemo(
    (): Skeleton | undefined => {
      const text = held();
      if (text.kind !== "text") return undefined;
      try {
        services.galley.updateReference(paneId, text.text, true);
        return services.galley.skeleton(paneId);
      } catch {
        // A text the engine will not parse still renders — it is just a
        // reference with no pairing, which is a smaller loss than a blank pane.
        return undefined;
      }
    },
    { name: "referenceSkeleton" },
  );

  const sourceBlocks = createMemo(
    (): readonly BlockExtent[] | undefined => {
      const skeleton = sourceSkeleton();
      const text = held();
      return skeleton === undefined || text.kind !== "text"
        ? undefined
        : blockExtents(skeleton, text.text.length);
    },
    { name: "referenceBlocks" },
  );

  onCleanup(() => {
    services.galley.remove(paneId);
  });

  /**
   * The open book's skeleton, refreshed when the book moves.
   *
   * Keyed on the STAMP and not the text: the stamp is what changes per
   * revision, reading it is free, and a memo over a whole book's text would
   * hold a second copy of it alive. ~0.4 ms per edit, which is the budget
   * `overlay.md` sets for exactly this.
   */
  const targetSkeleton = createMemo(
    (): { readonly skeleton: Skeleton; readonly length: number } | undefined => {
      const book = shell.focused();
      if (book === undefined || shell.stampOf(bookId) === undefined) return undefined;
      try {
        // The book's own text for the length, so the last block reaches the
        // end of the document the caret is moving in rather than a number read
        // off something else.
        return {
          skeleton: services.galley.skeleton(bookId),
          length: book.source().text.length,
        };
      } catch {
        return undefined;
      }
    },
    { name: "targetSkeleton" },
  );

  const targetBlocks = createMemo(
    (): readonly BlockExtent[] | undefined => {
      const held = targetSkeleton();
      return held === undefined ? undefined : blockExtents(held.skeleton, held.length);
    },
    { name: "targetBlocks" },
  );

  /**
   * The row of THIS text that answers where the caret is standing.
   *
   * A memo, so the effect below fires when the BLOCK changes rather than when
   * the caret does — most keystrokes stay inside one block, and a dispatch per
   * arrow key would be a transaction per arrow key in every open pane.
   */
  /**
   * What to mark here, in the order the reader is asking.
   *
   *  1. The EMPTY BLOCK, when that is where the caret is. This is the overlay
   *     case the feature was built for: the block holds no words, so there is
   *     no verse text to point at, and the block IS the answer. Matched on
   *     `(sid, where, ordinal)`, never on the marker — a `\q1` here against a
   *     `\q2` there is the correspondence worth seeing.
   *  2. The VERSE otherwise, matched on its sid alone. A `\p` can run fifteen
   *     verses, and washing all of them is a page of highlight for a question
   *     about one line.
   *  3. The block, when the caret is in one but in no verse — a heading,
   *     front matter.
   */
  const paired = createMemo(
    (): PairedRange | undefined => {
      const at = shell.caret();
      const target = targetSkeleton();
      const blocks = targetBlocks();
      const source = sourceSkeleton();
      const sourceRows = sourceBlocks();
      if (at === undefined || target === undefined || source === undefined) return undefined;

      const here = blocks === undefined ? undefined : blockAtOffset(blocks, at);
      if (here?.empty === true && sourceRows !== undefined) {
        const row = equivalentExtent(sourceRows, here);
        return row === undefined ? undefined : { from: row.from, to: row.reaches };
      }

      const verse = verseAtOffset(target.skeleton, at);
      if (verse !== undefined) {
        const twin = equivalentVerse(source, verse.sid);
        return twin === undefined ? undefined : { from: twin.textFrom, to: twin.textTo };
      }

      if (here === undefined || sourceRows === undefined) return undefined;
      const row = equivalentExtent(sourceRows, here);
      return row === undefined ? undefined : { from: row.from, to: row.reaches };
    },
    { name: "pairedRange" },
  );

  // `editor.pairBlocks`, live. Its own subscription rather than a prop from
  // the column: every surface that draws the pair follows the one setting
  // directly, so none of them can be showing it while another is not.
  createEffect(
    () => mounted(),
    (view) => {
      if (view === undefined) return;
      const key = shellKeys(services.settings).pairBlocks;
      const fiber = services.runtime.runFork(
        Stream.runForEach(services.settings.changes(key), (on: boolean) =>
          Effect.sync(() => {
            view.pairBlocks(on);
          }),
        ),
      );
      return () => {
        Effect.runFork(Fiber.interrupt(fiber));
      };
    },
  );

  /** Why there is or is not a mark — see the attribute on the root. */
  const pairState = (): string => {
    if (shell.caret() === undefined) return "no-caret";
    const target = targetSkeleton();
    if (target === undefined) return "no-target";
    if (sourceSkeleton() === undefined) return "no-source";
    const at = shell.caret();
    const verse = at === undefined ? undefined : verseAtOffset(target.skeleton, at);
    const row = paired();
    if (row === undefined) return verse === undefined ? "no-verse-here" : `unpaired:${verse.sid}`;
    return verse === undefined ? "block" : verse.sid;
  };

  createEffect(
    () => ({ view: mounted(), row: paired() }),
    ({ view, row }) => {
      view?.showPair(row ?? null);
    },
  );

  const missing = (): string =>
    t("{title} has no {book}", {
      title: props.resource.title,
      book: bookName(bookId, metadataOf(shell.project())),
    });

  return (
    <div
      class="editor-host"
      data-reference={props.resource.id}
      data-role={props.role}
      data-mode={shell.mode()}
      data-state={held().kind}
      // What this pane thinks the caret's block is here. A test hook, and the
      // one thing that cannot be read off the DOM: a pane with no mark may
      // have found no pair, or have had no skeleton to look in.
      data-pair={pairState()}
    >
      {/* The header line: whose text this is, and the one way out of it. The
          × unbinds and does not delete — the resource stays registered, and
          every other project's binding to it is untouched. */}
      <div class="flex items-center gap-2 border-b border-surface-border px-3 py-1.5">
        <p class="min-w-0 flex-1 truncate text-smallest text-on-surface-secondary">
          <span class="font-bold text-on-surface-primary">{props.resource.title}</span>
          <Show when={props.resource.language}>{(language) => <span> · {language()}</span>}</Show>
          <span> · {props.role === "source" ? t("Source") : t("Reference")}</span>
        </p>
        <IconButton
          size="sm"
          data-testid={`unbind-${props.resource.id}`}
          label={t("Remove {title}", { title: props.resource.title })}
          tooltipSide="left"
          icon={<X size={14} />}
          onClick={() => props.onUnbind()}
        />
      </div>

      <Switch>
        <Match when={held().kind === "loading"}>
          <p class="px-3 py-2 text-smallest text-on-surface-tertiary">{t("Looking…")}</p>
        </Match>
        <Match when={held().kind === "missing"}>
          <p data-testid="reference-missing" class="px-3 py-2 text-small text-on-surface-tertiary">
            {missing()}
          </p>
        </Match>
        <Match when={held().kind === "failed"}>
          <p class="px-3 py-2 text-small text-on-surface-tertiary">
            {t("Could not read {title}.", { title: props.resource.title })}
          </p>
        </Match>
        <Match when={held().kind === "text"}>
          <div class="cm-host" data-testid={`reference-host-${props.resource.id}`} ref={setHost} />
        </Match>
      </Switch>
    </div>
  );
}
