/**
 * What a block marker is CALLED, for a translator.
 *
 * The shell's half of `blockNamer` (`src/editor/recipes/emptyBlocks.ts`). It
 * lives here and not in the editor because `src/editor` may not reach into the
 * app — its front door says it imports Galley's `Analysis` and core's
 * `Book`/`Source` vocabulary and nothing else — and these are interface copy.
 * Handed in as a facet for the same reason `analyzer` is: a capability the
 * state is GIVEN rather than one it imports.
 *
 * TODO(i18n): English only. When Sefer picks its localization story these go
 * through it; nothing else has to move, because the editor already asks for a
 * function rather than a table.
 */

const NAMES: Record<string, string> = {
  p: "Paragraph",
  pi: "Paragraph, indented",
  m: "Flush paragraph",
  nb: "Continued paragraph",
  q: "Poetry",
  q1: "Poetry 1",
  q2: "Poetry 2",
  q3: "Poetry 3",
  q4: "Poetry 4",
  d: "Descriptive title",
  s: "Heading",
  s1: "Heading 1",
  s2: "Heading 2",
  s3: "Heading 3",
  s4: "Heading 4",
  r: "Parallel reference",
  li1: "List item",
  li2: "List item",
  li3: "List item",
  ip: "Introduction paragraph",
  iq: "Introduction poetry",
};

/**
 * An unlisted marker shows its own spelling rather than a guess. A translator
 * who sees `\xyz` learns something true; one who sees "Paragraph" does not.
 */
export const nameBlock = (marker: string): string => NAMES[marker] ?? `\\${marker}`;
