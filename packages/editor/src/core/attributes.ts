import { type ChangeSpec, type EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MARKER_ATTRIBUTES, MARKERS, MarkerKind } from "@sefer/text/engine/analysis";

import { figureAt } from "./figures";
import { docText, lineIndexAt, structureAt } from "./model/docStructure";

/** One attribute: `who="Paul"`, or a bare default value (`\w grace|grace\w*`) with no name. */
export interface Attribute {
  readonly name: string | null;
  readonly value: string;
}

/**
 * A piece of markup that carries an attribute list: a milestone
 * (`\qt-s |who="Paul"\*`) or a character run (`\w grace|lemma="grace"\w*`,
 * `\rb`, `\jmp`, `\fig`). The DATA half of the attribute popover: a host can
 * read and write it with no popover at all.
 */
export interface AttributedMarkup {
  readonly kind: "milestone" | "char" | "figure";
  /** The marker as spelled, no backslash: `qt-s`, `w`. */
  readonly marker: string;
  /** Its row in the engine's marker catalogue (`MARKERS`), or -1 when it has none. */
  readonly markerIdx: number;
  /** The whole markup, marker to terminator or closer. */
  readonly from: number;
  readonly to: number;
  /** The attribute list's span, `|` included; empty (`from === to`) where a list would go when there is none. */
  readonly listFrom: number;
  readonly listTo: number;
  readonly attributes: readonly Attribute[];
}

/**
 * One list's attributes, broken by the engine (`Analysis.attrs`, kitchen's
 * `attrs` bound by the host): a bare default value has an empty name span.
 * None when the parse is not of this text.
 */
function readList(state: EditorState, from: number, to: number): Attribute[] {
  const analysis = structureAt(state).analysis;
  const doc = docText(state);
  if (from >= to || analysis === null || analysis.text !== doc) return [];
  return analysis.attrs(from, to).attrs.map(({ name, value }) => ({
    name: name.from === name.to ? null : doc.slice(name.from, name.to),
    value: doc.slice(value.from, value.to),
  }));
}

/** The list as written back: `|who="Paul"`, `|grace` for a bare default, `""` for none. */
function writeAttributes(attributes: readonly Attribute[]): string {
  const kept = attributes.filter((a) => a.value !== "" || a.name !== null);
  if (kept.length === 0) return "";
  const bare = kept.length === 1 && kept[0]?.name === null;
  if (bare) return `|${kept[0]?.value ?? ""}`;
  return `|${kept.map((a) => `${a.name ?? "default"}="${a.value.replaceAll('"', "'")}"`).join(" ")}`;
}

/** `qt-s` → the `qt` milestone's catalogue row; -1 for a name the catalogue lacks. */
const milestoneRow = (spelled: string): number =>
  MARKERS.findIndex(
    (row) => row.kind === MarkerKind.Milestone && row.name === spelled.replace(/-[se]$/, ""),
  );

/** The attributed markup at `pos`: a milestone whose span holds it, or a character run. */
export function attributesAt(state: EditorState, pos: number): AttributedMarkup | null {
  const structure = structureAt(state);
  const doc = docText(state);
  const line = lineIndexAt(structure, pos);
  if (line >= 0)
    for (const m of structure.lines.at(line).milestones) {
      if (pos < m.from || pos > m.to) continue;
      // The list runs from its `|` to the terminator, or is empty just before the terminator.
      const terminator = doc.lastIndexOf("\\*", m.to - 1);
      const listTo = terminator > m.from ? terminator : m.to;
      const bar = doc.indexOf("|", m.from);
      const listFrom = bar >= 0 && bar < listTo ? bar : listTo;
      return {
        kind: "milestone",
        marker: m.name,
        markerIdx: milestoneRow(m.name),
        from: m.from,
        to: m.to,
        listFrom,
        listTo,
        attributes: readList(state, listFrom, listTo),
      };
    }
  const figure = figureAt(state, pos);
  if (figure !== null)
    return {
      kind: "figure",
      marker: "fig",
      markerIdx: figure.markerIdx,
      from: figure.from,
      to: figure.to,
      listFrom: figure.listFrom,
      listTo: figure.listTo,
      attributes: readList(state, figure.listFrom, figure.listTo),
    };
  for (const w of structure.words) {
    if (pos < w.from || pos > w.to) continue;
    return {
      kind: "char",
      marker: (MARKERS[w.marker]?.name ?? "").replace(/^\+/, ""),
      markerIdx: w.marker,
      from: w.from,
      to: w.to,
      listFrom: w.attrFrom,
      listTo: w.attrTo,
      attributes: readList(state, w.attrFrom, w.attrTo),
    };
  }
  return null;
}

/**
 * The change that gives `target` these attributes. A milestone keeps a space
 * between its marker and a list (`\qt-s |who="Paul"\*`); a character run's
 * list follows its last word directly.
 */
export function attributeChange(target: AttributedMarkup, next: readonly Attribute[]): ChangeSpec {
  const list = writeAttributes(next);
  const lead =
    target.kind === "milestone" && list !== "" && target.listFrom === target.listTo ? " " : "";
  return { from: target.listFrom, to: target.listTo, insert: lead + list };
}

/** A press on attributed markup: what the default popover, and any host listener, answers. */
export const activateMarkup = StateEffect.define<AttributedMarkup | null>();

/** Whether the spec defines attributes for a marker: kitchen's table (`MARKER_ATTRIBUTES`). */
const takesAttributes = (markerIdx: number): boolean => MARKER_ATTRIBUTES[markerIdx] !== undefined;

/**
 * A press on a milestone's pip, or on a word that has attributes or whose
 * marker takes them, activates it. A plain bold run does not: pressing into
 * ordinary formatting places the caret and nothing else. The press still
 * places the caret; this only adds the effect.
 */
export const attributeActivation = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const element = event.target instanceof Element ? event.target : null;
    const hit = element?.closest(".usfm-pip, .usfm-word, .usfm-fig");
    if (hit === null || hit === undefined || !view.contentDOM.contains(hit)) return false;
    const target = attributesAt(view.state, view.posAtDOM(hit));
    if (target === null) return false;
    if (
      target.kind === "char" &&
      target.attributes.length === 0 &&
      !takesAttributes(target.markerIdx)
    )
      return false;
    view.dispatch({ effects: activateMarkup.of(target) });
    return false;
  },
});
