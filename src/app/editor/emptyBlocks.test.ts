import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EditorView } from "@codemirror/view";
import {
  annotateEmptyBlocks,
  blockNamer,
  emptyBlocks,
  surface,
} from "@sefer/editor/testing/harness";
import { makeBook } from "@sefer/text/book";
import { decode } from "@sefer/text/source";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { applyOverlay, overlayBook } from "#core/fixes/fixes";
import { Galley, toLf, type GalleyService } from "#core/galley";
import { NodeGalleyLive } from "#platform/node/galley";

const PSALMS = toLf(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/small-nt/19-PSA.usfm", import.meta.url)),
    "utf8",
  ),
).text;

const BS = "\\";

const OVERLAID = [
  `${BS}id TST`,
  `${BS}c 1`,
  `${BS}q`,
  `${BS}v 1 Blessed is the man`,
  `${BS}q2`,
  `${BS}q`,
  `${BS}v 2 But his delight is in the law`,
  "",
].join("\n");

interface Surfaces {
  on: (doc: string) => ReturnType<typeof surface>;
  off: (doc: string) => ReturnType<typeof surface>;
}

const withEngine = <A>(use: (s: Surfaces, galley: GalleyService) => A): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      Galley.useSync((galley: GalleyService) => {
        const analyze = galley.memoize("emptyBlocks.test");
        const named = blockNamer.of((marker) => `Needs text — ${marker.toUpperCase()}`);
        return use(
          {
            on: (doc) =>
              surface(doc, {
                analyze,
                extensions: [named, annotateEmptyBlocks(true)],
              }),
            off: (doc) => surface(doc, { analyze, extensions: [named, annotateEmptyBlocks()] }),
          },
          galley,
        );
      }),
      NodeGalleyLive,
    ),
  );

const labelsIn = (state: ReturnType<typeof surface>): string[] => {
  const out: string[] = [];
  for (const input of state.facet(EditorView.decorations)) {
    if (typeof input === "function") continue;
    input.between(0, state.doc.length, (_from, _to, deco) => {
      // SAFETY: one optional field off CodeMirror's `any` spec. Only this recipe's widget carries `label`; every other widget answers undefined.
      const widget = (deco.spec as { widget?: { label?: unknown } }).widget;
      if (typeof widget?.label === "string") out.push(widget.label);
    });
  }
  return out;
};

describe("empty blocks", () => {
  it("reports a real Psalms' two empty \\m blocks and none of its \\q lines", () =>
    withEngine(({ on }) => {
      expect(emptyBlocks(on(PSALMS)).map((row) => row.marker)).toEqual(["m", "m"]);
    }));

  it("finds the block match formatting left behind", () =>
    withEngine(({ on }) => {
      const found = emptyBlocks(on(OVERLAID));
      expect(found.map((row) => row.marker)).toEqual(["q2"]);
      expect(OVERLAID.slice(found[0].from - 3, found[0].from)).toBe(`${BS}q2`);
    }));

  it("draws one widget, through the namer the state supplied", () =>
    withEngine(({ on }) => {
      expect(labelsIn(on(OVERLAID))).toEqual(["Needs text — Q2"]);
    }));

  it("draws through the namer over real Psalms too", () =>
    withEngine(({ on }) => {
      expect(labelsIn(on(PSALMS))).toEqual(["Needs text — M", "Needs text — M"]);
    }));

  it("is off until a state asks for it", () =>
    withEngine(({ off }) => {
      expect(labelsIn(off(OVERLAID))).toEqual([]);
    }));

  it("finds what match formatting actually leaves behind", () =>
    withEngine(({ on }, galley) => {
      const target = [
        `${BS}id PHM`,
        `${BS}c 1`,
        `${BS}p`,
        `${BS}v 1 Paul a prisoner of Christ Jesus`,
        `${BS}v 2 and to the church in thy house`,
        "",
      ].join("\n");
      const source = [
        `${BS}id PHM`,
        `${BS}c 1`,
        `${BS}p`,
        `${BS}v 1 Paulus a bondman`,
        `${BS}q2 of the`,
        `${BS}q3 Anointed one`,
        `${BS}v 2 and unto the assembly`,
        "",
      ].join("\n");

      const bytes = decode(new TextEncoder().encode(target));
      if (bytes._tag !== "Success") throw new Error("fixture did not decode");
      const book = makeBook("PHM.usfm", bytes.success);
      const previewed = overlayBook(galley, book, source);
      if (previewed._tag !== "Success") throw new Error(previewed.failure.description);
      applyOverlay(previewed.success, book);

      const after = book.source().text;
      expect(emptyBlocks(on(after)).map((row) => row.marker)).toEqual(["q2"]);
      expect(labelsIn(on(after))).toEqual(["Needs text — Q2"]);
    }));

  it("goes away when the block gets words", () =>
    withEngine(({ on }) => {
      const state = on(OVERLAID);
      const at = emptyBlocks(state)[0].from;
      const typed = state.update({ changes: { from: at, insert: " who walks not" } }).state;
      expect(labelsIn(typed)).toEqual([]);
    }));
});
