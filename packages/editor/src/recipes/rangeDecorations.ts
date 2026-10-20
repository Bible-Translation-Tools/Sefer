import { Decoration, type DecorationSet } from "@codemirror/view";

export const rangeDecorations = (
  doc: { length: number; lineAt: (at: number) => { from: number } },
  range: { from: number; to: number },
  span: Decoration,
  line: Decoration,
): DecorationSet => {
  const from = Math.max(0, Math.min(range.from, doc.length));
  const to = Math.max(from, Math.min(range.to, doc.length));
  return to > from
    ? Decoration.set([span.range(from, to)], true)
    : Decoration.set([line.range(doc.lineAt(from).from)], true);
};
