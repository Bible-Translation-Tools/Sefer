/**
 * The one test this module gets: does the real wasm artifact load, parse a real
 * book, and publish a real corpus snapshot?
 *
 * This is the riskiest seam in the app — a vendored binary, two generated
 * readers, and a wire handshake — and every one of those failures is silent or
 * catastrophic rather than gradual. Everything else about Galley is a pure
 * function over the value this proves we can get.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { NodeGalleyLive } from "../../platform/node/galley";
import { describesExactly, sameSource, toLf } from "./analysis";
import { EngineInputError, Galley, type GalleyService } from "./galley";

const fixture = (name: string): string =>
  toLf(
    readFileSync(
      fileURLToPath(new URL(`../../../fixtures/small-nt/${name}`, import.meta.url)),
      "utf8",
    ),
  ).text;

const PHILEMON = fixture("58-PHM.usfm");

/** One built engine, reused: `Effect.provide` shares a layer across calls. */
const withGalley = <A>(use: (galley: GalleyService) => A): Promise<A> =>
  Effect.runPromise(Effect.provide(Galley.useSync(use), NodeGalleyLive));

describe("Galley", () => {
  it("loads the pinned artifact and reports its identity", async () => {
    const version = await withGalley((galley) => galley.version());
    expect(version.engine).toBe("usfm_galley");
    expect(version.onionFormat).toBeGreaterThan(0);
    expect(version.sousFormat).toBeGreaterThan(0);
  });

  it("analyzes a real book into a dish that describes exactly that text", async () => {
    const analysis = await withGalley((galley) => galley.analyze(PHILEMON));
    expect(analysis.dish.tokens.length).toBeGreaterThan(0);
    expect(analysis.docLen).toBe(PHILEMON.length);
    expect(describesExactly(analysis, PHILEMON)).toBe(true);
    expect(analysis.dish.utf16).toBe(true);
  });

  it("agrees with itself across two analyses of one text", async () => {
    const [first, second] = await withGalley(
      (galley) => [galley.analyze(PHILEMON), galley.analyze(PHILEMON)] as const,
    );
    expect(sameSource(first, second)).toBe(true);
    expect(second.revision).toBeGreaterThan(first.revision);
  });

  it("hands the same instance back for the same text through a memo", async () => {
    const same = await withGalley((galley) => {
      const analyze = galley.memoize();
      return analyze(PHILEMON) === analyze(PHILEMON);
    });
    expect(same).toBe(true);
  });

  it("refuses text that is not canonical LF", async () => {
    const thrown = await withGalley((galley) => {
      try {
        galley.analyze("\\id PHM\r\n");
        return null;
      } catch (cause) {
        return cause;
      }
    });
    expect(thrown).toBeInstanceOf(EngineInputError);
  });

  it("publishes a corpus snapshot carrying the id it was given", async () => {
    const found = await withGalley((galley) => {
      const code = galley.update("books/58-PHM.usfm", PHILEMON);
      const snapshot = galley.publish();
      return {
        code,
        books: snapshot.length,
        id: snapshot.bookById("books/58-PHM.usfm")?.id,
      };
    });
    expect(found.code).toBe("PHM");
    expect(found.books).toBe(1);
    expect(found.id).toBe("books/58-PHM.usfm");
  });
});
