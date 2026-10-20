// The one test pack.ts gets (Will, 2026-10-09): only real git can say whether it is native-identical.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import git from "isomorphic-git";
import { afterAll, describe, expect, it } from "vitest";

import { commitBody, packWriter, treeBody, type CommitSignature } from "#core/git/pack";

const encoder = new TextEncoder();
const clean = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
const run = (args: readonly string[], input?: Buffer): Buffer =>
  execFileSync("git", args, { env: clean, ...(input === undefined ? {} : { input }) });
const work = mkdtempSync(join(tmpdir(), "sefer-pack-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Step {
  readonly file: string;
  readonly text: string;
  readonly who: CommitSignature;
  readonly message: string;
}

const someone = (n: number): CommitSignature => ({
  name: n % 3 === 0 ? "tsDesktop" : "Mwila Chanda",
  email: n % 3 === 0 ? "tsdesktop@example.org" : "mwila@example.org",
  at: 1_782_000_000 + n * 61,
  offset: n % 2 === 0 ? 120 : -300,
});

const longBook = (marker: string): string =>
  [
    "\\id ACT",
    ...Array.from(
      { length: 900 },
      (_, i) => `\\v ${String(i + 1)} Mu kale ${marker} — ŋaŋa ẽ ẅ ${"text ".repeat(16)}`,
    ),
  ].join("\n");

const history: Step[] = [
  { file: "45-ACT.usfm", text: longBook("a"), who: someone(0), message: "ACT 1:1\n" },
  { file: "66-JUD.usfm", text: "\\id JUD\n\\v 1 Yuda", who: someone(1), message: "JUD 1:1\n" },
  {
    file: "45-ACT.usfm",
    text: longBook("a").replace("Mu kale a", `Mu kale ${"ẑ".repeat(300)}`),
    who: someone(2),
    message: "ACT 1:1, a long insert\n",
  },
  {
    file: "66-JUD.usfm",
    text: "\\id JUD\n\\v 1 Yuda",
    who: someone(3),
    message: "JUD, a save that changed nothing\n",
  },
  ...Array.from({ length: 60 }, (_, i): Step => ({
    file: "66-JUD.usfm",
    text: `\\id JUD\n\\v 1 Yuda ${"musha ".repeat(i + 1)}`,
    who: someone(4 + i),
    message: `JUD 1:1, save ${String(i + 1)}\n`,
  })),
];

const states = (() => {
  const files = new Map<string, string>();
  return history.map((step) => {
    files.set(step.file, step.text);
    return new Map(files);
  });
})();

const ours = async () => {
  const writer = packWriter();
  const ids = new Map<string, string>();
  let head: string | undefined;
  for (const step of history) {
    ids.set(step.file, await writer.add("blob", encoder.encode(step.text), step.file));
    const tree = await writer.add("tree", treeBody(ids), "tree");
    head = await writer.add(
      "commit",
      commitBody({
        tree,
        parents: head === undefined ? [] : [head],
        author: step.who,
        committer: step.who,
        message: step.message,
      }),
    );
  }
  return { ...(await writer.finish()), head };
};

const zone = (minutes: number): string => {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
};

const gits = (): string => {
  const dir = join(work, "fast-import");
  run(["init", "-q", "--bare", dir]);
  const stream: Buffer[] = [];
  const data = (text: string) => {
    const bytes = Buffer.from(text, "utf8");
    stream.push(Buffer.from(`data ${String(bytes.length)}\n`), bytes, Buffer.from("\n"));
  };
  history.forEach((step, n) => {
    const who = `${step.who.name} <${step.who.email}> ${String(step.who.at)} ${zone(step.who.offset)}`;
    stream.push(
      Buffer.from(
        `commit refs/heads/main\nmark :${String(n + 1)}\nauthor ${who}\ncommitter ${who}\n`,
      ),
    );
    data(step.message);
    if (n > 0) stream.push(Buffer.from(`from :${String(n)}\n`));
    stream.push(Buffer.from(`M 100644 inline ${step.file}\n`));
    data(step.text);
  });
  run(["-C", dir, "fast-import", "--quiet"], Buffer.concat(stream));
  return run(["-C", dir, "rev-parse", "main"]).toString().trim();
};

describe("packWriter against git", () => {
  it(
    "writes git's objects, in a pack git reads exactly as written",
    { timeout: 30_000 },
    async () => {
      const written = await ours();
      expect(written.head).toBe(gits());
      expect(written.stats.deltas).toBeGreaterThan(0);

      const dir = join(work, "ours");
      run(["init", "-q", "--bare", dir]);
      writeFileSync(join(dir, "objects/pack", `${written.name}.pack`), written.pack);
      writeFileSync(join(dir, "objects/pack", `${written.name}.idx`), written.idx);
      writeFileSync(join(dir, "refs/heads/main"), `${written.head ?? ""}\n`);
      writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
      run(["-C", dir, "fsck", "--full", "--strict", "--no-progress"]);

      const again = join(work, "reindexed");
      mkdirSync(again);
      const copy = join(again, "copy.pack");
      writeFileSync(copy, written.pack);
      run(["index-pack", "--strict", "-o", join(again, "copy.idx"), copy]);
      expect(Buffer.compare(readFileSync(join(again, "copy.idx")), Buffer.from(written.idx))).toBe(
        0,
      );

      const cache = {};
      const commits = await git.log({ fs, gitdir: dir, ref: "main", cache });
      expect(commits).toHaveLength(history.length);
      const decoder = new TextDecoder();
      for (const [n, { oid }] of [...commits].reverse().entries())
        for (const [file, text] of states[n] ?? new Map<string, string>()) {
          const { blob } = await git.readBlob({ fs, gitdir: dir, oid, filepath: file, cache });
          expect(decoder.decode(blob)).toBe(text);
        }
    },
  );
});
