// legacyMarkers.ts
//
// Which legacy markers the engine is told about, and for which projects. This
// file IS the policy: one table, read top to bottom, changed by editing a line.
// It is its own file, named for what it decides, so that "why does \s5 not
// show up as a finding here" has a file to open; `ProjectContext.tsx` only
// calls it when a project opens.
//
// THE RULE. Each entry is registered with the engine (`relaxZPrefix: true`)
// ONLY for a project whose book texts already contain it, alone on a line,
// when the project opens. A project that never had one does not get it — so a
// `\s5` typed into such a project stays unknown markup and is reported, rather
// than quietly passing. An EMPTY table registers nothing anywhere: the engine
// then reads every project exactly as it did before this file existed.
//
// Why here, in `src/app`, and not in core: core holds the door
// (`GalleyService.setExtensions`, which takes any list) and no policy, and this
// is policy — which projects get which markers. Its own file rather than a
// line in `ProjectContext.tsx`, because a table buried in a 1,400-line shell
// file is not one a person finds or changes.
//
// Once registered, the engine treats the marker as its category (a
// `standalone` is a bare point that leaves its paragraph open), and the
// editor paints and guards it by that category through its registry
// (`src/editor/core/registry.ts`, the `standalone` class). No rule in Sefer
// branches on the name `s5`; this table is the only place it is written.
//
// The registration is PROCESS-WIDE (`GalleyService.setExtensions`): every
// parse after it — reference texts, a review side, a loose parse on the
// landing screen — reads the same table, until the next project opens and
// sets it again.

import type { ExtensionMarker, ExtensionReport, GalleyService } from "#core/galley";

/** A marker a host cannot change in the texts it is given. */
type LegacyMarker = ExtensionMarker;

/**
 * The policy. `s5` is en_ulb's chunk marker: a bare point between verses,
 * on a line of its own, that the spec does not define.
 */
const LEGACY_MARKERS: readonly LegacyMarker[] = [{ name: "s5", category: "standalone" }];

/**
 * `\name` alone on its line, trailing spaces (and a stray CR) allowed.
 *
 * THE ONE PLACE SEFER READS MARKUP WITH A REGEX, deliberately. Everywhere else
 * the engine answers what markup a text holds (`location.md`, "Sefer never
 * reads a designator"). This question cannot go to the engine: its answer
 * decides the engine's configuration, which has to be installed before the
 * engine may parse the project at all — asking a parse first would be a parse
 * under the wrong table, and then every book parsed twice.
 */
const aloneOnALine = (name: string): RegExp => new RegExp(String.raw`^\\${name}[ \t]*\r?$`, "m");

const PATTERNS: readonly (readonly [LegacyMarker, RegExp])[] = LEGACY_MARKERS.map((m) => [
  m,
  aloneOnALine(m.name),
]);

/**
 * The entries of the table some text already contains, in table order.
 *
 * Reads the texts lazily and stops at the first book that answers each entry,
 * so a project that uses `\s5` costs one scan of its first book; one that does
 * not costs one scan of every book, once, at open.
 */
const legacyMarkersIn = (texts: () => Iterable<string>): LegacyMarker[] => {
  const found: LegacyMarker[] = [];
  for (const [marker, pattern] of PATTERNS) {
    for (const text of texts()) {
      if (!pattern.test(text)) continue;
      found.push(marker);
      break;
    }
  }
  return found;
};

/**
 * Install exactly the legacy markers these texts use — `[]` when none, which
 * CLEARS whatever the previous project installed. Call before the project's
 * first parse.
 */
export const registerLegacyMarkers = (
  galley: GalleyService,
  texts: () => Iterable<string>,
): { readonly markers: readonly LegacyMarker[]; readonly refused: readonly ExtensionReport[] } => {
  const markers = legacyMarkersIn(texts);
  const refused = galley.setExtensions(markers, { relaxZPrefix: true });
  return { markers, refused };
};
