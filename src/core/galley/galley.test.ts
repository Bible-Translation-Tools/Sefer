import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describesExactly, sameSource, toLf } from "@wycliffeassociates/sefer-text/engine/analysis";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { NodeGalleyLive } from "#platform/node/galley";

import { EngineInputError, Galley, type GalleyService } from "./galley";

const fixture = (name: string): string =>
  toLf(
    readFileSync(
      fileURLToPath(new URL(`../../../fixtures/small-nt/${name}`, import.meta.url)),
      "utf8",
    ),
  ).text;

const PHILEMON = fixture("58-PHM.usfm");

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
    const analysis = await withGalley((galley) => galley.analyzeText(PHILEMON));
    expect(analysis.dish.tokens.length).toBeGreaterThan(0);
    expect(analysis.docLen).toBe(PHILEMON.length);
    expect(describesExactly(analysis, PHILEMON)).toBe(true);
    expect(analysis.dish.utf16).toBe(true);
  });

  it("answers places for a book analysis after its id moves on or is removed", async () => {
    const verse = {
      kind: "verses",
      book: "PHM",
      from: { chapter: 1, verse: 4 },
      to: { chapter: 1, verse: 4 },
    } as const;
    const places = (held: ReturnType<GalleyService["analyzeBook"]>): unknown => [
      held.resolve(verse).kind,
      held.addressAt("PHM", 400)?.kind,
      held.units("PHM").length > 0,
    ];
    const [replaced, removed] = await withGalley((galley) => {
      const before = galley.analyzeBook("PHM", PHILEMON);
      galley.analyzeBook("PHM", `${PHILEMON}\n`);
      const first = places(before);
      const gone = galley.analyzeBook("PHM", PHILEMON);
      galley.remove("PHM");
      return [first, places(gone)];
    });
    expect(replaced).toEqual(["found", "verses", true]);
    expect(removed).toEqual(["found", "verses", true]);
  });

  it("agrees with itself across two analyses of one text", async () => {
    const [first, second] = await withGalley(
      (galley) => [galley.analyzeText(PHILEMON), galley.analyzeText(PHILEMON)] as const,
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
        galley.analyzeText("\\id PHM\r\n");
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
