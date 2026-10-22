import type { Analysis } from "@sefer/text/engine/analysis";
import { declaredVersion, deserialize } from "@wycliffeassociates/scripture-kitchen/reader";
import { Galley, initSync } from "@wycliffeassociates/scripture-kitchen/web";
import wasmUrl from "@wycliffeassociates/scripture-kitchen/web/wasm?url";

/**
 * The engine as the bench's host brings it: the galley wasm, one handle, and
 * the `analyze` the editor asks every host for. A copy in miniature of what
 * Sefer's `src/core/galley/galley.ts` does, so the bench needs nothing of
 * Sefer's and a bug that shows here is the editor's or the engine's.
 */
export const loadEngine = async (): Promise<{
  analyzeBook: (id: string) => (text: string) => Analysis;
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
      };
    };

  return {
    analyzeBook: (id) => {
      const analyze = analyzeBook(id);
      let last: Analysis | undefined;
      return (text) => (last !== undefined && last.text === text ? last : (last = analyze(text)));
    },
  };
};
