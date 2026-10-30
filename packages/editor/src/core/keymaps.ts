import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { type EditorState, type Extension, Facet, Prec } from "@codemirror/state";
import { type Command, EditorView, keymap, type KeyBinding } from "@codemirror/view";

import { caretLineBoundary, extendCaret, moveCaret, moveCaretByWord } from "./caret";
import { insertFootnote, insertParagraph, insertPoetry, insertVerse } from "./commands/insert";
import { poetryLevelCommands } from "./commands/poetryLevels";
import { tableCommands } from "./commands/tableCommands";
import { PAINT_PORT, planAt, structureAt } from "./editorState";
import { expectedVersesField } from "./expectedVerses";
import { guardedBackspace, guardedDelete, mergeParagraphBackwards } from "./guards/deletion";
import { guardedEnter, setBlockMarker } from "./guards/input";
import { plainPasteFollowsTyping } from "./inputRules/plainPaste";
import { typedMarkerBehaviour, typedMarkerCommands } from "./inputRules/typedMarker";
import { verseNumberCommands } from "./inputRules/verseNumbers";
import { traceFor } from "./instrument/instrument";
import { preferenceOn, type PreferenceKey } from "./preferences";
import { verseLineBehaviour, verseLineCommands } from "./verseLines";

/**
 * Every key the editor binds, in one place, read the way VS Code reads its
 * keymap: a key names a command by id, and the command does the work.
 *
 * - **Commands** are the editor's actions by id (`edit.enter`,
 *   `verseNumber.accept`), each owned by one bundle.
 * - **Bindings** are `{ key, command }` pairs: each bundle's defaults here,
 *   and a host's own on top (`userKeybindings`, VS Code's keybindings.json:
 *   `{ key, command }` adds, `{ key, command: "-id" }` takes a default away).
 *
 * A bundle is commands that belong together. `modes` says where it acts, as a
 * map for people: each command still declines outside its own mode, so a key
 * falls through to the next bundle that wants it (Tab is a table's cell walk,
 * else Form Mode's next empty verse, else Refine's poetry level).
 * `preference` names the switch that turns a bundle off (`preferences.ts`); a
 * bundle without one is always on. Earlier bundles win a key: the table is
 * in precedence order. A binding to a command keeps its bundle's precedence
 * and preference, wherever the key came from.
 */

export type EditorMode = "reading" | "form" | "usfm";

/** One key to one command, as a line of VS Code's keybindings.json. */
export interface Keybinding {
  readonly key: string;
  /** A command id; `-id` takes that command's default binding to `key` away. */
  readonly command: string;
}

export interface KeyBundle {
  readonly id: string;
  /** What it is for, in a sentence. */
  readonly summary: string;
  readonly modes: readonly EditorMode[];
  readonly preference?: PreferenceKey;
  /** The commands it owns, by id. */
  readonly commands: Readonly<Record<string, Command>>;
  /** Its default keys. */
  readonly bindings: readonly Keybinding[];
  /** Keys that are not ours to name: CodeMirror's own, under everything. */
  readonly native?: () => readonly KeyBinding[];
  /** Behaviour that is not a key: typing rules, filters. Placed after the highest keys, as before. */
  readonly behaviour?: Extension;
  readonly precedence: "highest" | "high" | "default";
}

/** A host's bindings over the defaults (VS Code's user keybindings.json). Empty: the defaults alone. */
export const userKeybindings = Facet.define<readonly Keybinding[], readonly Keybinding[]>({
  combine: (values) => values.flat(),
});

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

const move = (right: boolean) =>
  traced("moveCaret", moveCaret(structureAt, right, undefined, PAINT_PORT));
const extend = (right: boolean) =>
  traced("extendCaret", extendCaret(structureAt, right, undefined, PAINT_PORT));
const boundary = (end: boolean) =>
  traced("caretLineBoundary", caretLineBoundary(structureAt, end, PAINT_PORT));
const byWord = (right: boolean) =>
  traced("moveCaretByWord", moveCaretByWord(structureAt, right, PAINT_PORT));

/**
 * The caret's motion over the stops (`paint/stops.ts`): arrows, Home/End, word
 * jumps, Shift-extend. The canonical editor's, and a satellite's too — a
 * surface over part of a book moves exactly as the book does, and its range
 * then pulls the result in (`surfaces/satellite.ts`).
 */
const motionCommands = {
  "caret.left": move(false),
  "caret.right": move(true),
  "caret.extendLeft": extend(false),
  "caret.extendRight": extend(true),
  "caret.lineStart": boundary(false),
  "caret.lineEnd": boundary(true),
  "caret.wordLeft": byWord(false),
  "caret.wordRight": byWord(true),
};

const MOTION_BINDINGS: readonly Keybinding[] = [
  { key: "ArrowLeft", command: "caret.left" },
  { key: "ArrowRight", command: "caret.right" },
  { key: "Shift-ArrowLeft", command: "caret.extendLeft" },
  { key: "Shift-ArrowRight", command: "caret.extendRight" },
  { key: "Home", command: "caret.lineStart" },
  { key: "End", command: "caret.lineEnd" },
  { key: "Mod-ArrowLeft", command: "caret.lineStart" },
  { key: "Mod-ArrowRight", command: "caret.lineEnd" },
  { key: "Alt-ArrowLeft", command: "caret.wordLeft" },
  { key: "Alt-ArrowRight", command: "caret.wordRight" },
];

/**
 * Backspace and Delete as the book's rules have them — the owned sets, the
 * box of an empty number, an immortal passed to what is behind it — for every
 * surface that edits the book, the canonical editor and a card's satellite
 * alike. Without them a satellite's Backspace was CodeMirror's plain "delete
 * a character", which the Book could only refuse or let through: none of the
 * keypress rules reached a card.
 */
const deletionCommands = {
  "edit.backspace": traced("guardedBackspace", guardedBackspace(structureAt, planAt, PAINT_PORT)),
  "edit.mergeParagraphBackwards": traced(
    "mergeParagraphBackwards",
    mergeParagraphBackwards(structureAt),
  ),
  "edit.delete": traced("guardedDelete", guardedDelete(structureAt, planAt, PAINT_PORT)),
};

const DELETION_BINDINGS: readonly Keybinding[] = [
  { key: "Backspace", command: "edit.backspace" },
  { key: "Backspace", command: "edit.mergeParagraphBackwards" },
  { key: "Delete", command: "edit.delete" },
  { key: "Ctrl-d", command: "edit.delete" },
  { key: "Ctrl-h", command: "edit.backspace" },
];

const editingCommands: Readonly<Record<string, Command>> = {
  ...motionCommands,
  "edit.enter": traced("guardedEnter", guardedEnter(structureAt, planAt)),
  ...deletionCommands,
  "line.toPoetry": traced("setBlockMarker", setBlockMarker(structureAt, "q1")),
  "line.toParagraph": traced("setBlockMarker", setBlockMarker(structureAt, "p")),
  "insert.verse": traced("insertVerse", insertVerse(structureAt)),
  "insert.paragraph": traced("insertParagraph", insertParagraph(structureAt)),
  "insert.poetry": traced("insertPoetry", insertPoetry(structureAt)),
  "insert.footnote": traced("insertFootnote", insertFootnote()),
};

export const KEY_BUNDLES: readonly KeyBundle[] = [
  {
    id: "typedMarkers",
    summary:
      "A typed backslash starts a marker shown in place; Space or Enter writes it, Backspace shortens it, Escape drops it (inputRules/typedMarker.ts).",
    modes: ["reading"],
    commands: typedMarkerCommands,
    bindings: [
      { key: "Space", command: "typedMarker.accept" },
      { key: "Enter", command: "typedMarker.accept" },
      { key: "Backspace", command: "typedMarker.shorten" },
      { key: "Escape", command: "typedMarker.cancel" },
    ],
    behaviour: typedMarkerBehaviour,
    precedence: "highest",
  },
  {
    id: "tables",
    summary: "Tab and Shift-Tab walk a table's cells; Backspace or Delete takes an empty row.",
    modes: ["reading"],
    commands: tableCommands,
    bindings: [
      { key: "Tab", command: "table.nextCell" },
      { key: "Shift-Tab", command: "table.previousCell" },
      { key: "Backspace", command: "table.deleteEmptyRow" },
      { key: "Delete", command: "table.deleteEmptyRow" },
    ],
    precedence: "highest",
  },
  {
    id: "formNavigation",
    summary:
      "Enter and Shift-Enter go verse to verse, Tab and Shift-Tab empty verse to empty verse, Home and End to the verse's ends.",
    modes: ["form"],
    commands: verseLineCommands,
    bindings: [
      { key: "Enter", command: "verse.next" },
      { key: "Shift-Enter", command: "verse.previous" },
      { key: "Tab", command: "verse.nextEmpty" },
      { key: "Shift-Tab", command: "verse.previousEmpty" },
      { key: "Home", command: "verse.start" },
      { key: "End", command: "verse.end" },
    ],
    behaviour: verseLineBehaviour,
    precedence: "highest",
  },
  {
    id: "poetryLevels",
    summary:
      "Tab and Shift-Tab move a line one poetry level; Enter on an empty poetry line or Backspace at its start leaves poetry for \\p.",
    modes: ["reading"],
    commands: poetryLevelCommands,
    bindings: [
      { key: "Backspace", command: "poetry.leaveAtLineStart" },
      { key: "Tab", command: "poetry.indent" },
      { key: "Shift-Tab", command: "poetry.outdent" },
      { key: "Enter", command: "poetry.leaveEmptyLine" },
    ],
    precedence: "highest",
  },
  {
    id: "verseShortcuts",
    summary:
      'Typing "1", "1.", "v1" or "verse 1" then a space writes that verse when it is the next one or within the reference\'s count, never a duplicate (inputRules/verseNumbers.ts); pasted text the same (inputRules/plainPaste.ts). Backspace just after a verse\'s number in Reading takes the verse back to the number.',
    modes: ["reading", "form"],
    preference: "verseShortcuts",
    commands: verseNumberCommands,
    bindings: [
      { key: "Space", command: "verseNumber.accept" },
      { key: "Backspace", command: "verseNumber.backToWord" },
    ],
    behaviour: [expectedVersesField, plainPasteFollowsTyping],
    precedence: "highest",
  },
  {
    id: "editing",
    summary:
      "The caret over the book's stops, Enter, Backspace and Delete by the book's rules, and the insert shortcuts.",
    modes: ["reading", "form", "usfm"],
    commands: editingCommands,
    bindings: [
      ...MOTION_BINDINGS,
      { key: "Enter", command: "edit.enter" },
      ...DELETION_BINDINGS,
      { key: "Mod-Alt-1", command: "line.toPoetry" },
      { key: "Mod-Alt-0", command: "line.toParagraph" },
      { key: "Mod-Shift-v", command: "insert.verse" },
      { key: "Mod-Shift-p", command: "insert.paragraph" },
      { key: "Mod-Shift-n", command: "insert.footnote" },
      { key: "Mod-Shift-l", command: "insert.poetry" },
    ],
    precedence: "high",
  },
  {
    id: "codemirror",
    summary: "CodeMirror's own keys and Undo, under everything above.",
    modes: ["reading", "form", "usfm"],
    commands: {},
    bindings: [],
    native: () => [...defaultKeymap, ...historyKeymap],
    precedence: "default",
  },
];

/**
 * A bundle's bindings with a host's laid over them, as CodeMirror's: a host
 * binding joins the bundle that owns its command, and `-id` takes the
 * default away. Each run declines while the bundle's preference is off.
 */
const resolvedOnce = (bundle: KeyBundle, user: readonly Keybinding[]): readonly KeyBinding[] => {
  const removed = new Set(
    user.filter((b) => b.command.startsWith("-")).map((b) => `${b.key} ${b.command.slice(1)}`),
  );
  const added = user.filter((b) => Object.hasOwn(bundle.commands, b.command));
  const preference = bundle.preference;
  const bound = [...bundle.bindings, ...added].flatMap((b): KeyBinding[] => {
    const run = bundle.commands[b.command];
    if (run === undefined || removed.has(`${b.key} ${b.command}`)) return [];
    const gated: Command =
      preference === undefined ? run : (view) => preferenceOn(view.state, preference) && run(view);
    return [{ key: b.key, run: gated }];
  });
  return [...bound, ...(bundle.native?.() ?? [])];
};

/** Resolved once per host binding list: the typed-key fallback asks on every character typed. */
const resolvedFor = new WeakMap<readonly Keybinding[], Map<string, readonly KeyBinding[]>>();

const resolved = (bundle: KeyBundle, user: readonly Keybinding[]): readonly KeyBinding[] => {
  let byBundle = resolvedFor.get(user);
  if (byBundle === undefined) resolvedFor.set(user, (byBundle = new Map()));
  let out = byBundle.get(bundle.id);
  if (out === undefined) byBundle.set(bundle.id, (out = resolvedOnce(bundle, user)));
  return out;
};

const defaultsOf = (bindings: readonly Keybinding[]): readonly KeyBinding[] =>
  bindings.flatMap((b) => {
    const run = editingCommands[b.command];
    return run === undefined ? [] : [{ key: b.key, run }];
  });

/** The caret's motion keys, for a surface that edits part of a book (`surfaces/satellite.ts`). */
export const motionKeys = (): readonly KeyBinding[] => defaultsOf(MOTION_BINDINGS);

/** Backspace and Delete by the book's rules, for a surface that edits part of a book. */
export const deletionKeys = (): readonly KeyBinding[] => defaultsOf(DELETION_BINDINGS);

/** The editing bundle's default keys, for tests over a bare state (`testing/harness.ts`). */
export const usfmKeys = (): readonly KeyBinding[] =>
  resolved(KEY_BUNDLES.find((b) => b.id === "editing") ?? KEY_BUNDLES[0], []);

/** CodeMirror's name for the key that types `text`, for keyboards that send no keydown. */
const keyTyping = (text: string): string | null =>
  text === " " ? "Space" : [...text].length === 1 && /\S/.test(text) ? text : null;

/**
 * A key bound to a printable character (Space by default) also runs when the
 * character arrives as input with no keydown before it, as Android's soft
 * keyboards send it. On a keyboard that sends both, the keydown ran the
 * command first: one that took the key consumed the input, and one that
 * declined declines here too.
 */
const typedKeys = Prec.highest(
  EditorView.inputHandler.of((view, from, to, text) => {
    const key = keyTyping(text);
    if (key === null || from !== to || from !== view.state.selection.main.head) return false;
    const user = view.state.facet(userKeybindings);
    for (const bundle of KEY_BUNDLES)
      for (const binding of resolved(bundle, user))
        if (binding.key === key && binding.run?.(view) === true) return true;
    return false;
  }),
);

const PRECEDENCE = { highest: Prec.highest, high: Prec.high, default: (e: Extension) => e };

/** The bundles as CodeMirror extensions, in the table's order, with a host's bindings over them. */
export const commandsLayer: Extension = [
  typedKeys,
  ...KEY_BUNDLES.flatMap((bundle) => [
    PRECEDENCE[bundle.precedence](
      keymap.compute([userKeybindings], (state: EditorState) =>
        resolved(bundle, state.facet(userKeybindings)),
      ),
    ),
    ...(bundle.behaviour === undefined ? [] : [bundle.behaviour]),
  ]),
];
