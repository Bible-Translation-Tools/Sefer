// What counts as a verse number in running text. A document picks one way of
// writing them; the mode names it, and only numbers written that way, in
// sequence, become verses. Everything else stays text.

/**
 * - `superscript`: typeset drafts; a superscript number, or a number set apart
 *   in its own formatting, or one that starts a paragraph or line.
 * - `marked`: "v1", "v 1", "verse 1" — the editor's typed verse numbers.
 * - `lineStart`: a number at the start of a paragraph or line.
 * - `perLine`: no numbers at all; every paragraph is the next verse. Never detected, only chosen.
 * - `any`: any free-standing number in the text. Never detected, only chosen.
 */
export type VerseMode = "superscript" | "marked" | "lineStart" | "perLine" | "any";

export type CandidateKind = "superscript" | "alone" | "marked" | "lineStart" | "inline";

const ACCEPTS: Record<Exclude<VerseMode, "perLine">, readonly CandidateKind[]> = {
  superscript: ["superscript", "alone", "lineStart"],
  marked: ["marked"],
  lineStart: ["lineStart", "alone"],
  any: ["superscript", "alone", "marked", "lineStart", "inline"],
};

export function accepts(mode: VerseMode, kind: CandidateKind) {
  return mode !== "perLine" && ACCEPTS[mode].includes(kind);
}

/** A number written in a way that could be a verse number. */
export interface Candidate {
  kind: CandidateKind;
  /** The slice of the run the number occupies, prefix and trailing period included. */
  start: number;
  end: number;
  from: number;
  /** The last verse of a bridge such as "1-2"; equal to `from` otherwise. */
  to: number;
  /** "1,000", "1.000" or "1 000": read as a quantity, never as a verse. */
  thousands: boolean;
}

// One to three digits, optionally bridged ("1-2", "1–2"), with an optional trailing period.
const NUMBER = String.raw`(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?(?!\d)\.?`;
const WHOLE_RUN = new RegExp(String.raw`^\s*${NUMBER}\s*$`);
const LINE_START = new RegExp(String.raw`^\s*${NUMBER}(?=\s|$)`);
const MARKED = new RegExp(String.raw`(?<=^|\s)(?:verse\s*|v\.?\s*)${NUMBER}(?=\s|$)`, "gi");
const INLINE = new RegExp(String.raw`(?<=^|[\s(])${NUMBER}(?=[\s,;:!?)]|$)`, "g");
const THOUSANDS_AFTER = /^(?:[,.]\d{3}|[   ]\d{3}(?!\d))/;
const THOUSANDS_BEFORE = /\d[,.   ]$/;

/** Every way the run could hold a verse number, earliest first. */
export function candidates(text: string, superscript: boolean, atLineStart: boolean): Candidate[] {
  const out: Candidate[] = [];
  const add = (kind: CandidateKind, m: RegExpMatchArray) => {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (out.some((c) => c.start < end && start < c.end)) return;
    const from = Number(m[1]);
    out.push({
      kind,
      start,
      end,
      from,
      to: m[2] ? Number(m[2]) : from,
      thousands:
        THOUSANDS_AFTER.test(text.slice(end)) || THOUSANDS_BEFORE.test(text.slice(0, start)),
    });
  };

  const whole = WHOLE_RUN.exec(text);
  if (whole) {
    add(superscript ? "superscript" : "alone", whole);
    return out;
  }
  if (superscript) return out;
  const lead = atLineStart ? LINE_START.exec(text) : null;
  if (lead) add("lineStart", lead);
  for (const m of text.matchAll(MARKED)) add("marked", m);
  for (const m of text.matchAll(INLINE)) add("inline", m);
  return out.sort((a, b) => a.start - b.start);
}

/** Picks the document's convention from how its numbers are written. */
export function detectMode(counts: Record<CandidateKind, number>): VerseMode {
  const superscript = counts.superscript;
  const marked = counts.marked;
  const lineStart = counts.lineStart + counts.alone;
  if (superscript >= 3 && superscript >= marked && superscript >= lineStart / 2)
    return "superscript";
  if (marked >= 3 && marked >= lineStart / 2) return "marked";
  return "lineStart";
}

/**
 * Whether a number may be the next verse: ahead of the last one by at most
 * `gap`, or 1 again (a new chapter) when `restart` is allowed. `max` is the
 * chapter's verse count from a versification, when the caller has one.
 */
export function nextVerse(
  previous: number,
  candidate: { from: number; to: number },
  gap: number,
  restart: boolean,
  max?: number,
): "next" | "restart" | null {
  if (candidate.to < candidate.from) return null;
  if (candidate.from > previous && candidate.from <= previous + gap) {
    return max !== undefined && candidate.to > max ? null : "next";
  }
  if (restart && candidate.from === 1 && previous >= 1) return "restart";
  return null;
}

/** How far ahead a number may jump: strong signals tolerate a skipped verse or two more. */
export function gapFor(kind: CandidateKind) {
  return kind === "superscript" || kind === "marked" || kind === "alone" ? 10 : 3;
}
