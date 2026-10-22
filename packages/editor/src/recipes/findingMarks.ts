import { type Diagnostic, forEachDiagnostic } from "@codemirror/lint";
import {
  type EditorView,
  layer,
  type LayerMarker,
  RectangleMarker,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

type Severity = Diagnostic["severity"];

const RANK: Record<Severity, number> = { hint: 0, info: 1, warning: 2, error: 3 };

const worse = (held: Severity | undefined, next: Severity): Severity =>
  held === undefined || RANK[next] > RANK[held] ? next : held;

const DOT = 10;
const INSET = 6;

/** Marks closer than a row's half-height share a row (a superscript number and the text beside it differ by a few pixels): one mark, the worst. */
const oneMarkPerRow = (
  found: { y: number; severity: Severity }[],
): { y: number; severity: Severity }[] => {
  const rows: { y: number; severity: Severity }[] = [];
  for (const mark of found.toSorted((left, right) => left.y - right.y)) {
    const last = rows.at(-1);
    if (last !== undefined && mark.y - last.y < 12)
      last.severity = worse(last.severity, mark.severity);
    else rows.push({ ...mark });
  }
  return rows;
};

/**
 * A coloured dot at the left edge, level with each row that holds a finding,
 * in its worst severity: for scanning down the page, never for clicking. A
 * finding is acted on where it is drawn (its word, its verse number, its
 * caller). A layer measures with the selection, so a dot follows its row
 * through wrapping, scrolling and resizing; a gutter could only mark the top
 * of a paragraph.
 */
const findingDots = layer({
  above: false,
  class: "cm-finding-dots",
  markers(view: EditorView): readonly LayerMarker[] {
    const scroller = view.scrollDOM.getBoundingClientRect();
    const left = INSET + view.scrollDOM.scrollLeft;
    const top = scroller.top - view.scrollDOM.scrollTop;
    const { from: visibleFrom, to: visibleTo } = view.viewport;
    const found: { y: number; severity: Severity }[] = [];
    forEachDiagnostic(view.state, (diagnostic, from) => {
      if (from < visibleFrom || from > visibleTo) return;
      const at = view.coordsAtPos(from, 1) ?? view.coordsAtPos(from, -1);
      if (at !== null) found.push({ y: at.bottom - top, severity: diagnostic.severity });
    });
    return oneMarkPerRow(found).map(
      ({ y, severity }) =>
        new RectangleMarker(
          `cm-finding-dot cm-finding-dot-${severity}`,
          left,
          y - DOT - 4,
          DOT,
          DOT,
        ),
    );
  },
  update: (update: ViewUpdate) =>
    update.docChanged ||
    update.viewportChanged ||
    update.geometryChanged ||
    update.transactions.some((tr) => tr.effects.length > 0),
});

/**
 * A footnote's caller in the severity's colour when a finding starts at its
 * note (`\f` never closed, say). The caller is a widget, which a lint mark
 * cannot reach, so its class is set after each draw.
 */
const flaggedCallers = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.schedule(view);
    }
    update(update: ViewUpdate) {
      this.schedule(update.view);
    }
    schedule(view: EditorView) {
      view.requestMeasure({
        key: this,
        read: () => {
          const flagged = new Map<string, Severity>();
          forEachDiagnostic(view.state, (diagnostic, from) => {
            const key = String(from);
            flagged.set(key, worse(flagged.get(key), diagnostic.severity));
          });
          return flagged;
        },
        write: (flagged) => {
          for (const caller of view.contentDOM.querySelectorAll<HTMLElement>(".usfm-caller")) {
            const severity = flagged.get(caller.dataset["noteAt"] ?? "");
            caller.classList.toggle("usfm-caller-error", severity === "error");
            caller.classList.toggle("usfm-caller-warning", severity === "warning");
          }
        },
      });
    }
  },
);

export const findingMarks = () => [findingDots, flaggedCallers];
