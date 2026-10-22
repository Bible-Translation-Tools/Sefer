import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import { Compartment, EditorState, StateEffect, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tocViewOf } from "@sefer/text/engine/location";
import type { Address } from "@sefer/text/location/address";
import { addressAt, resolve } from "@sefer/text/location/locate";

import { seatedOf, type EditorBook } from "./book";
import {
  activateMarkup,
  type Attribute,
  attributeActivation,
  attributeChange,
  type AttributedMarkup,
  attributesAt,
} from "./core/attributes";
import { structureAt } from "./core/editorState";
import { frontMatterCard } from "./core/frontmatter";
import { annotateOpen } from "./core/instrument";
import { trusted } from "./core/kernel";
import { keystrokeMeter } from "./core/meter";
import { span } from "./core/timing";
import { type UnsupportedMarkup, unsupportedMarkup } from "./core/unsupported";
import { addVerseAfter, removeVerseMarker, renumberVerse, verseAt } from "./core/verseCommands";
import { type EditorWords, editorWords } from "./core/words";
import type { EditorFeature } from "./features";
import { handleFor, markMoved, type EditorHandle } from "./handle";
import { annotateRepaint } from "./observability";
import { annotateEmptyBlocks, blockNamer, showEmptyBlocks } from "./recipes/emptyBlocks";
import { flash, flashing } from "./recipes/flash";
import { showCorpusFindings, type CorpusFinding } from "./recipes/lint";
import { noteBookIs } from "./recipes/noteEditor";
import { pairingHere, showBlockPairs } from "./recipes/pairing";
import { pickChapter, policyKey, policyView, type EditorPolicy } from "./views";

/**
 * A remembered place, by what the document SAYS: a chapter label, a verse
 * number in it, and the exact offset with the length (and hash) it was taken
 * at. See `BookEditorMount.resume`.
 */
export interface RememberedPlace {
  readonly chapter: string;
  readonly verse?: string;
  readonly offset?: number;
  readonly hash?: string;
  readonly length?: number;
}

export interface BookEditorOptions {
  readonly parent: HTMLElement;
  readonly book: EditorBook;
  /** Where the caret is, on every selection change (the head, the end being dragged). */
  readonly onCaret?: (head: number) => void;
  /** What an empty block is called where its words go (`\q2` → "Poetry line"). */
  readonly blockName?: (marker: string) => string;
  /** The empty-block ghost and the block pairing, as the reader's settings start. */
  readonly emptyBlocks?: boolean;
  readonly pairBlocks?: boolean;
  /** A viewer: nothing can be typed, and everything else — lint, reveal, where — still works. */
  readonly readOnly?: boolean;
  /**
   * The opt-in UI: `editorFeatures()` for all of it, as Sefer mounts, or a
   * host's choice of `verseMenu()`, `attributePopover()`. None by default; the
   * commands and queries under them are on the mount either way. Decided by
   * the book's first mount.
   */
  readonly features?: readonly EditorFeature[];
  /**
   * The words the editor shows, in the host's language: what a marker is
   * called (the chips) and every UI phrase (`PHRASES`). Anything left out is
   * English. Decided by the book's first mount.
   */
  readonly words?: EditorWords;
}

/** One mark the linter draws: the engine's and the host's (`setHostDiagnostics`) as one set. */
export interface DrawnDiagnostic {
  readonly from: number;
  readonly to: number;
  readonly severity: "hint" | "info" | "warning" | "error";
  readonly message: string;
  readonly source?: string;
}

export interface BookEditorMount extends EditorHandle {
  /**
   * How the book is drawn and guarded: a mode (Regular or USFM) and presets
   * over it (`editorPolicy`). Changing it must not move the reader: every
   * policy shows the SAME DOCUMENT, so the selection survives, but hidden
   * markup collapses lines, so the top of the viewport is re-anchored in the
   * same transaction. The same policy again does nothing.
   */
  setPolicy(policy: EditorPolicy): void;
  /** Clips to the chapter with this ordinal, or shows the whole book with `null`. */
  setChapter(ordinal: number | null): void;
  setEmptyBlocks(on: boolean): void;
  setPairBlocks(on: boolean): void;
  /** The host's own findings for this book, drawn with the engine's as one set. */
  setHostDiagnostics(findings: readonly CorpusFinding[]): void;
  /** What the linter draws now. */
  diagnostics(): readonly DrawnDiagnostic[];
  /** Called when the drawn set changes, not on every lint pass. Returns the detach. */
  onDiagnostics(listener: (drawn: readonly DrawnDiagnostic[]) => void): () => void;
  setReadOnly(readOnly: boolean): void;
  /** The milestone or character run with an attribute list at an offset, or `null`. */
  attributesAt(offset: number): AttributedMarkup | null;
  /**
   * Called when a press activates attributed markup (and with `null` when it
   * is let go), whether or not the default popover is showing. Returns the detach.
   */
  onActivate(listener: (target: AttributedMarkup | null) => void): () => void;
  /** Gives `target` these attributes, as one Undo step. */
  setAttributes(target: AttributedMarkup, attributes: readonly Attribute[]): void;
  /**
   * The verse at an offset (its marker, number or text) gets this number.
   * False when there is no verse there, or `number` is no verse number.
   */
  renumberVerse(offset: number, number: string): boolean;
  /** Removes the marker of the verse at an offset; its text joins the verse before. */
  removeVerseMarker(offset: number): boolean;
  /** Adds an empty verse after the one at an offset, numbered one past it, with the caret in it. */
  addVerseAfter(offset: number): boolean;
  /**
   * Markup Reading has no drawing for in a range (the whole book without one):
   * what the chips feature draws, for a host that draws it its own way.
   */
  unsupportedMarkup(range?: {
    readonly from: number;
    readonly to: number;
  }): readonly UnsupportedMarkup[];
  /** The scripture address an offset is in (a verse, a heading's unit, the intro). */
  addressAt(offset: number): Address | undefined;
  /** Where the caret is, as an address. */
  where(): Address | undefined;
  /** Called with the caret's address whenever the caret moves. Returns the detach. */
  onWhere(listener: (where: Address | undefined) => void): () => void;
  /**
   * Goes to an address: caret and scroll, as `jump` does. Answers false when
   * the book has no such place (a verse it lacks), and moves nothing then.
   */
  revealAddress(address: Address, at?: "top" | "center"): boolean;
  /**
   * Puts the reader back at a remembered place, caret and scroll. Answers the
   * offset it landed on, or undefined when the place no longer resolves (or
   * is the very top).
   */
  resume(place: RememberedPlace): number | undefined;
  /**
   * A jump on purpose: caret and scroll to `range` (the top of the pane for a
   * chapter, the middle for a point inside one), and a flash, so a target
   * already on screen still answers the click. Returns the flash's cancel.
   */
  jump(range: { readonly from: number; readonly to?: number }, at: "top" | "center"): () => void;
  destroy(): void;
}

const mountedConfig = new WeakMap<
  EditorBook,
  { readonly projection: Compartment; readonly readOnly: Compartment }
>();

const activateListeners = new WeakMap<EditorBook, Set<(target: AttributedMarkup | null) => void>>();
const caretListeners = new WeakMap<EditorBook, Set<(head: number) => void>>();

const drawnListeners = new WeakMap<EditorBook, Set<() => void>>();

const listenersOf = <T>(map: WeakMap<EditorBook, Set<T>>, book: EditorBook): Set<T> => {
  let held = map.get(book);
  if (held === undefined) {
    held = new Set();
    map.set(book, held);
  }
  return held;
};

const drawnOf = (state: EditorState): DrawnDiagnostic[] => {
  const out: DrawnDiagnostic[] = [];
  forEachDiagnostic(state, (diagnostic, from, to) =>
    out.push({
      from,
      to,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
    }),
  );
  return out;
};

const sameDrawn = (a: readonly DrawnDiagnostic[], b: readonly DrawnDiagnostic[]): boolean =>
  a.length === b.length &&
  a.every((one, at) => {
    const other = b[at];
    return (
      other !== undefined &&
      one.from === other.from &&
      one.to === other.to &&
      one.severity === other.severity &&
      one.message === other.message
    );
  });

const placeOf = (state: EditorState, place: RememberedPlace): number | undefined => {
  const structureNow = structureAt(state);
  const hash = structureNow.analysis?.sourceHash;
  const unmoved =
    hash !== undefined && place.hash !== undefined
      ? String(hash) === place.hash
      : place.length === state.doc.length;
  if (place.offset !== undefined && unmoved) return Math.min(place.offset, state.doc.length);
  const chapter = structureNow.chapters.find((row) => row.label === place.chapter);
  if (chapter === undefined) return undefined;
  if (place.verse === undefined) return chapter.from;
  const verse = structureNow.verses.find(
    (row) =>
      row.markerFrom >= chapter.from && row.markerFrom < chapter.to && row.num === place.verse,
  );
  return verse?.markerFrom ?? chapter.from;
};

const topOfViewport = (view: EditorView): number | undefined => {
  const box = view.scrollDOM.getBoundingClientRect();
  return view.posAtCoords({ x: box.left + 4, y: box.top + 4 }) ?? undefined;
};

const meterFor = (book: EditorBook) =>
  keystrokeMeter((measured) => {
    const painted: Readonly<Record<string, string | number>> =
      measured.render === null
        ? {}
        : {
            "editor.to_paint_ms": measured.render,
            "editor.to_paint_source": measured.renderSource ?? "frame",
          };
    const onGesture = annotateOpen({
      "editor.gesture_ms": measured.gesture,
      "editor.browser_input_ms": measured.browser,
      "editor.analyzes": measured.analyzes,
      "editor.unaccounted_ms": measured.other,
      ...painted,
    });
    if (!onGesture)
      annotateRepaint({ "editor.gesture_ms": measured.gesture, "book.id": book.id, ...painted });
  });

export function mountBookEditor(options: BookEditorOptions): BookEditorMount {
  const book = seatedOf(options.book);
  let view: EditorView | undefined;
  view = new EditorView({
    state: book.state,
    parent: options.parent,
    dispatchTransactions: (transactions) => {
      if (view === undefined) return;
      const done = span("dispatch");
      book.fromView(view, transactions);
      done();
    },
  });
  const created = view;
  const unbind = book.bindView(created);
  const unname = noteBookIs(created, book);

  const heard = listenersOf(caretListeners, book);
  const mineCaret = new Set<(head: number) => void>();
  const listen = (listener: (head: number) => void): (() => void) => {
    const own = (head: number): void => listener(head);
    heard.add(own);
    mineCaret.add(own);
    return () => {
      heard.delete(own);
      mineCaret.delete(own);
    };
  };
  if (options.onCaret !== undefined) listen(options.onCaret);
  const drawnHeard = listenersOf(drawnListeners, book);
  const mine = new Set<() => void>();

  let config = mountedConfig.get(book);
  if (config === undefined) {
    config = { projection: new Compartment(), readOnly: new Compartment() };
    mountedConfig.set(book, config);
    created.dispatch({
      effects: StateEffect.appendConfig.of([
        config.projection.of([]),
        config.readOnly.of([]),
        EditorView.updateListener.of((update) => {
          if (drawnHeard.size === 0) return;
          const linted = update.transactions.some((tr) =>
            tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
          );
          if (linted) for (const listener of drawnHeard) listener();
        }),
        meterFor(book).extension,
        flashing(),
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet) return;
          for (const listener of heard) listener(update.state.selection.main.head);
        }),
        frontMatterCard(),
        attributeActivation,
        ...(options.features ?? []),
        ...(options.words === undefined ? [] : [editorWords.of(options.words)]),
        EditorView.updateListener.of((update) => {
          const listeners = activateListeners.get(book);
          if (listeners === undefined || listeners.size === 0) return;
          for (const tr of update.transactions)
            for (const effect of tr.effects)
              if (effect.is(activateMarkup))
                for (const listener of listeners) listener(effect.value);
        }),
        ...(options.blockName === undefined ? [] : [blockNamer.of(options.blockName)]),
        annotateEmptyBlocks(options.emptyBlocks === true),
        pairingHere(options.pairBlocks === true),
      ]),
    });
  }
  const { projection: compartment, readOnly: readOnlyCompartment } = config;
  const readOnlyOf = (on: boolean) =>
    on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
  created.dispatch({
    effects: readOnlyCompartment.reconfigure(readOnlyOf(options.readOnly === true)),
  });

  const run = (spec: TransactionSpec | null): boolean => {
    if (spec === null || created.state.readOnly) return false;
    created.dispatch(spec);
    return true;
  };

  const toc = () => {
    const analysis = book.structure().analysis;
    if (analysis === null || analysis.text.length !== created.state.doc.length) return undefined;
    return tocViewOf(analysis);
  };
  const addressOf = (offset: number): Address | undefined => {
    const view = toc();
    return view === undefined ? undefined : addressAt(book.id, view, offset);
  };
  const jumpTo = (range: { readonly from: number; readonly to?: number }, at: "top" | "center") => {
    const length = created.state.doc.length;
    const from = Math.min(range.from, length);
    const to = Math.min(range.to ?? from, length);
    markMoved(created);
    created.dispatch({
      selection: { anchor: from },
      effects: EditorView.scrollIntoView(from, { y: at === "top" ? "start" : "center" }),
    });
    return flash(created, { from, to });
  };

  let showing: string | undefined;

  return handleFor(created, {
    setPolicy: (policy: EditorPolicy) => {
      const key = policyKey(policy);
      if (key === showing) return;
      const flipped = showing !== undefined;
      showing = key;
      const anchor = flipped ? topOfViewport(created) : undefined;
      if (flipped) markMoved(created);
      created.dispatch({
        effects: [
          compartment.reconfigure(policyView(policy)),
          ...(anchor === undefined ? [] : [EditorView.scrollIntoView(anchor, { y: "start" })]),
        ],
      });
    },
    setChapter: (ordinal: number | null) => {
      created.dispatch(pickChapter(created.state, ordinal));
    },
    setEmptyBlocks: (on: boolean) => showEmptyBlocks(created, on),
    setPairBlocks: (on: boolean) => showBlockPairs(created, on),
    setHostDiagnostics: (findings: readonly CorpusFinding[]) =>
      showCorpusFindings(created, [...findings]),
    resume: (place: RememberedPlace) => {
      const at = placeOf(created.state, place);
      if (at === undefined || at <= 0) return undefined;
      markMoved(created);
      created.dispatch({
        selection: { anchor: at },
        effects: EditorView.scrollIntoView(at, { y: "start" }),
      });
      requestAnimationFrame(() => {
        if (created.dom.isConnected)
          created.dispatch({ effects: EditorView.scrollIntoView(at, { y: "start" }) });
      });
      return at;
    },
    jump: (range: { readonly from: number; readonly to?: number }, at: "top" | "center") =>
      jumpTo(range, at),
    diagnostics: () => drawnOf(created.state),
    onDiagnostics: (listener: (drawn: readonly DrawnDiagnostic[]) => void) => {
      let last = drawnOf(created.state);
      const check = (): void => {
        const next = drawnOf(created.state);
        if (sameDrawn(next, last)) return;
        last = next;
        listener(next);
      };
      drawnHeard.add(check);
      mine.add(check);
      return () => {
        drawnHeard.delete(check);
        mine.delete(check);
      };
    },
    attributesAt: (offset: number) => attributesAt(created.state, offset),
    onActivate: (listener: (target: AttributedMarkup | null) => void) => {
      const held = listenersOf(activateListeners, book);
      held.add(listener);
      return () => held.delete(listener);
    },
    setAttributes: (target: AttributedMarkup, attributes: readonly Attribute[]) => {
      created.dispatch({
        changes: attributeChange(target, attributes),
        annotations: trusted.of("attributes"),
        userEvent: "input.attributes",
      });
    },
    unsupportedMarkup: (range?: { readonly from: number; readonly to: number }) =>
      unsupportedMarkup(created.state, range?.from ?? 0, range?.to ?? created.state.doc.length),
    renumberVerse: (offset: number, number: string) =>
      run(renumberVerse(created.state, verseAt(created.state, offset), number)),
    removeVerseMarker: (offset: number) =>
      run(removeVerseMarker(created.state, verseAt(created.state, offset))),
    addVerseAfter: (offset: number) =>
      run(addVerseAfter(created.state, verseAt(created.state, offset))),
    setReadOnly: (on: boolean) =>
      created.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyOf(on)) }),
    addressAt: (offset: number) => addressOf(offset),
    where: () => addressOf(created.state.selection.main.head),
    onWhere: (listener: (where: Address | undefined) => void) => {
      return listen((head) => listener(addressOf(head)));
    },
    revealAddress: (address: Address, at: "top" | "center" = "center") => {
      const view = toc();
      if (view === undefined) return false;
      const found = resolve(view, address);
      if (found.kind !== "found") return false;
      jumpTo({ from: found.from, to: found.to }, at);
      return true;
    },
    destroy: () => {
      for (const own of mineCaret) heard.delete(own);
      created.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyOf(false)) });
      for (const check of mine) drawnHeard.delete(check);
      unname();
      unbind();
      created.destroy();
    },
  });
}
