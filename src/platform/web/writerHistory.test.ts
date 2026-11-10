// Sefer's side of bttwriter's history read: real isomorphic-git (the Web Git
// layer over the Node filesystem) answering bttwriter's walk through the Git
// port's `objectReader`. The heads are the ones the kitchen pins in
// `bttwriter/tests/replay.rs`, Sefer's own replay before it moved there; the
// two bundles are copies of its fixtures (`fixtures/writer/`).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { readHistory } from "#core/migrate/candidate";
import { WriterEngine } from "#core/migrate/writerEngine";
import { NodeWriterEngineLive } from "#platform/node/bttwriter";

import { WebGitLive } from "./git";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/writer", import.meta.url));
const clean = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
const work = mkdtempSync(join(tmpdir(), "sefer-writer-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const layer = Layer.mergeAll(
  Layer.provideMerge(WebGitLive, NodeFileSystem.layer),
  NodeWriterEngineLive,
);

/** 2026-11-05: later than every save, so no save's date counts as in the future. */
const NOW = 1_793_836_800;

const cases = [
  {
    repo: "kpass_tmf_3jn_text_reg",
    source: "kpass/tmf_3jn_text_reg",
    head: "350ebd4bbf30573ec4b0f253b239261476f3dece",
    commits: 3,
    unchanged: 0,
  },
  {
    repo: "bahasatech.indotimur_kps-x-kaigar_3jn_text_reg",
    source: "bahasatech.indotimur/kps-x-kaigar_3jn_text_reg",
    head: "710cac6f2a667b1bb57af3a4db7d979b4ef6549f",
    commits: 16,
    unchanged: 1,
  },
] as const;

describe("a Writer history read through the Git port", () => {
  for (const fixture of cases)
    it(`${fixture.repo} replays to the head bttwriter pins`, { timeout: 60_000 }, async () => {
      const dir = join(work, fixture.repo);
      execFileSync("git", ["clone", "--quiet", join(FIXTURES, `${fixture.repo}.bundle`), dir], {
        env: clean,
        stdio: "ignore",
      });
      const replayed = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const bttwriter = yield* (yield* WriterEngine).load;
            const history = yield* readHistory(dir, fixture.source);
            expect(history.project.book).toBe("3JN");
            return bttwriter.replay([history], { now: NOW });
          }),
          layer,
        ),
      );
      expect([replayed?.head, replayed?.commits, replayed?.unchanged]).toEqual([
        fixture.head,
        fixture.commits,
        fixture.unchanged,
      ]);
    });
});
