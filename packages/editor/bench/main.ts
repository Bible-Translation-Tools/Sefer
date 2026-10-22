import {
  editorPolicy,
  mountBookEditor,
  mountReader,
  seatBook,
  type BookEditorMount,
  type EditorBook,
  type MarkedRange,
  type ProjectionName,
  type ReaderMount,
} from "@sefer/editor";
import { makeBook } from "@sefer/text/book";
import { addressLabel } from "@sefer/text/location/address";
import { decode } from "@sefer/text/source";
import { Result } from "effect";

import { catalogue } from "./catalogue";
import edges from "./edges.usfm?raw";
import { loadEngine } from "./engine";
import { gestureLog, type Gesture, type Ruling } from "./log";

import "@sefer/editor/editor.css";
import "./bench.css";

const $ = <T extends HTMLElement>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`bench: no ${selector}`);
  return found;
};

const engine = await loadEngine();

const editorPane = $("#editor");
const mirrorPane = $("#mirror");
const logList = $<HTMLOListElement>("#log");
const clipboardPane = $("#clipboard");
const status = $("#status");
const modeSelect = $<HTMLSelectElement>("#mode");
const docSelect = $<HTMLSelectElement>("#doc");
const presetBoxes = [...document.querySelectorAll<HTMLInputElement>("input[data-preset]")];
const caretMoves = $<HTMLInputElement>("#caret-moves");

/** Shows a string with its invisibles drawn, so a newline or a space is never a guess. */
const visible = (text: string, breaks = false): string =>
  text
    .replaceAll(" ", "·")
    .replaceAll("\t", "→")
    .replaceAll("\n", breaks ? "↵\n" : "↵");

// ── the gesture log ─────────────────────────────────────────────────────────

const row = (className: string, ...cells: (string | Node)[]): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = className;
  for (const cell of cells) {
    if (typeof cell === "string") {
      const span = document.createElement("span");
      span.textContent = cell;
      li.append(span);
    } else li.append(cell);
  }
  return li;
};

const chip = (className: string, text: string): HTMLElement => {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
};

const append = (li: HTMLLIElement): void => {
  const stuck = logList.scrollHeight - logList.scrollTop - logList.clientHeight < 24;
  logList.append(li);
  while (logList.childElementCount > 500) logList.firstElementChild?.remove();
  if (stuck) logList.scrollTop = logList.scrollHeight;
};

const rows = new WeakMap<Gesture, HTMLLIElement>();

const cellsOf = (gesture: Gesture): (string | Node)[] => {
  const cells: (string | Node)[] = [
    chip("seq", `#${gesture.seq}`),
    chip("input", gesture.inputs.join(" ") || "—"),
    chip("origin", gesture.origin),
    chip("head", `${gesture.headBefore} → ${gesture.headAfter}`),
  ];
  gesture.changes.forEach((change, at) => {
    const removed = gesture.removed[at] ?? "";
    if (removed !== "") cells.push(chip("removed", `− ${visible(removed)}`));
    if (change.insert !== "") cells.push(chip("inserted", `+ ${visible(change.insert)}`));
    cells.push(
      chip("where", change.from === change.to ? `@${change.from}` : `${change.from}–${change.to}`),
    );
  });
  for (const ruling of gesture.rulings)
    cells.push(
      chip(
        `ruling ${ruling.verdict}`,
        `${ruling.verdict} ${ruling.rule}${ruling.detail === undefined ? "" : `: ${ruling.detail}`}`,
      ),
    );
  return cells;
};

/** Draws a gesture's row, or redraws it in place; a row with nothing but a caret move shows only when asked. */
const showGesture = (gesture: Gesture): void => {
  const shown = gesture.changes.length > 0 || gesture.rulings.length > 0 || caretMoves.checked;
  const held = rows.get(gesture);
  if (!shown) {
    if (!gesture.open) held?.remove();
    return;
  }
  const kind =
    gesture.changes.length > 0 ? "mutation" : gesture.rulings.length > 0 ? "ruled" : "selection";
  const next = row(`gesture ${kind}${gesture.open ? " open" : ""}`, ...cellsOf(gesture));
  rows.set(gesture, next);
  if (held === undefined) append(next);
  else held.replaceWith(next);
};

const showLoose = (ruling: Ruling): void =>
  append(
    row(
      "gesture loose",
      chip("seq", "book"),
      chip(`ruling ${ruling.verdict}`, `${ruling.verdict} ${ruling.rule} ${ruling.detail ?? ""}`),
    ),
  );

let book: EditorBook | undefined;
const log = gestureLog({
  level: () => "spans",
  onUpdate: (gesture) => {
    showGesture(gesture);
    scheduleMirror();
  },
  onLoose: showLoose,
});

const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock"]);

// Which input started the next gesture: read in the capture phase, before the editor's own handlers.
const describeKey = (event: KeyboardEvent): string => {
  const mods = [
    event.metaKey ? "⌘" : "",
    event.ctrlKey ? "⌃" : "",
    event.altKey ? "⌥" : "",
    event.shiftKey && event.key.length > 1 ? "⇧" : "",
  ].join("");
  return mods + (event.key === " " ? "Space" : event.key);
};
editorPane.addEventListener(
  "keydown",
  (event) => {
    if (!MODIFIERS.has(event.key)) log.input(describeKey(event));
  },
  true,
);
editorPane.addEventListener(
  "beforeinput",
  (event) =>
    log.input(event.inputType === "insertText" ? `“${event.data ?? ""}”` : event.inputType),
  true,
);
editorPane.addEventListener("mousedown", () => log.input("click"), true);

// ── the clipboard, as each event carried it ──────────────────────────────────

const showClipboard = (event: ClipboardEvent): void => {
  const data = event.clipboardData;
  clipboardPane.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = `${event.type} at ${new Date().toLocaleTimeString()}`;
  clipboardPane.append(heading);
  if (data === null || data.types.length === 0) {
    clipboardPane.append(chip("empty", "nothing on it"));
    return;
  }
  for (const type of data.types) {
    const label = document.createElement("div");
    label.className = "mime";
    label.textContent = type;
    const body = document.createElement("pre");
    body.textContent = visible(data.getData(type), true);
    clipboardPane.append(label, body);
  }
};
// Bubble phase: the editor has written the clipboard by the time a copy reaches the pane.
for (const type of ["copy", "cut"] as const)
  editorPane.addEventListener(type, (event) => showClipboard(event));
editorPane.addEventListener(
  "paste",
  (event) => {
    log.input("paste");
    showClipboard(event);
  },
  true,
);

// ── the editor, and the USFM underneath it ───────────────────────────────────

let editor: BookEditorMount | undefined;
let mirror: ReaderMount | undefined;
let text = "";
let detachChanges: (() => void) | undefined;

const policy = () => {
  const mode = modeSelect.value;
  const presets: ProjectionName[] = presetBoxes
    .filter((box) => box.checked)
    .map((box) => box.dataset.preset ?? "");
  if (mode === "usfm") return editorPolicy("usfm", ...presets);
  return mode === "lines"
    ? editorPolicy("regular", "line-by-line", ...presets)
    : editorPolicy("regular", ...presets);
};

/** The editor's selection, drawn on the mirror: a caret is a one-character mark with an edge. */
const caretMarks = (): readonly MarkedRange[] => {
  if (book === undefined) return [];
  const { from, to, head } = book.selection();
  if (from !== to) return [{ from, to, class: "bench-selection" }];
  const doc = book.source().text;
  if (head < doc.length && doc[head] !== "\n")
    return [{ from: head, to: head + 1, class: "bench-caret" }];
  if (head > 0 && doc[head - 1] !== "\n")
    return [{ from: head - 1, to: head, class: "bench-caret-after" }];
  return head < doc.length ? [{ from: head, to: head + 1, class: "bench-caret" }] : [];
};

const placeOf = (): string => {
  const where = editor?.where();
  return where === undefined ? "nowhere" : addressLabel(where, where.book, "Introduction");
};

let mirrorFrame: number | undefined;
const scheduleMirror = (): void => {
  if (mirrorFrame !== undefined) return;
  mirrorFrame = requestAnimationFrame(() => {
    mirrorFrame = undefined;
    if (mirror === undefined || book === undefined) return;
    mirror.reclip({ from: 0, to: mirror.length() });
    mirror.remark(caretMarks());
    mirror.reveal({ from: book.selection().head });
    status.textContent = `caret ${book.selection().head} of ${book.source().text.length} · ${placeOf()}`;
  });
};

const open = (usfm: string, name: string): void => {
  detachChanges?.();
  mirror?.destroy();
  editor?.destroy();
  book?.close();
  editorPane.replaceChildren();
  mirrorPane.replaceChildren();
  logList.replaceChildren();

  const source = decode(new TextEncoder().encode(usfm.replaceAll("\r\n", "\n")));
  if (Result.isFailure(source)) throw new Error(source.failure.reason);
  const plain = makeBook(name, source.success);
  book = seatBook(plain, {
    analyze: engine.analyzeBook(plain.id),
    observability: log.observability,
  });
  text = book.source().text;
  detachChanges = book.changes((_, changes) => {
    log.published(changes, text);
    text = book?.source().text ?? "";
  });

  editor = mountBookEditor({
    parent: editorPane,
    book,
    onCaret: (head) => {
      log.caret(head);
      scheduleMirror();
    },
  });
  editor.setPolicy(policy());

  const analysis = book.structure().analysis;
  if (analysis === null) throw new Error("bench: the engine returned no parse");
  mirror = mountReader({
    parent: mirrorPane,
    analysis,
    range: { from: 0, to: analysis.text.length },
    policy: editorPolicy("usfm"),
    marks: [],
    surface: "bench-mirror",
    label: "bench-mirror",
  });
  mirror.follow(book.funnel());
  scheduleMirror();
  editor.focus();
};

// ── the controls ─────────────────────────────────────────────────────────────

const { text: catalogueText, skipped } = catalogue();
$("#skipped").textContent =
  skipped.length === 0 ? "" : `catalogue skips: ${skipped.map((name) => `\\${name}`).join(" ")}`;

const DOCS: Record<string, () => void> = {
  catalogue: () => open(catalogueText, "TIT.usfm"),
  edges: () => open(edges, "PHP.usfm"),
};

const fileInput = $<HTMLInputElement>("#file");
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file !== undefined) open(await file.text(), file.name);
});

docSelect.addEventListener("change", () => {
  if (docSelect.value === "file") fileInput.click();
  else DOCS[docSelect.value]?.();
  try {
    localStorage.setItem("bench.doc", docSelect.value === "file" ? "catalogue" : docSelect.value);
  } catch {}
});

const applyPolicy = (): void => {
  editor?.setPolicy(policy());
  scheduleMirror();
  try {
    localStorage.setItem("bench.mode", modeSelect.value);
  } catch {}
};
modeSelect.addEventListener("change", applyPolicy);
for (const box of presetBoxes) box.addEventListener("change", applyPolicy);
$("#clear").addEventListener("click", () => logList.replaceChildren());

/** For a driver (agent-browser, Playwright): the live mounts, and a caret placed by searched text. */
Object.assign(globalThis, {
  __bench: {
    editor: () => editor,
    book: () => book,
    caretAt: (needle: string, offset = 0): number => {
      const at = (book?.source().text ?? "").indexOf(needle);
      if (at >= 0) editor?.reveal({ from: at + offset }, { select: true, scroll: "center" });
      editor?.focus();
      return at;
    },
    // A headless browser runs neither ⌘C nor ⌘V, so a driver sends the events itself.
    clip: (kind: "copy" | "cut"): Record<string, string> => {
      const data = new DataTransfer();
      editorPane
        .querySelector(".cm-content")
        ?.dispatchEvent(
          new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true }),
        );
      return Object.fromEntries(data.types.map((type) => [type, data.getData(type)]));
    },
    paste: (carried: Record<string, string>): void => {
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(carried)) data.setData(type, value);
      editorPane
        .querySelector(".cm-content")
        ?.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    },
  },
});

try {
  modeSelect.value = localStorage.getItem("bench.mode") ?? "reading";
  docSelect.value = localStorage.getItem("bench.doc") ?? "catalogue";
} catch {}
(DOCS[docSelect.value] ?? DOCS.catalogue)?.();
