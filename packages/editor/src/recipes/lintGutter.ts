import { type Diagnostic, diagnosticCount, forEachDiagnostic } from "@codemirror/lint";
import { type EditorState, RangeSet, type Text } from "@codemirror/state";
import {
  type BlockInfo,
  type EditorView,
  GutterMarker,
  ViewPlugin,
  type ViewUpdate,
  gutter,
} from "@codemirror/view";

import { pickField } from "../core/clip";
import { assignment } from "../core/registry";
import { openLineMenu } from "../core/verseLines";

type Severity = Diagnostic["severity"];

const RANK: Record<Severity, number> = { hint: 0, info: 1, warning: 2, error: 3 };

const worse = (held: Severity | undefined, next: Severity): Severity =>
  held === undefined || RANK[next] > RANK[held] ? next : held;

class LintMarker extends GutterMarker {
  readonly severity: Severity;
  constructor(severity: Severity) {
    super();
    this.severity = severity;
  }
  eq(other: LintMarker) {
    return other.severity === this.severity;
  }
  toDOM() {
    const marker = document.createElement("div");
    marker.className = `cm-lint-marker cm-lint-marker-${this.severity}`;
    return marker;
  }
}

/**
 * One marker per line as it is drawn, at its worst finding. CodeMirror's own
 * lint gutter pins a marker to the start of the file's line, and a line the
 * reading view joins into the one before (`\p` then `\v 1`) starts mid-row,
 * so its marker was never drawn.
 */
const markersOf = (view: EditorView): RangeSet<LintMarker> => {
  const worst = new Map<number, Severity>();
  forEachDiagnostic(view.state, (diagnostic, from) => {
    const block = view.lineBlockAt(from);
    if (block.height === 0) return;
    worst.set(block.from, worse(worst.get(block.from), diagnostic.severity));
  });
  return RangeSet.of(
    [...worst].map(([at, severity]) => new LintMarker(severity).range(at)),
    true,
  );
};

interface Held {
  readonly doc: Text;
  readonly count: number;
  readonly projection: unknown;
  readonly pick: unknown;
  readonly markers: RangeSet<LintMarker>;
}

const keyOf = (state: EditorState) => ({
  doc: state.doc,
  count: diagnosticCount(state),
  projection: state.facet(assignment),
  pick: state.field(pickField, false),
});

/** The markers, worked out again only when the text, the findings, the projection or the chapter change. */
const markerCache = ViewPlugin.fromClass(
  class {
    held: Held | null = null;
    markers(view: EditorView): RangeSet<LintMarker> {
      const key = keyOf(view.state);
      const held = this.held;
      if (
        held !== null &&
        held.doc === key.doc &&
        held.count === key.count &&
        held.projection === key.projection &&
        held.pick === key.pick
      )
        return held.markers;
      const markers = markersOf(view);
      this.held = { ...key, markers };
      return markers;
    }
    update(_update: ViewUpdate) {}
  },
);

const clickOpensMenu = (view: EditorView, _line: BlockInfo, event: Event): boolean =>
  event instanceof MouseEvent && openLineMenu(view, event.clientY);

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

export const lintGutter = () => [
  markerCache,
  flaggedCallers,
  gutter({
    class: "cm-gutter-lint",
    markers: (view) => view.plugin(markerCache)?.markers(view) ?? RangeSet.empty,
    domEventHandlers: { mousedown: clickOpensMenu },
  }),
];
