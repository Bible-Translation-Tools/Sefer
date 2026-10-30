import { ChangeSet, EditorSelection, EditorState, type Extension } from "@codemirror/state";

import { structureAt } from "../docStructure";
import { blockKindForEnter } from "../exceptions";
import { blockAt, isTrusted, isVisual, nl } from "../kernel";
import { preferenceOn } from "../preferences";
import { assignmentAt } from "../registry";
import { noteTr } from "../trace";
import { isVerseNumber, versesAround } from "./verseNumbers";

/** A number as people write a verse's: "4", "4.", "v4", "verse 4", followed by a space. */
const WRITTEN_VERSE = /(verse\s*|v\s*)?(\d{1,3})\.?(?=[ \t])/gi;

/**
 * Plain text pasted in Refine follows the rules typing does. Its line breaks
 * are Enter: each starts a new line of the kind the paste lands in (`\p`, or
 * `\q1` inside poetry). Its verse numbers are typed numbers: one becomes a
 * verse (`\v N`) only where typing it would (`typedVerseNumbers`): a number
 * `isVerseNumber` takes: the next in order, or one in the chapter's expected
 * verses, never a duplicate. "He fed 5000" pasted stays words.
 *
 * Only plain text: Sefer's own copied USFM has its paste rules
 * (`pasteChange`), a paste with a backslash in it is markup and is judged as
 * such, and line by line flattens a paste to one line (`pasteAsOneLine`).
 */
function shapePastedText(
  state: EditorState,
  at: number,
  text: string,
): { readonly insert: string; readonly verses: number } {
  const kind = blockKindForEnter(blockAt(structureAt(state), at));
  const lines = text.split(/[ \t]*\r?\n[ \t]*/).filter((line, i) => line !== "" || i === 0);
  const shaped = lines.join(`${nl(state)}\\${kind} `);

  const line = state.doc.lineAt(at);
  const lead = state.doc.sliceString(line.from, at);
  const around = versesAround(state, at);
  const taken = new Set(around.taken);
  let next = around.next;
  let out = "";
  let from = 0;
  let verses = 0;
  const numbers = preferenceOn(state, "verseShortcuts") ? shaped.matchAll(WRITTEN_VERSE) : [];
  for (const match of numbers) {
    const i = match.index;
    const before = lead + shaped.slice(0, i);
    const prev = before.slice(-1);
    if (prev !== "" && !/\s/.test(prev)) continue;
    const number = Number(match[2]);
    if (!isVerseNumber({ ...around, next, taken }, number, match[1] !== undefined)) continue;
    out += `${shaped.slice(from, i)}\\v ${number}`;
    from = i + match[0].length;
    taken.add(number);
    next = number + 1;
    verses++;
  }
  return { insert: out + shaped.slice(from), verses };
}

export const plainPasteFollowsTyping: Extension = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent("input.paste") || isTrusted(tr)) return tr;
  const state = tr.startState;
  if (!isVisual(state) || assignmentAt(state).verseLines) return tr;
  let plain = true;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\\")) plain = false;
  });
  if (!plain) return tr;

  let shapedAny = false;
  let verses = 0;
  let lastTo = 0;
  const specs: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    const shaped = shapePastedText(state, fromA, text);
    if (shaped.insert !== text) shapedAny = true;
    verses += shaped.verses;
    specs.push({ from: fromA, to: toA, insert: shaped.insert });
    lastTo = toA;
  });
  if (!shapedAny) return tr;
  noteTr(tr, {
    rule: "plainPasteFollowsTyping",
    verdict: "rewrote",
    detail: `line breaks became lines; ${verses} number(s) became verses`,
  });
  const changes = ChangeSet.of(specs, state.doc.length);
  return {
    changes,
    selection: EditorSelection.cursor(changes.mapPos(lastTo, 1)),
    userEvent: "input.paste",
    scrollIntoView: true,
  };
});
