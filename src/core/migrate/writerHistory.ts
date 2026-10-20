/**
 * Every Writer save is kept as a commit (Will, 2026-10-09, replacing
 * 2026-10-06's single assembly commit once this proved cheap: one New
 * Testament, 3,219 saves, a 2.7 MB pack in about two seconds). Writer's device
 * identity, `tsDesktop`, stays the author where it was (Will).
 */

import { decode } from "@sefer/text/source";
import { Effect } from "effect";

import { Git, type CommitId, type GitError, type Repo, type Signature } from "../git/git";
import { commitBody, packWriter, treeBody, type FinishedPack } from "../git/pack";
import { isWriterTextPath, treeFromFiles, usfmFileName, writerBookToUsfm } from "./writerBook";

export interface WriterSave {
  readonly id: CommitId;
  readonly author: Signature;
  readonly committer: Signature;
  readonly message: string;
  readonly changes: ReadonlyMap<string, string | null>;
}

export interface WriterHistory {
  readonly book: string;
  readonly title: string;
  readonly source: string;
  readonly saves: readonly WriterSave[];
}

const text = (bytes: Uint8Array): string | null => {
  const decoded = decode(bytes);
  return decoded._tag === "Success" ? decoded.success.text : null;
};

export const readWriterHistory = (
  repo: Repo,
  book: string,
  title: string,
  source: string,
): Effect.Effect<WriterHistory, GitError, Git> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const walked = yield* git.walk(repo);
    const kept = walked
      .map((commit) => ({
        commit,
        changes: commit.changes.filter((change) => isWriterTextPath(change.path)),
      }))
      .filter((save) => save.changes.length > 0);
    const wanted = kept.flatMap((save) =>
      save.changes.flatMap((change) => (change.blob === null ? [] : [change.blob])),
    );
    const bytes = yield* git.blobs(repo, wanted);
    const saves = kept.map(({ commit, changes }): WriterSave => ({
      id: commit.id,
      author: commit.author,
      committer: commit.committer,
      message: commit.message.trim().split("\n")[0] ?? "",
      changes: new Map(
        changes.map((change) => {
          const body = change.blob === null ? undefined : bytes.get(change.blob);
          return [change.path, body === undefined ? null : text(body)];
        }),
      ),
    }));
    return { book, title, source, saves };
  });

const versesOf = (chapter: number, chunk: string): string => {
  const verses = [...chunk.matchAll(/\\v\s+(\d+)(?:-(\d+))?/g)].map((match): [number, number] => [
    Number(match[1]),
    Number(match[2] ?? match[1]),
  ]);
  if (verses.length === 0) return `${String(chapter)} (no verse number)`;
  const low = Math.min(...verses.map(([from]) => from));
  const high = Math.max(...verses.map(([, to]) => to));
  return low === high
    ? `${String(chapter)}:${String(low)}`
    : `${String(chapter)}:${String(low)}–${String(high)}`;
};

const summaryOf = (
  book: string,
  changes: ReadonlyMap<string, string | null>,
  before: ReadonlyMap<string, string>,
): string => {
  const where = [...changes.keys()]
    .filter((path) => /^\d{2,3}\/\d{2,3}\.txt$/.test(path))
    .sort()
    .map((path) =>
      versesOf(Number(path.split("/")[0]), changes.get(path) ?? before.get(path) ?? ""),
    );
  const shown =
    where.length > 6
      ? `${where.slice(0, 6).join(", ")}, +${String(where.length - 6)} more`
      : where.join(", ");
  const titles = [...changes.keys()].some((path) => path.endsWith("title.txt"));
  const said = [shown, titles ? "titles" : ""].filter((part) => part !== "").join("; ");
  return said === "" ? book : `${book} ${said}`;
};

export interface Replayed extends FinishedPack {
  readonly head: CommitId;
  readonly commits: number;
  readonly unchanged: number;
}

export const replayWriterHistories = async (
  histories: readonly WriterHistory[],
): Promise<Replayed | undefined> => {
  const events = histories
    .flatMap((history, book) => {
      let key = -Infinity;
      return history.saves.map((save, index) => {
        key = Math.max(key, save.author.at);
        return { history, save, key, book, index };
      });
    })
    .sort((a, b) => a.key - b.key || a.book - b.book || a.index - b.index);

  const writer = packWriter();
  const files = new Map(histories.map((history) => [history.book, new Map<string, string>()]));
  const rendered = new Map<string, string>();
  const tree = new Map<string, string>();
  let head: CommitId | undefined;
  let commits = 0;
  let unchanged = 0;
  for (const { history, save } of events) {
    const held = files.get(history.book) ?? new Map<string, string>();
    const before = new Map(held);
    for (const [path, body] of save.changes)
      if (body === null) held.delete(path);
      else held.set(path, body);
    const usfm = writerBookToUsfm(treeFromFiles(held), history.book, history.title);
    if (usfm === rendered.get(history.book)) {
      unchanged += 1;
      continue;
    }
    rendered.set(history.book, usfm);
    const name = usfmFileName(history.book);
    tree.set(name, await writer.add("blob", new TextEncoder().encode(usfm), name));
    const root = await writer.add("tree", treeBody(tree), "tree");
    head = await writer.add(
      "commit",
      commitBody({
        tree: root,
        parents: head === undefined ? [] : [head],
        author: save.author,
        committer: save.committer,
        message: `${summaryOf(history.book, save.changes, before)}\n\nWriter-Message: ${save.message}\nWriter-Source: ${history.source}@${save.id}\n`,
      }),
    );
    commits += 1;
  }
  if (head === undefined) return undefined;
  return { ...(await writer.finish()), head, commits, unchanged };
};
