import type { ExtensionMarker, ExtensionReport, GalleyService } from "#core/galley";

type LegacyMarker = ExtensionMarker;

const LEGACY_MARKERS: readonly LegacyMarker[] = [{ name: "s5", category: "standalone" }];

const aloneOnALine = (name: string): RegExp => new RegExp(String.raw`^\\${name}[ \t]*\r?$`, "m");

const PATTERNS: readonly (readonly [LegacyMarker, RegExp])[] = LEGACY_MARKERS.map((marker) => [
  marker,
  aloneOnALine(marker.name),
]);

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

export const registerLegacyMarkers = (
  galley: GalleyService,
  texts: () => Iterable<string>,
): { readonly markers: readonly LegacyMarker[]; readonly refused: readonly ExtensionReport[] } => {
  const markers = legacyMarkersIn(texts);
  const refused = galley.setExtensions(markers, { relaxZPrefix: true });
  return { markers, refused };
};
