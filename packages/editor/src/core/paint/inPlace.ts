/**
 * Words drawn by the editor that are typed into where they read: a chapter's
 * label, the book's name (Thomas, 2026-10-30). Plain text, no box: Enter or
 * a press elsewhere keeps what was typed, Escape puts the words back. The
 * keys and presses are the span's own, so the editor's keymap never sees them.
 */
export interface InPlace {
  readonly value: string;
  readonly className: string;
  readonly placeholder?: string;
  /** What was typed, trimmed, when it differs from `value`. */
  readonly commit: (typed: string, span: HTMLElement) => void;
}

export function inPlaceWords(spec: InPlace): HTMLElement {
  const span = document.createElement("span");
  span.className = `usfm-in-place ${spec.className}`;
  span.contentEditable = "plaintext-only";
  span.spellcheck = false;
  span.textContent = spec.value;
  if (spec.placeholder !== undefined) span.dataset["placeholder"] = spec.placeholder;
  let cancelled = false;
  span.onmousedown = (event) => event.stopPropagation();
  span.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      span.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelled = true;
      span.blur();
    }
  };
  span.onblur = () => {
    const typed = (span.textContent ?? "").replace(/\s+/g, " ").trim();
    if (cancelled || typed === spec.value) {
      cancelled = false;
      span.textContent = spec.value;
      return;
    }
    spec.commit(typed, span);
  };
  // Typing here must not reach CodeMirror's input handling either.
  span.addEventListener("beforeinput", (event) => event.stopPropagation());
  span.addEventListener("input", (event) => event.stopPropagation());
  return span;
}
