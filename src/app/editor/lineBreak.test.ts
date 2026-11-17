import { pressKey, surface } from "@wycliffeassociates/sefer-editor/testing/harness";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { Galley, type GalleyService } from "#core/galley";
import { NodeGalleyLive } from "#platform/node/galley";

const DOC = [
  "\\id TST",
  "\\c 1",
  "\\p",
  "\\v 1 Blessed is the man who walks",
  "\\q1",
  "\\v 2 But his delight",
  "",
].join("\n");

const run = <A>(use: (galley: GalleyService) => A): Promise<A> =>
  Effect.runPromise(Effect.provide(Galley.useSync(use), NodeGalleyLive));

describe("Shift-Enter", () => {
  it("breaks a paragraph's line with \\b, carrying on as \\m", () =>
    run((galley) => {
      const state = surface(DOC, { analyze: galley.memoize("lineBreak.test") });
      const at = DOC.indexOf(" who");
      const pressed = pressKey(state.update({ selection: { anchor: at } }).state, "Shift-Enter");
      expect(pressed.state.doc.toString()).toContain("Blessed is the man\n\\b\n\\m who walks");
    }));
  it("breaks a poetry line with \\b, carrying on in the same level", () =>
    run((galley) => {
      const state = surface(DOC, { analyze: galley.memoize("lineBreak.test") });
      const at = DOC.indexOf(" delight");
      const pressed = pressKey(state.update({ selection: { anchor: at } }).state, "Shift-Enter");
      expect(pressed.state.doc.toString()).toContain("But his\n\\b\n\\q1 delight");
    }));
});
