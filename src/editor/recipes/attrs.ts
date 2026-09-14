/**
 * The aligned-word popover: the attributes on a `\w …|lemma="…"` word, editable
 * by value.
 *
 * Keys are locked on purpose — an attribute key is spec vocabulary, and renaming
 * one silently changes what the alignment means. Two of the engine free
 * functions this needs are not exported by the pinned wasm handle yet; see the
 * `TODO(seam)` below, which fails loudly rather than showing an empty list.
 */

import type { EditorState } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";

import { AttrResolution, attrList } from "../../core/galley";
import { type DocStructure, type WordRange, lineIndexAt } from "../core/docStructure";
import { trusted } from "../core/kernel";

// TODO(seam): the aligned-word popover needs two engine free functions the
// pinned wasm handle does not export yet — `attrs(text, from, to, stride)`,
// which parses an attribute list into the reader's flat u32 layout, and
// `attrResolve(name, marker)`, which says whether a marker defines an
// attribute (see `galley/src/wasm.md`, "What the handle does not do yet").
// They fail loudly rather than returning an empty list, because a popover
// that silently shows no attributes reads as "this word has none" — a wrong
// answer about alignment data is worse than a visible defect.
const MISSING = "galley: the handle does not export ";

const attrs = (_text: string, _from: number, _to: number): Uint32Array => {
  throw new Error(`${MISSING}attrs(); the attribute popover is not wired yet`);
};

const attrResolve = (_name: string, _marker: number): number => {
  throw new Error(`${MISSING}attrResolve(); the attribute popover is not wired yet`);
};

function wordAt(s: DocStructure, pos: number): WordRange | null {
  const at = lineIndexAt(s, pos);
  if (at < 0) return null;
  const l = s.lines.at(at);
  if (pos < l.from || pos > l.to) return null;
  for (const w of l.words) if (pos >= w.surfaceFrom && pos <= w.surfaceTo) return w;
  return null;
}

export interface AttrSpan {
  key: string;
  value: string;
  keyFrom: number;
  keyTo: number;
  valueFrom: number;
  valueTo: number;
  resolution: number;
}

export function attrSpans(doc: string, w: WordRange): AttrSpan[] {
  if (w.attrTo <= w.attrFrom) return [];
  const out: AttrSpan[] = [];
  for (const a of attrList(attrs(doc, w.attrFrom, w.attrTo)).attrs) {
    const key = doc.slice(a.name.from, a.name.to);
    out.push({
      key,
      value: doc.slice(a.value.from, a.value.to),
      keyFrom: a.name.from,
      keyTo: a.name.to,
      valueFrom: a.value.from,
      valueTo: a.value.to,
      resolution: attrResolve(key, w.marker),
    });
  }
  return out;
}

const cleanValue = (s: string) => s.replace(/[\\\n\r"]/g, "");

function writeSpan(view: EditorView, from: number, to: number, text: string) {
  if (view.state.doc.sliceString(from, to) === text) return;
  setTimeout(() => {
    if (!view.dom.isConnected) return;
    view.dispatch({
      changes: { from, to, insert: text },
      userEvent: "input.usfm.attr",
      annotations: trusted.of("attr-edit"),
    });
  }, 0);
}

const KEY_TITLE: Record<number, string> = {
  [AttrResolution.Defined]: "attribute keys are locked — edit the value, or use USFM mode",
  [AttrResolution.UserNamespace]:
    "an x- attribute; keys are locked — edit the value, or use USFM mode",
  [AttrResolution.Unknown]:
    "this marker does not define this attribute; keys are locked — edit the value, or use USFM mode",
};

const EDITABLE_KEYS = false;

export function alignedWordTooltip(structureAt: (s: EditorState) => DocStructure) {
  return hoverTooltip(
    (view, pos) => {
      const w = wordAt(structureAt(view.state), pos);
      if (!w) return null;
      return {
        pos: w.surfaceFrom,
        end: w.surfaceTo,
        above: true,
        // This popover paints its own chrome, so the stylesheet strips
        // CodeMirror's tooltip box off it — by this class, not by
        // `.cm-tooltip-hover`, which every hover tooltip carries, the lint one
        // included.
        class: "cm-tooltip-attrs",
        create() {
          const dom = document.createElement("div");
          dom.className = "usfm-attrs";
          const head = document.createElement("div");
          head.className = "usfm-attrs-head";
          head.textContent = view.state.doc.sliceString(w.surfaceFrom, w.surfaceTo);
          dom.append(head);
          const field = (
            cls: string,
            initial: string,
            clean: (s: string) => string,
            from: number,
            to: number,
          ) => {
            const el = document.createElement("input");
            el.className = cls;
            el.value = initial;
            el.spellcheck = false;
            el.size = Math.max(4, initial.length);
            el.oninput = () => {
              const c = clean(el.value);
              if (c !== el.value) {
                const at = el.selectionStart ?? c.length;
                el.value = c;
                el.setSelectionRange(Math.min(at, c.length), Math.min(at, c.length));
              }
            };
            el.onchange = () => writeSpan(view, from, to, clean(el.value));
            el.onkeydown = (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                el.blur();
              }
            };
            return el;
          };
          for (const a of attrSpans(view.state.doc.toString(), w)) {
            const row = document.createElement("label");
            row.className = "usfm-attr";
            const k = field("usfm-attr-k", a.key, cleanValue, a.keyFrom, a.keyTo);
            if (!EDITABLE_KEYS) {
              k.readOnly = true;
              k.tabIndex = -1;
              k.title = KEY_TITLE[a.resolution] ?? KEY_TITLE[AttrResolution.Unknown];
            }
            row.append(k, field("usfm-attr-v", a.value, cleanValue, a.valueFrom, a.valueTo));
            dom.append(row);
          }
          const foot = document.createElement("div");
          foot.className = "usfm-attrs-foot";
          foot.textContent = `bytes ${w.from}–${w.to}, never moved`;
          dom.append(foot);
          return { dom };
        },
      };
    },
    { hoverTime: 120 },
  );
}
