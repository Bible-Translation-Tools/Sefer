import { type Diagnostic, forEachDiagnostic } from "@codemirror/lint";
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";

import { structureAt } from "../core/docStructure";
import type { VerseRow } from "../core/fold";
import { addVerseAfter, nextNumber, removeVerseMarker, renumberVerse } from "../core/verseCommands";
import {
  hasVerseMenu,
  numbersHaveMenus,
  onNumber,
  removesMarker,
  suggestedNumber,
} from "../core/verseLines";

/**
 * The verse number's menu, an opt-in feature (`editorFeatures`): a press on a
 * verse number opens it, with the number's findings, Change number, Remove
 * verse marker and Add verse after. The edits are the plain commands in
 * `core/verseCommands.ts`; this is one UI over them.
 */
const openVerseMenu = StateEffect.define<number | null>();

const verseMenuField = StateField.define<number | null>({
  create: () => null,
  update(open, tr) {
    for (const effect of tr.effects) if (effect.is(openVerseMenu)) return effect.value;
    return tr.docChanged ? null : open;
  },
  provide: (field) =>
    showTooltip.compute([field], (state): Tooltip | null => {
      const k = state.field(field);
      const verse = k === null ? undefined : structureAt(state).verses[k];
      if (k === null || verse === undefined) return null;
      return { pos: verse.numFrom, above: false, create: (view) => menu(view, k) };
    }),
});

const button = (label: string, run: () => void): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", run);
  return element;
};

const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const closeMenu = (view: EditorView): void => view.dispatch({ effects: openVerseMenu.of(null) });

/** Whether a finding's only fix deletes this verse's marker, which Remove verse marker already does. */
const removesTheMarker = (diagnostic: Diagnostic, verse: VerseRow): boolean => {
  const removal = removesMarker.get(diagnostic);
  return removal !== undefined && removal.from === verse.markerFrom;
};

const findingsOnNumber = (
  state: EditorState,
  verse: VerseRow,
): { diagnostic: Diagnostic; from: number; to: number }[] => {
  const found: { diagnostic: Diagnostic; from: number; to: number }[] = [];
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (onNumber(verse, from, to)) found.push({ diagnostic, from, to });
  });
  return found;
};

function menu(view: EditorView, k: number): { dom: HTMLElement } {
  const close = (): void => closeMenu(view);
  const edit = (spec: TransactionSpec | null): void => {
    if (spec !== null) view.dispatch(spec);
    close();
    view.focus();
  };
  const verse = structureAt(view.state).verses[k];

  const dom = document.createElement("div");
  dom.className = "usfm-verse-menu";
  let suggestion: string | undefined;
  for (const { diagnostic, from, to } of findingsOnNumber(view.state, verse)) {
    const said = document.createElement("div");
    said.className = `usfm-verse-finding usfm-verse-finding-${diagnostic.severity}`;
    said.textContent = sentenceCase(diagnostic.message);
    dom.append(said);
    suggestion ??= suggestedNumber.get(diagnostic);
    if (suggestedNumber.has(diagnostic) || removesTheMarker(diagnostic, verse)) continue;
    for (const action of diagnostic.actions ?? [])
      dom.append(
        button(sentenceCase(action.name.replace(/^Fix:\s*/, "")), () => {
          action.apply(view, from, to);
          close();
          view.focus();
        }),
      );
  }

  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = "Change number";
  const input = document.createElement("input");
  const before = structureAt(view.state).verses[k - 1];
  const guess = verse.num === null && before !== undefined ? nextNumber(before.num) : undefined;
  input.value = suggestion ?? verse.num ?? guess ?? "";
  input.size = 4;
  input.setAttribute("aria-label", "Verse number");
  input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
  label.append(input);
  form.append(label);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (input.value.trim() === verse.num) return close();
    const spec = renumberVerse(view.state, k, input.value);
    if (spec === null) {
      input.setAttribute("aria-invalid", "true");
      return;
    }
    edit(spec);
  });
  dom.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    view.focus();
  });

  const remove = button("Remove verse marker", () => edit(removeVerseMarker(view.state, k)));
  const add = button("Add verse after", () => edit(addVerseAfter(view.state, k)));
  dom.append(form, remove, add);
  queueMicrotask(() => input.select());
  return { dom };
}

/** A click on a verse number opens its menu; anywhere else closes it. */
const verseNumberClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!numbersHaveMenus(view.state) || !(event.target instanceof Element)) return false;
    if (event.target.closest(".usfm-verse-menu") !== null) return false;
    const number = event.target.closest(".usfm-num-v, .usfm-slot-v");
    if (number === null) {
      if (view.state.field(verseMenuField) !== null)
        view.dispatch({ effects: openVerseMenu.of(null) });
      return false;
    }
    const pos = view.posAtDOM(number);
    const k = structureAt(view.state).verses.findIndex(
      (verse) => verse.markerFrom <= pos && pos <= verse.contentFrom,
    );
    if (k < 0) return false;
    event.preventDefault();
    view.dispatch({ effects: openVerseMenu.of(k) });
    return true;
  },
});

export const verseMenu = (): Extension => [
  hasVerseMenu.of(true),
  verseMenuField,
  verseNumberClicks,
];
