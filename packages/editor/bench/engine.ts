import type { Analysis } from "@sefer/text/engine/analysis";
import {
  attrList,
  declaredVersion,
  deserialize,
} from "@wycliffeassociates/scripture-kitchen/reader";
import { Census } from "@wycliffeassociates/scripture-kitchen/toc-reader";
import {
  Galley,
  attrs,
  customMarkers,
  initSync,
  setCustomMarkers,
} from "@wycliffeassociates/scripture-kitchen/web";
import wasmUrl from "@wycliffeassociates/scripture-kitchen/web/wasm?url";

/**
 * The engine as the bench's host brings it: the galley wasm, one handle, and
 * the `analyze` the editor asks every host for. A copy in miniature of what
 * Sefer's `src/core/galley/galley.ts` does, so the bench needs nothing of
 * Sefer's and a bug that shows here is the editor's or the engine's.
 */
export const loadEngine = async (): Promise<{
  analyzeBook: (id: string) => (text: string) => Analysis;
  legacyMarkers: (texts: readonly string[]) => void;
  lastVerses: (id: string) => ReadonlyMap<string, number>;
}> => {
  initSync({ module: await (await fetch(wasmUrl)).arrayBuffer() });
  const handle = new Galley();
  let revision = 0;

  const analyzeBook =
    (id: string) =>
    (text: string): Analysis => {
      const started = performance.now();
      handle.update(id, text);
      const dish = deserialize(handle.parse(id, { diagnostics: true, toc: true, utf16: true }));
      revision += 1;
      return {
        dish,
        text,
        docLen: text.length,
        sourceHash: dish.sourceHash,
        revision,
        engineMs: performance.now() - started,
        usfmVersion: declaredVersion(dish),
        attrs: (from, to) => attrList(attrs(text, from, to, { utf16: true })),
      };
    };

  return {
    // As Sefer's `src/app/legacyMarkers.ts`: en_ulb's `\s5`, alone on a line, is a standalone
    // chunk marker, not a fifth-level heading. Process-wide, so set before a scenario opens.
    legacyMarkers: (texts) => {
      const used = texts.some((text) => /^\\s5[ \t]*$/m.test(text));
      setCustomMarkers(
        customMarkers(used ? [{ name: "s5", category: "standalone" }] : [], { relaxZPrefix: true }),
      );
    },
    // As Sefer's `lastVerses` (src/app/ui/workspace/expectedVerses.ts): each
    // chapter's last verse in the census of a text `analyzeBook` has read.
    lastVerses: (id) => {
      const out = new Map<string, number>();
      const census = Census.open(handle.toc(id, { utf16: true }));
      if (census.bookCount === 0) return out;
      const book = census.book(0);
      const rows = book.chapterRows;
      for (let n = 1; n < book.chapterCount; n++) {
        const row = rows.seek(n);
        if (row.number > 0 && row.lastVerse > 0) out.set(String(row.number), row.lastVerse);
      }
      return out;
    },
    analyzeBook: (id) => {
      const analyze = analyzeBook(id);
      let last: Analysis | undefined;
      return (text) => (last !== undefined && last.text === text ? last : (last = analyze(text)));
    },
  };
};
