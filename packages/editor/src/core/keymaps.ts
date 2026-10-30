import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { type EditorView, keymap, type KeyBinding } from "@codemirror/view";

import { caretLineBoundary, extendCaret, moveCaret, moveCaretByWord } from "./caret";
import { guardedBackspace, guardedDelete, mergeParagraphBackwards } from "./deletion";
import { PAINT_PORT, planAt, structureAt } from "./editorState";
import { expectedVersesField } from "./expectedVerses";
import { guardedEnter, setBlockMarker } from "./input";
import { plainPasteFollowsTyping } from "./inputRules/plainPaste";
import { typedMarkerBehaviour, typedMarkerKeys } from "./inputRules/typedMarker";
import { verseNumberKeys } from "./inputRules/verseNumbers";
import { insertFootnote, insertParagraph, insertPoetry, insertVerse } from "./insert";
import { traceFor } from "./instrument";
import { poetryLevelKeys } from "./poetryLevels";
import { preferenceOn, type PreferenceKey } from "./preferences";
import { tableKeys } from "./tableCommands";
import { verseLineBehaviour, verseLineKeys } from "./verseLines";

/**
 * Every key the editor binds, in one place: mode × preference × key → action.
 *
 * A bundle is keys that belong together. `modes` says where it acts, as a map
 * for people: each command still declines outside its own mode, so a key falls
 * through to the next bundle that wants it (Tab is a table's cell walk, else
 * Form Mode's next empty verse, else Refine's poetry level). `preference`
 * names the switch that turns a bundle off (`preferences.ts`); a bundle
 * without one is always on. Earlier bundles win a key: the table is in
 * precedence order.
 */

export type EditorMode = "reading" | "form" | "usfm";

export interface KeyBundle {
  readonly id: string;
  /** What it is for, in a sentence. */
  readonly summary: string;
  readonly modes: readonly EditorMode[];
  readonly preference?: PreferenceKey;
  readonly keys: () => readonly KeyBinding[];
  /** Behaviour that is not a key: typing rules, filters. Placed after the highest keys, as before. */
  readonly behaviour?: Extension;
  readonly precedence: "highest" | "high" | "default";
}

const traced =
  <T extends { state: EditorState }>(name: string, run: (target: T) => boolean) =>
  (target: T): boolean => {
    const trace = traceFor(target.state, "key");
    if (trace === null) return run(target);
    const close = trace.command(name);
    let ok = false;
    try {
      ok = run(target);
      return ok;
    } finally {
      close(ok ? "consumed" : "declined");
    }
  };

/**
 * The caret's motion keys over the stops (`stops.ts`): arrows, Home/End, word
 * jumps, Shift-extend. The canonical editor's, and a satellite's too — a
 * surface over part of a book moves exactly as the book does, and its range
 * then pulls the result in (`recipes/satellite.ts`).
 */
export function motionKeys(): readonly KeyBinding[] {
  const move = (right: boolean) =>
    traced("moveCaret", moveCaret(structureAt, right, undefined, PAINT_PORT));
  const extend = (right: boolean) =>
    traced("extendCaret", extendCaret(structureAt, right, undefined, PAINT_PORT));
  const boundary = (end: boolean) =>
    traced("caretLineBoundary", caretLineBoundary(structureAt, end, PAINT_PORT));
  const byWord = (right: boolean) =>
    traced("moveCaretByWord", moveCaretByWord(structureAt, right, PAINT_PORT));
  return [
    { key: "ArrowLeft", run: move(false) },
    { key: "ArrowRight", run: move(true) },
    { key: "Shift-ArrowLeft", run: extend(false) },
    { key: "Shift-ArrowRight", run: extend(true) },
    { key: "Home", run: boundary(false) },
    { key: "End", run: boundary(true) },
    { key: "Mod-ArrowLeft", run: boundary(false) },
    { key: "Mod-ArrowRight", run: boundary(true) },
    { key: "Alt-ArrowLeft", run: byWord(false) },
    { key: "Alt-ArrowRight", run: byWord(true) },
  ];
}

/**
 * Backspace and Delete as the book's rules have them — the owned sets, the
 * box of an empty number, an immortal passed to what is behind it — for every
 * surface that edits the book, the canonical editor and a card's satellite
 * alike. Without them a satellite's Backspace was CodeMirror's plain "delete
 * a character", which the Book could only refuse or let through: none of the
 * keypress rules reached a card.
 */
export function deletionKeys(): readonly KeyBinding[] {
  const backspace = () =>
    traced("guardedBackspace", guardedBackspace(structureAt, planAt, PAINT_PORT));
  const del = () => traced("guardedDelete", guardedDelete(structureAt, planAt, PAINT_PORT));
  return [
    { key: "Backspace", run: backspace() },
    {
      key: "Backspace",
      run: traced("mergeParagraphBackwards", mergeParagraphBackwards(structureAt)),
    },
    { key: "Delete", run: del() },
    { key: "Ctrl-d", run: del() },
    { key: "Ctrl-h", run: backspace() },
  ];
}

export function usfmKeys(): readonly KeyBinding[] {
  return [
    ...motionKeys(),
    { key: "Enter", run: traced("guardedEnter", guardedEnter(structureAt, planAt)) },
    ...deletionKeys(),
    { key: "Mod-Alt-1", run: traced("setBlockMarker", setBlockMarker(structureAt, "q1")) },
    { key: "Mod-Alt-0", run: traced("setBlockMarker", setBlockMarker(structureAt, "p")) },
    { key: "Mod-Shift-v", run: traced("insertVerse", insertVerse(structureAt)) },
    { key: "Mod-Shift-p", run: traced("insertParagraph", insertParagraph(structureAt)) },
    { key: "Mod-Shift-l", run: traced("insertPoetry", insertPoetry(structureAt)) },
    { key: "Mod-Shift-n", run: traced("insertFootnote", insertFootnote()) },
  ];
}

export const KEY_BUNDLES: readonly KeyBundle[] = [
  {
    id: "typedMarkers",
    summary:
      "A typed backslash starts a marker shown in place; Space or Enter writes it, Backspace shortens it, Escape drops it (inputRules/typedMarker.ts).",
    modes: ["reading"],
    keys: typedMarkerKeys,
    behaviour: typedMarkerBehaviour,
    precedence: "highest",
  },
  {
    id: "tables",
    summary: "Tab and Shift-Tab walk a table's cells; Backspace or Delete takes an empty row.",
    modes: ["reading"],
    keys: tableKeys,
    precedence: "highest",
  },
  {
    id: "formNavigation",
    summary:
      "Enter and Shift-Enter go verse to verse, Tab and Shift-Tab empty verse to empty verse, Home and End to the verse's ends.",
    modes: ["form"],
    keys: verseLineKeys,
    behaviour: verseLineBehaviour,
    precedence: "highest",
  },
  {
    id: "poetryLevels",
    summary:
      "Tab and Shift-Tab move a line one poetry level; Enter on an empty poetry line or Backspace at its start leaves poetry for \\p.",
    modes: ["reading"],
    keys: poetryLevelKeys,
    precedence: "highest",
  },
  {
    id: "verseShortcuts",
    summary:
      'Typing "1", "1.", "v1" or "verse 1" then a space writes that verse when it is the next one or within the reference\'s count, never a duplicate (inputRules/verseNumbers.ts); pasted text the same (inputRules/plainPaste.ts). Backspace just after a verse\'s number in Reading takes the verse back to the number.',
    modes: ["reading", "form"],
    preference: "verseShortcuts",
    keys: verseNumberKeys,
    behaviour: [expectedVersesField, plainPasteFollowsTyping],
    precedence: "highest",
  },
  {
    id: "editing",
    summary:
      "The caret over the book's stops, Enter, Backspace and Delete by the book's rules, and the insert shortcuts.",
    modes: ["reading", "form", "usfm"],
    keys: usfmKeys,
    precedence: "high",
  },
  {
    id: "codemirror",
    summary: "CodeMirror's own keys and Undo, under everything above.",
    modes: ["reading", "form", "usfm"],
    keys: () => [...defaultKeymap, ...historyKeymap],
    precedence: "default",
  },
];

/** A bundle's keys, each declining while its preference is off. */
const gated = (bundle: KeyBundle): readonly KeyBinding[] => {
  const preference = bundle.preference;
  if (preference === undefined) return bundle.keys();
  const when =
    (run: ((view: EditorView) => boolean) | undefined) =>
    (view: EditorView): boolean =>
      run !== undefined && preferenceOn(view.state, preference) && run(view);
  return bundle.keys().map((binding) => ({
    ...binding,
    run: when(binding.run),
    shift: when(binding.shift),
  }));
};

const PRECEDENCE = { highest: Prec.highest, high: Prec.high, default: (e: Extension) => e };

/** The bundles as CodeMirror extensions, in the table's order. */
export const commandsLayer: Extension = KEY_BUNDLES.flatMap((bundle) => [
  PRECEDENCE[bundle.precedence](keymap.of(gated(bundle))),
  ...(bundle.behaviour === undefined ? [] : [bundle.behaviour]),
]);
