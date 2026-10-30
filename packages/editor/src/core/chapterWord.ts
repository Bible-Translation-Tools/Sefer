import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { structureAt } from "./docStructure";
import { trusted } from "./kernel";
import { chapterTitles } from "./verseLines";
import { phrase } from "./words";

/**
 * A chapter's title typed into where it reads (Thomas, 2026-10-30), in place
 * of the chapter labels dialog. Its word ("Chapter", "Psalm") is the book's,
 * so a new word asks once, under the title: this book, or every book. The
 * host makes the change (Sefer's `chapterLabels.standardize`); a host that
 * gives no answer here has the word written as this book's label.
 */
export type ChapterWordScope = "book" | "all";

export const chapterWordHost = Facet.define<
  (word: string, scope: ChapterWordScope) => void,
  ((word: string, scope: ChapterWordScope) => void) | undefined
>({ combine: (values) => values[0] });

/** The book's own label, before its first chapter: rewritten, or written above chapter 1. */
function writeBookWord(view: EditorView, word: string): void {
  const doc = view.state.doc.toString();
  const structure = structureAt(view.state);
  const first = structure.chapters.find((row) => row.label !== "");
  if (first === undefined) return;
  const before = doc.slice(0, first.from);
  const found = /(^|\n)\\cl[ \t]+([^\n]*)/.exec(before);
  const changes =
    found !== null
      ? {
          from: found.index + found[0].length - found[2].length,
          to: found.index + found[0].length,
          insert: word,
        }
      : { from: first.from, to: first.from, insert: `\\cl ${word}\n` };
  view.dispatch({
    changes,
    annotations: trusted.of("chapter-word"),
    userEvent: "input.chapterWord",
  });
}

/** A chapter's own label (`\cl` after its `\c`), rewritten as typed. */
export function writeOwnLabel(view: EditorView, chapterFrom: number, words: string): void {
  const doc = view.state.doc.toString();
  const chapter = chapterTitles(doc, structureAt(view.state)).chapters.find(
    (row) => row.line.from === chapterFrom,
  );
  const label = chapter?.labels.find((line) => doc.slice(line.contentFrom, line.to).trim() !== "");
  if (label === undefined) return;
  view.dispatch({
    changes: { from: label.contentFrom, to: label.to, insert: words },
    annotations: trusted.of("chapter-label"),
    userEvent: "input.chapterWord",
  });
}

/** A new word for the book's chapters: asked under the title, then handed on. */
export function chapterWordTyped(
  view: EditorView,
  word: string,
  span: HTMLElement,
  restore: () => void,
): void {
  if (word === "") {
    restore();
    return;
  }
  const host = view.state.facet(chapterWordHost);
  if (host === undefined) {
    writeBookWord(view, word);
    return;
  }
  const ask = document.createElement("span");
  ask.className = "usfm-chapter-ask";
  ask.contentEditable = "false";
  ask.setAttribute("role", "dialog");
  const question = document.createElement("span");
  question.textContent = phrase(view.state, "chapterWord.ask", { word });
  const choose = (scope: ChapterWordScope | null) => {
    ask.remove();
    document.removeEventListener("mousedown", outside, true);
    if (scope === null) restore();
    else host(word, scope);
    view.focus();
  };
  const button = (scope: ChapterWordScope) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = phrase(view.state, scope === "book" ? "chapterWord.book" : "chapterWord.all");
    b.onmousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      choose(scope);
    };
    return b;
  };
  const outside = (event: MouseEvent) => {
    if (!(event.target instanceof Node) || !ask.contains(event.target)) choose(null);
  };
  ask.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape") choose(null);
  };
  ask.append(question, button("book"), button("all"));
  span.after(ask);
  setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  ask.querySelector("button")?.focus();
}
