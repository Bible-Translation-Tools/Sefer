/**
 * Reading a place out of what somebody typed: "luke 3", "luk 3.1",
 * "Lucas 3:1", "PHM", "1 john 2".
 *
 * One parser, three consumers — the sidebar's filter box, the book and chapter
 * pickers on the location bar, and the command palette, where typing a
 * reference is what you get when no command matches. They were going to grow
 * three different answers to "is `luk 3` a thing", and the third one would have
 * disagreed with the other two about `1 John`.
 *
 * The grammar is deliberately loose, because the input is a person in a hurry:
 *
 *     <book> [chapter [ : . , or space  verse]]
 *
 * A book is its id (`LUK`), its English canon name, or WHAT THIS PROJECT CALLS
 * IT — a translator working in Spanish types "Lucas", and `ProjectMetadata`
 * knows that is `LUK` whether the project declared itself in a Scripture
 * Burrito or a Resource Container. Matching folds case and accents, so
 * "exodo" finds "Éxodo", and falls back to prefix matching, because somebody
 * who typed four letters and pressed Enter wants to arrive somewhere.
 *
 * Numbers are read from the RIGHT, which is what makes "1 John 2:3" work: the
 * leading `1` is part of the name and only trailing digits are coordinates.
 *
 * Bounded by what the project HOLDS. `known` is the id list, and a reference is
 * never returned for a book this project does not have — an editor that
 * navigates to an empty screen because you typed a book you do not own has
 * answered the wrong question.
 *
 * LIKELY TESTABLE, once behaviour is pinned. This is the shape that earns a
 * test later and most of the app does not: pure, total, no services, no DOM,
 * and a table of inputs to expected outputs that reads as the specification —
 * "1 John 2:3" -> 1JN 2:3, "phil" -> PHP before PHM, "Éxodo"/"exodo" -> EXO,
 * "luk 3.1" and "Lucas 3:1" -> LUK 3:1, a book the project lacks -> undefined.
 * Not written now (no tests until behaviour is locked); noted so the case is
 * not rediscovered.
 */

import { CANON } from "./canon";

export interface Reference {
  readonly bookId: string;
  /** One-based, as a person writes it; absent when none was typed. */
  readonly chapter?: number;
  /** One-based; absent unless a chapter was given and a verse followed it. */
  readonly verse?: number;
}

export interface ReferenceLookup {
  /** The ids this project holds. Nothing outside it is ever returned. */
  readonly known: readonly string[];
  /**
   * What this project calls a book, in every locale it names one — from
   * `ProjectMetadata.bookNames`. Optional: a project that names nothing is
   * matched by the English canon and its ids alone.
   */
  readonly named?: (id: string) => readonly string[];
}

/**
 * A number, then a separator, then a number, at the very end: the verse form.
 * `:` is the common spelling, `.` and `,` are what different keyboards and
 * traditions produce, and all three mean the same thing.
 */
const CHAPTER_AND_VERSE = /[\s]*(\d+)\s*[:.,]\s*(\d+)\s*$/;

/** Just a trailing number: the chapter alone. */
const CHAPTER_ONLY = /\s+(\d+)\s*$/;

/** "1 Samuel" and "1Samuel" are the same book, and so are their cases. */
const NUMBERED = /^(\d)\s*(.+)$/;

/**
 * Case, accents and spacing folded away, so one typed word can match a name
 * written properly. NFKD splits a letter from its combining marks and the
 * marks are what we drop — "Éxodo" folds to "exodo" rather than to "xodo".
 */
export const fold = (text: string): string => {
  const squashed = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const numbered = NUMBERED.exec(squashed);
  return numbered === null ? squashed : `${numbered[1] ?? ""} ${numbered[2] ?? ""}`;
};

/** Every string that names this book: the project's, then the canon's. */
const namesOf = (id: string, lookup: ReferenceLookup): readonly string[] => {
  const own = lookup.named?.(id) ?? [];
  const english = CANON.find((book) => book.id === id.toUpperCase())?.name;
  return english === undefined ? own : [...own, english];
};

/** Splits the coordinates off the end, leaving the name. */
const coordinates = (
  text: string,
): { readonly name: string; readonly chapter?: number; readonly verse?: number } => {
  const both = CHAPTER_AND_VERSE.exec(text);
  if (both !== null) {
    return {
      name: text.slice(0, both.index),
      chapter: Number(both[1]),
      verse: Number(both[2]),
    };
  }
  const chapter = CHAPTER_ONLY.exec(text);
  if (chapter !== null) return { name: text.slice(0, chapter.index), chapter: Number(chapter[1]) };
  return { name: text };
};

/**
 * The place this text names, or `undefined`.
 *
 * Resolution order, and each step is tried across the whole project before the
 * next one, so an exact match never loses to somebody else's prefix:
 *
 *   1. the book's id, exactly — `LUK`, `luk`
 *   2. a name, exactly — the project's own first, then English
 *   3. a name by prefix, in canonical order — "phil" is ambiguous between
 *      Philippians and Philemon, and the earlier book wins rather than nothing
 *   4. an id by prefix, for a book the canon does not name at all
 */
export const parseReference = (query: string, lookup: ReferenceLookup): Reference | undefined => {
  const text = query.trim();
  if (text === "") return undefined;

  const { name, chapter, verse } = coordinates(text);
  const wanted = fold(name);
  if (wanted === "") return undefined;

  // Canonical order, restricted to what this project holds: the order decides
  // every ambiguous prefix, so it has to be the canon's and not the folder's.
  const held = new Set(lookup.known.map((id) => id.toUpperCase()));
  const ordered = [
    ...CANON.map((book) => book.id).filter((id) => held.has(id)),
    ...lookup.known.map((id) => id.toUpperCase()).filter((id) => !CANON.some((b) => b.id === id)),
  ];

  const place = (bookId: string): Reference => ({
    bookId,
    ...(chapter === undefined ? {} : { chapter }),
    ...(verse === undefined ? {} : { verse }),
  });

  const upper = name.trim().toUpperCase();
  if (held.has(upper)) return place(upper);

  for (const id of ordered) {
    if (namesOf(id, lookup).some((known) => fold(known) === wanted)) return place(id);
  }
  for (const id of ordered) {
    if (namesOf(id, lookup).some((known) => fold(known).startsWith(wanted))) return place(id);
  }
  for (const id of ordered) if (id.startsWith(upper)) return place(id);
  return undefined;
};
