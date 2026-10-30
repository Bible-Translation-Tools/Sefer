import {
  editorFeatures,
  editorPolicy,
  type EditorWords,
  type PhraseKey,
  mountBookEditor,
  mountReader,
  mountReference,
  seatBook,
  type BookEditorMount,
  type EditorBook,
  type MarkedRange,
  type ProjectionName,
  type ReaderMount,
  type ReferenceMount,
} from "@sefer/editor";
import { makeBook } from "@sefer/text/book";
import { addressLabel } from "@sefer/text/location/address";
import { decode } from "@sefer/text/source";
import { Result } from "effect";

import { loadEngine } from "./engine";
import { gestureLog, type Gesture, type Ruling } from "./log";
import { SCENARIOS, SKIPPED, type BenchText, type Scenario } from "./scenarios";

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
const referencePane = $("#reference");
const presetBoxes = [...document.querySelectorAll<HTMLInputElement>("input[data-preset]")];
const caretMoves = $<HTMLInputElement>("#caret-moves");
const wordsSelect = $<HTMLSelectElement>("#words");

const SPANISH_PHRASES: Partial<Record<PhraseKey, string>> = {
  "chip.pageBreak": "salto de página",
  "chip.publishedAs": "publicado como",
  "verseMenu.changeNumber": "Cambiar número",
  "verseMenu.removeMarker": "Quitar marca de versículo",
  "verseMenu.addVerseAfter": "Añadir versículo después",
  "attributes.hint": "Intro guarda · Esc cierra",
  "verseLines.verse": "Versículo",
  "verseLines.chapter": "Capítulo",
  "emptyChapter.prompt": "Haz clic aquí para empezar a editar {title}",
};

/** A URL `src` is used as it is; a bare file name gets a real placeholder image named after it. */
const samplePicture = (src: string): string =>
  /^https?:\/\//.test(src) ? src : `https://placehold.co/200x200?text=${encodeURIComponent(src)}`;

/** A sample translation, to prove the package's words come from the host: partial on purpose. */
const SPANISH: EditorWords = {
  marker: (marker, { closing }) => {
    const words: Record<string, string> = {
      pb: "salto de página",
      tr: "fila",
      th: "celda de encabezado",
      tc: "celda",
      fig: "figura",
      cat: "categoría",
      esbe: "fin del recuadro",
    };
    const base = marker?.replace(/\d+$/, "") ?? "";
    const word = words[base];
    return word === undefined ? undefined : closing ? `fin de ${word}` : word;
  },
  phrase: (key) => SPANISH_PHRASES[key],
};

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

const showClipboard = (event: ClipboardEvent, from: string): void => {
  const data = event.clipboardData;
  clipboardPane.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = `${event.type} in ${from}, ${new Date().toLocaleTimeString()}`;
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
for (const type of ["copy", "cut"] as const) {
  editorPane.addEventListener(type, (event) => showClipboard(event, "the editor"));
  referencePane.addEventListener(type, (event) => showClipboard(event, "the reference"));
}
editorPane.addEventListener(
  "paste",
  (event) => {
    log.input("paste");
    showClipboard(event, "the editor");
  },
  true,
);

// ── the editor, and the USFM underneath it ───────────────────────────────────

let editor: BookEditorMount | undefined;
let mirror: ReaderMount | undefined;
let reference: ReferenceMount | undefined;
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

/** The reference reads as the editor does, without its presets: Sefer's reference pane follows the mode alone. */
const referenceMode = (): ProjectionName =>
  modeSelect.value === "usfm" ? "usfm" : modeSelect.value === "lines" ? "line-by-line" : "default";

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

const canonical = (text: string): string => text.replaceAll("\r\n", "\n");

const open = (edited: BenchText, beside?: BenchText): void => {
  detachChanges?.();
  mirror?.destroy();
  reference?.destroy();
  reference = undefined;
  editor?.destroy();
  book?.close();
  editorPane.replaceChildren();
  mirrorPane.replaceChildren();
  referencePane.replaceChildren();
  logList.replaceChildren();

  engine.legacyMarkers([edited.text, beside?.text ?? ""]);
  $("#editor-title").textContent = `Editor · ${edited.label}`;
  $("#reference-pane").hidden = beside === undefined;
  $("#panes").classList.toggle("with-reference", beside !== undefined);
  if (beside !== undefined) {
    $("#reference-title").textContent = beside.label;
    reference = mountReference({
      parent: referencePane,
      text: canonical(beside.text),
      analyze: engine.analyzeBook(`${beside.name}#reference`),
      mode: referenceMode(),
    });
  }

  const source = decode(new TextEncoder().encode(canonical(edited.text)));
  if (Result.isFailure(source)) throw new Error(source.failure.reason);
  const plain = makeBook(edited.name, source.success);
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
    features: editorFeatures({ figures: { resolveSource: samplePicture } }),
    ...(wordsSelect.value === "es" ? { words: SPANISH } : {}),
    parent: editorPane,
    book,
    onCaret: (head) => {
      log.caret(head);
      scheduleMirror();
    },
  });
  editor.setPolicy(policy());
  // The attribute data API on its own: what a press activated, whether or not the popover shows.
  editor.onActivate((target) => {
    if (target === null) return;
    const listed = target.attributes.map((a) => `${a.name ?? "default"}=${a.value}`).join(" ");
    append(
      row(
        "gesture loose",
        chip("seq", "activate"),
        chip("input", `\\${target.marker}`),
        listed || "no attributes",
      ),
    );
  });

  // Sefer counts a chapter's verses from its reference text; so does the bench.
  if (beside !== undefined) editor.setExpectedVerses(engine.lastVerses(`${beside.name}#reference`));
  // Where Sefer suggests USFM mode to someone typing USFM in Refine.
  editor.onTypedUsfm((marker) =>
    append(
      row(
        "gesture loose",
        chip("seq", "typed usfm"),
        chip("input", `\\${marker}`),
        "USFM mode is there for this",
      ),
    ),
  );

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

$("#skipped").textContent =
  SKIPPED.length === 0 ? "" : `catalogue skips: ${SKIPPED.map((name) => `\\${name}`).join(" ")}`;

const tabs = $("#scenarios");
const remember = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const recalled = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const press = (id: string): void => {
  for (const button of tabs.querySelectorAll("button"))
    button.setAttribute("aria-pressed", String(button.dataset.id === id));
};

let current: Scenario | undefined;

const choose = (scenario: Scenario): void => {
  current = scenario;
  press(scenario.id);
  $("#note").textContent = scenario.note;
  open(scenario.edited, scenario.reference);
  remember("bench.scenario", scenario.id);
};

for (const scenario of SCENARIOS) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.id = scenario.id;
  button.textContent = scenario.label;
  button.addEventListener("click", () => choose(scenario));
  tabs.append(button);
}

const fileInput = $<HTMLInputElement>("#file");
const fileTab = document.createElement("button");
fileTab.type = "button";
fileTab.dataset.id = "file";
fileTab.textContent = "Open a file…";
fileTab.addEventListener("click", () => fileInput.click());
tabs.append(fileTab);
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  press("file");
  $("#note").textContent = file.name;
  open({ label: file.name, name: file.name, text: await file.text() });
  fileInput.value = "";
});

const applyPolicy = (): void => {
  editor?.setPolicy(policy());
  reference?.setMode(referenceMode());
  scheduleMirror();
  remember("bench.mode", modeSelect.value);
};
modeSelect.addEventListener("change", applyPolicy);
wordsSelect.addEventListener("change", () => {
  if (current !== undefined) choose(current);
});
for (const box of presetBoxes) box.addEventListener("change", applyPolicy);
$("#clear").addEventListener("click", () => logList.replaceChildren());

/** The pane a driver means: the editor, or the reference beside it. */
const contentOf = (pane: "editor" | "reference"): Element | null =>
  (pane === "editor" ? editorPane : referencePane).querySelector(".cm-content");

// A headless browser runs neither ⌘C nor ⌘V, so a driver sends the events itself.
const clip = (
  kind: "copy" | "cut",
  pane: "editor" | "reference" = "editor",
): Record<string, string> => {
  const data = new DataTransfer();
  contentOf(pane)?.dispatchEvent(
    new ClipboardEvent(kind, { clipboardData: data, bubbles: true, cancelable: true }),
  );
  return Object.fromEntries(data.types.map((type) => [type, data.getData(type)]));
};

/** For a driver (agent-browser, Playwright): the live mounts, a caret or a selection placed by searched text. */
Object.assign(globalThis, {
  __bench: {
    editor: () => editor,
    book: () => book,
    reference: () => reference,
    caretAt: (needle: string, offset = 0): number => {
      const at = (book?.source().text ?? "").indexOf(needle);
      if (at >= 0) editor?.reveal({ from: at + offset }, { select: true, scroll: "center" });
      editor?.focus();
      return at;
    },
    /**
     * Selects in the reference from the start of `from` to the end of `through`, and copies it.
     * One call, because a read-only view takes the page's selection back on the next tick.
     */
    copyFromReference: async (from: string, through: string): Promise<Record<string, string>> => {
      const text = reference?.text() ?? "";
      const start = text.indexOf(from);
      const end = text.indexOf(through, start);
      if (start < 0 || end < 0) return {};
      // CodeMirror copies only from a view the page's selection is in, and it learns where that
      // is from \`selectionchange\`, which fires after a tick; a drag leaves the page in that state.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      const content = contentOf("reference");
      if (content !== null) window.getSelection()?.selectAllChildren(content);
      await new Promise((settle) => setTimeout(settle, 50));
      reference?.reveal({ from: start, to: end + through.length }, { select: true });
      return clip("copy", "reference");
    },
    clip,
    paste: (carried: Record<string, string>): void => {
      const data = new DataTransfer();
      for (const [type, value] of Object.entries(carried)) data.setData(type, value);
      contentOf("editor")?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
  },
});

modeSelect.value = recalled("bench.mode") ?? "reading";
choose(SCENARIOS.find((scenario) => scenario.id === recalled("bench.scenario")) ?? SCENARIOS[0]!);
