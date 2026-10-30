import { type Diagnostic, forEachDiagnostic } from "@codemirror/lint";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

type Severity = Diagnostic["severity"];

const RANK: Record<Severity, number> = { hint: 0, info: 1, warning: 2, error: 3 };

const worse = (held: Severity | undefined, next: Severity): Severity =>
  held === undefined || RANK[next] > RANK[held] ? next : held;

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

/**
 * No marks in the margin: a finding shows where it can be fixed (its word
 * underlined, its verse number, its caller), and one that cannot be fixed in
 * this view is not drawn in the editor at all (Thomas, 2026-10-30).
 */
export const findingMarks = () => [flaggedCallers];
