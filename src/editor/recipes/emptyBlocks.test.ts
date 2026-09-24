/**
 * The ghost, and the one distinction it lives or dies on.
 *
 * Real uW poetry writes `\q` on a line of its own with the verse underneath —
 * an empty LINE opening a block that is not empty. Ghost those and every Psalm
 * is covered in labels that are lies. So the fixture is the real Psalms text
 * rather than a literal, because that shape is the reason this test exists and
 * a hand-written sample would be written to pass.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { EditorView } from "@codemirror/view";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeBook } from "#core/book/book";
import { applyOverlay, overlayBook } from "#core/fixes/fixes";
import { Galley, toLf, type GalleyService } from "#core/galley";
import { decode } from "#core/source/source";
import { NodeGalleyLive } from "#platform/node/galley";

import { surface } from "../testing/harness";
import { annotateEmptyBlocks, blockNamer, emptyBlocks } from "./emptyBlocks";

const PSALMS = toLf(
  readFileSync(
    fileURLToPath(new URL("../../../fixtures/small-nt/19-PSA.usfm", import.meta.url)),
    "utf8",
  ),
).text;

const BS = "\\";

/** What match formatting leaves behind: a `\q2` inserted inside verse 1, empty. */
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
  /** Annotation on, with a namer a test can recognise. */
  on: (doc: string) => ReturnType<typeof surface>;
  /** The extension mounted and the facet left at its default. */
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

/**
 * The ghost labels this state would draw.
 *
 * Read off the view-decorations facet rather than `decoField`, because this
 * recipe is a second contributor to that facet and not part of the reading
 * layer's own set — which is the arrangement under test.
 */
const labelsIn = (state: ReturnType<typeof surface>): string[] => {
  const out: string[] = [];
  for (const input of state.facet(EditorView.decorations)) {
    // Both contributors here are STATE-derived (`compute`, and `decoField`'s
    // `provide`), so every input is a set. The facet also admits a
    // `(view) => set` form for view plugins; a headless state has no view, so
    // one showing up would be a mounting bug and is skipped rather than faked.
    if (typeof input === "function") continue;
    input.between(0, state.doc.length, (_from, _to, deco) => {
      // SAFETY: one optional field off CodeMirror's `any` spec. Only this
      // recipe's widget carries `label`; every other widget answers undefined.
      const widget = (deco.spec as { widget?: { label?: unknown } }).widget;
      if (typeof widget?.label === "string") out.push(widget.label);
    });
  }
  return out;
};

describe("empty blocks", () => {
  /**
   * The claim the whole design rests on: a `\q` LINE with its verse on the
   * next line is an empty line inside a block that is NOT empty. If this ever
   * starts reporting `q`, the ghost is labelling ordinary poetry and the
   * feature is worse than nothing.
   *
   * The two `\m` rows it DOES report are `\m` alone after a `\c`, and they are
   * reported on purpose — see the note in `emptyBlocks.ts`.
   */
  it("reports a real Psalms' two empty \\m blocks and none of its \\q lines", () =>
    withEngine(({ on }) => {
      expect(emptyBlocks(on(PSALMS)).map((row) => row.marker)).toEqual(["m", "m"]);
    }));

  it("finds the block match formatting left behind", () =>
    withEngine(({ on }) => {
      const found = emptyBlocks(on(OVERLAID));
      expect(found.map((row) => row.marker)).toEqual(["q2"]);
      // The offset is where the WORDS go — immediately after the marker, which
      // is where the caret lands and where the ghost is drawn.
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

  /**
   * The two halves together, which is the only claim that matters: match
   * formatting leaves holes, and the ghost is what makes them visible. Either
   * one alone can pass while the feature does nothing.
   */
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
      /**
       * The source breaks verse 1 across THREE poetry lines, and three is the
       * point. The engine inserts each inside block with no words — it cannot
       * know where the target's own sentence splits — and they stack, in
       * source order since scripture-kitchen v0.1.6:
       *
       *     \v 1 Paul a prisoner of Christ Jesus and a brother
       *     \q2        <- empty BLOCK: nothing before the next marker
       *     \q3        <- not empty: it opens the block \v 2 lives in
       *     \v 2 and to the church in thy house
       *
       * So one source break leaves no empty block at all (the marker adopts
       * the next verse) and two leave one. That is the honest shape of what
       * match formatting leaves behind, and it is why this test uses two.
       */
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
