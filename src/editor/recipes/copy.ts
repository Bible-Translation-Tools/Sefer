/**
 * Copy: what leaves the editor on the clipboard.
 *
 * A copy from a USFM editor has four honest answers — the source, what is on
 * screen, the text alone, and verses with their text — so the profile is a facet
 * and the fold that implements it is one table of per-class emit rules.
 */

import { Facet, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { DocStructure } from "../core/docStructure";
import { docText, structureAt } from "../core/editorState";
import { modeFacet } from "../core/kernel";

export type EmitRule = "omit" | "verbatim" | "newline" | "space";

export type CopyProfile = "source" | "as-seen" | "text-only" | "verses-and-text";

export const COPY_PROFILES: readonly CopyProfile[] = [
  "source",
  "as-seen",
  "text-only",
  "verses-and-text",
];

interface ProfileRules {
  content: EmitRule;
  slot: EmitRule;
  chrome: EmitRule;
  delimiter: EmitRule;
  boundary: EmitRule;
  optbreak: EmitRule;
  atom: EmitRule;
}

const RULES: Record<CopyProfile, ProfileRules> = {
  source: {
    content: "verbatim",
    slot: "verbatim",
    chrome: "verbatim",
    delimiter: "verbatim",
    boundary: "verbatim",
    optbreak: "verbatim",
    atom: "verbatim",
  },
  "as-seen": {
    content: "verbatim",
    slot: "verbatim",
    chrome: "omit",
    delimiter: "space",
    boundary: "newline",
    optbreak: "newline",
    atom: "omit",
  },
  "text-only": {
    content: "verbatim",
    slot: "omit",
    chrome: "omit",
    delimiter: "omit",
    boundary: "newline",
    optbreak: "newline",
    atom: "omit",
  },
  "verses-and-text": {
    content: "verbatim",
    slot: "verbatim",
    chrome: "omit",
    delimiter: "space",
    boundary: "newline",
    optbreak: "newline",
    atom: "omit",
  },
};

type Piece = { from: number; to: number; rule: keyof ProfileRules };

function pieces(doc: string, s: DocStructure, wantVerseSlots: boolean): Piece[] {
  const out: Piece[] = [];
  const add = (from: number, to: number, rule: keyof ProfileRules) => {
    if (to > from) out.push({ from, to, rule });
  };

  for (const v of s.verses) {
    add(v.markerFrom, v.markerTo, "chrome");
    if (v.num !== null) {
      add(v.numFrom, v.numTo, wantVerseSlots ? "slot" : "chrome");
      add(v.numTo, v.contentFrom, "delimiter");
    } else add(v.markerTo, v.contentFrom, "chrome");
  }

  for (const l of s.lines) {
    if (l.cls === "slot.c") {
      add(l.from, l.markerEnd, "chrome");
      if (l.num !== null) {
        add(l.numFrom, l.numTo, "slot");
        add(l.numTo, l.contentFrom, "delimiter");
      } else add(l.markerEnd, l.contentFrom, "chrome");
    } else if (l.marker && l.cls !== "slot.v") {
      add(l.from, l.contentFrom, "chrome");
    }
    for (const n of l.notes) add(n.from, n.to, "atom");
    for (const m of l.milestones) add(m.from, m.to, "atom");
    for (const bk of l.breaks) add(bk.from, bk.to, "optbreak");
    for (const wd of l.words) {
      add(wd.from, wd.surfaceFrom, "chrome");
      add(wd.attrFrom, wd.to, "chrome");
    }
  }

  const inside = (p: number) => {
    for (let i = 0; i < s.blocks.length; i++)
      if (p > s.blocks.fromAt(i) && p < s.blocks.toAt(i)) return true;
    return false;
  };
  for (let p = 0; p < doc.length; p++)
    if (doc[p] === "\n") add(p, p + 1, inside(p) ? "chrome" : "boundary");

  out.sort((a, b) => a.from - b.from || a.to - b.to);
  const flat: Piece[] = [];
  let at = 0;
  for (const p of out) {
    if (p.to <= at) continue;
    flat.push({ from: Math.max(p.from, at), to: p.to, rule: p.rule });
    at = p.to;
  }
  return flat;
}

export function copyFold(
  doc: string,
  s: DocStructure,
  profile: CopyProfile,
  from: number,
  to: number,
): string {
  if (profile === "source") return doc.slice(from, to);
  const rules = RULES[profile];
  const wantVerseSlots = rules.slot === "verbatim";
  const ps = pieces(doc, s, profile === "text-only" ? false : wantVerseSlots);
  let out = "";
  let at = from;
  for (const p of ps) {
    if (p.to <= from) continue;
    if (p.from >= to) break;
    if (p.from > at) out += doc.slice(at, Math.min(p.from, to));
    const rule = rules[p.rule];
    if (rule === "verbatim") out += doc.slice(Math.max(p.from, from), Math.min(p.to, to));
    else if (rule === "newline") out += "\n";
    else if (rule === "space") out += " ";
    at = Math.max(at, p.to);
  }
  if (at < to) out += doc.slice(at, to);
  return out
    .replace(/[ \t]*\n[ \t\n]*/g, "\n")
    .replace(/^[\s]+|[\s]+$/g, "")
    .replace(/  +/g, " ");
}

export const copyProfileFacet = Facet.define<CopyProfile, CopyProfile>({
  combine: (v) => v[0] ?? "source",
});

export const copyProfile: Extension = EditorView.clipboardOutputFilter.of((text, state) => {
  const profile = state.facet(copyProfileFacet);
  if (profile === "source" || state.facet(modeFacet) !== "regular") return text;
  const sel = state.selection.main;
  if (sel.empty) return text;
  return copyFold(docText(state), structureAt(state), profile, sel.from, sel.to);
});
