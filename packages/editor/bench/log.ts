import type { Change } from "@sefer/text/source";

/** One rule that did not simply pass: what it decided, and why. */
export interface Ruling {
  readonly rule: string;
  readonly verdict: string;
  readonly detail?: string;
}

/** One gesture, as the editor's trace and the Book's publication report it. */
export interface Gesture {
  readonly seq: number;
  /** The keys, pastes or clicks that landed in it, in order; empty when the bench saw none. */
  readonly inputs: string[];
  readonly origin: string;
  readonly headBefore: number;
  headAfter: number;
  /** Still open: the editor closes a trace when it paints, or when the next one opens. */
  open: boolean;
  /** What the Book accepted: CodeMirror's convention, coordinates of the text before. */
  readonly changes: Change[];
  /** The text each change replaced, read before it was applied. */
  readonly removed: string[];
  readonly rulings: Ruling[];
}

type Attrs = Readonly<Record<string, string | number | boolean>>;
type Level = "off" | "verdicts" | "spans" | "all";

const NOOP_OPERATION = {
  trace: "",
  attr: () => undefined,
  rename: () => undefined,
  end: () => 0,
  note: () => undefined,
};

const rulingOf = (rule: string, verdict: string, detail?: string): Ruling =>
  detail === undefined ? { rule, verdict } : { rule, verdict, detail };

/**
 * The bench's half of `EditorObservability`: the editor opens one operation
 * per gesture and notes every phase that refused or rewrote, and this turns
 * them into `Gesture` rows. The Book's own change listener fills `changes`
 * on whichever gesture is open, so a row reads "this key, these edits, these
 * rulings, the caret here".
 *
 * Rows are live. A key the editor refuses dispatches nothing, so nothing
 * paints and its trace stays open until the next gesture opens one; a second
 * refused key lands in the same trace. So `onUpdate` fires on every change to
 * a gesture, not only at its end, and a key pressed while a trace is open and
 * still being ruled on joins that trace's `inputs`.
 */
export const gestureLog = (options: {
  readonly level: () => Level;
  readonly onUpdate: (gesture: Gesture) => void;
  readonly onLoose: (ruling: Ruling) => void;
}) => {
  let pending: string | null = null;
  let open: Gesture | null = null;

  const claim = (gesture: Gesture): void => {
    if (pending === null) return;
    gesture.inputs.push(pending);
    pending = null;
  };

  return {
    observability: {
      level: options.level,
      note: (rule: string, verdict: string, detail?: string) => {
        options.onLoose(rulingOf(rule, verdict, detail));
      },
      operation: (name: string, attrs?: Attrs) => {
        if (name === "editor.render") return NOOP_OPERATION;
        const head = Number(attrs?.["editor.head"] ?? -1);
        const gesture: Gesture = {
          seq: Number(attrs?.["editor.seq"] ?? 0),
          inputs: [],
          origin: String(attrs?.["editor.origin"] ?? "?"),
          headBefore: head,
          headAfter: head,
          open: true,
          changes: [],
          removed: [],
          rulings: [],
        };
        claim(gesture);
        open = gesture;
        options.onUpdate(gesture);
        return {
          trace: String(gesture.seq),
          attr: () => undefined,
          rename: () => undefined,
          note: (rule: string, verdict: string, detail?: string) => {
            claim(gesture);
            gesture.rulings.push(rulingOf(rule, verdict, detail));
            options.onUpdate(gesture);
          },
          end: () => {
            gesture.open = false;
            if (open === gesture) open = null;
            options.onUpdate(gesture);
            return 0;
          },
        };
      },
    },
    /** What the next gesture was started by, or what the open one is about to rule on. */
    input: (what: string) => {
      pending = what;
    },
    /** The caret moved: the open gesture's "after", as it happens rather than when the trace closes. */
    caret: (head: number) => {
      if (open === null) return;
      open.headAfter = head;
      options.onUpdate(open);
    },
    /** The Book published these changes, read against the text before them. */
    published: (changes: readonly Change[], before: string) => {
      if (open === null) return;
      for (const change of changes) {
        open.changes.push(change);
        open.removed.push(before.slice(change.from, change.to));
      }
      options.onUpdate(open);
    },
  };
};
