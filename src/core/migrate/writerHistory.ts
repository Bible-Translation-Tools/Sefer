/**
 * A Writer project's history, kept — in the project's shape, not Writer's.
 *
 * Writer kept one repository per book, chunk files (`05/03.txt`) and a commit
 * per autosave. A migrated project keeps every save that changed the book's
 * text as a commit of its own: one whole book file (`46-ROM.usfm`) as the
 * migration template renders it at that save, with the save's own author,
 * committer, date and zone. Several books' saves are interleaved by author
 * time, so the project's log reads as the team worked. The chunk shape never
 * enters the history (Will, 2026-10-09, replacing 2026-10-06's single
 * assembly commit once this proved cheap: one New Testament, 3,219 saves, a
 * 2.7 MB pack in about two seconds).
 *
 * Writer's own messages are a timestamp ("Fri Aug 28 2026 18:08:27 GMT+0200"),
 * so a replayed commit says what changed — the verses of the chunks it touched
 * (`TIT 1:6–7`) — and keeps the original and its source as trailers. Writer's
 * device identity, `tsDesktop`, stays the author where it was (Will).
 *
 * Two steps, because the clone is read when a candidate is opened and the
 * history written when the project is assembled: `readWriterHistory` keeps
 * only the text files each save changed (a few KB a save), and
 * `replayWriterHistories` writes them all as one pack (`../git/pack.ts`).
 */

import { Effect } from "effect";

import { Git, type CommitId, type GitError, type Repo, type Signature } from "../git/git";
import { commitBody, packWriter, treeBody, type FinishedPack } from "../git/pack";
import { decode } from "../source/source";
import { isWriterTextPath, treeFromFiles, usfmFileName, writerBookToUsfm } from "./writerBook";

/** One Writer save that changed a text file: who, when, and those files' new text (`null`: deleted). */
export interface WriterSave {
  readonly id: CommitId;
  readonly author: Signature;
  readonly committer: Signature;
  /** Writer's own message, first line: a timestamp, in practice. */
  readonly message: string;
  readonly changes: ReadonlyMap<string, string | null>;
}

export interface WriterHistory {
  readonly book: string;
  /** The template's fallback title, as the rendering of the newest save uses. */
  readonly title: string;
  /** `owner/repo`, or the folder's name: where `Writer-Source` says a save came from. */
  readonly source: string;
  /** Oldest first. */
  readonly saves: readonly WriterSave[];
}

const text = (bytes: Uint8Array): string | null => {
  const decoded = decode(bytes);
  return decoded._tag === "Success" ? decoded.success.text : null;
};

/**
 * The saves of the repository at `repo` that changed a text file the template
 * reads, oldest first. A file that will not decode reads as deleted, as
 * `readWriterTree` leaves out a file it cannot read.
 */
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

/** `5:1–11`: the chapter and the verses a chunk holds; the chapter alone when it holds none. */
const versesOf = (chapter: number, chunk: string): string => {
  const verses = [...chunk.matchAll(/\\v\s+(\d+)(?:-(\d+))?/g)].map((match): [number, number] => [
    Number(match[1]),
    Number(match[2] ?? match[1]),
  ]);
  if (verses.length === 0) return String(chapter);
  const low = Math.min(...verses.map(([from]) => from));
  const high = Math.max(...verses.map(([, to]) => to));
  return low === high
    ? `${String(chapter)}:${String(low)}`
    : `${String(chapter)}:${String(low)}–${String(high)}`;
};

/** What a save did to its book, in the project's terms: `ROM 5:1–11, 6:4–6; titles`. */
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
  /** The last replayed commit: what the assembly commits on top of. */
  readonly head: CommitId;
  readonly commits: number;
  /** Saves read that changed no rendered text (a manifest save, an unchanged chunk). */
  readonly unchanged: number;
}

/**
 * Every history's saves as commits of one project, oldest first by author
 * time, written as one pack. `undefined` when no save changed any book —
 * there is no history to keep.
 */
export const replayWriterHistories = async (
  histories: readonly WriterHistory[],
): Promise<Replayed | undefined> => {
  const events = histories
    .flatMap((history) => history.saves.map((save) => ({ history, save })))
    .map((event, order) => ({ ...event, order }))
    .sort((a, b) => a.save.author.at - b.save.author.at || a.order - b.order);

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
