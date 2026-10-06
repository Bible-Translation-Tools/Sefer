/**
 * The open project's Writer upstreams, as the shell holds them: which books
 * still follow a Writer project, and which of those have new work.
 *
 * A project that came from Writer follows its books' Writer projects until
 * somebody stops it (Settings' Cloud section, "Stop following Writer
 * projects"). While it follows them, checking is part of the ordinary sync
 * lifecycle: after the shared project's check, on open and on "Check for
 * changes" (Will, 2026-10-06). There is no separate switch to forget.
 *
 * Shared project first: a book whose Writer head is the commit recorded in
 * the shared project's `.upstreams.json` has been taken by a teammate, and
 * arrives through ordinary sync, not from here. So two people never take the
 * same Writer saves twice.
 *
 * The person reads new work in Review, against "From Writer (owner)"; what
 * they record there marks it taken (`takeWriterWork`), in the same commit.
 */

import { Effect, Option } from "effect";
import { createSignal, untrack } from "solid-js";

import { Git } from "#core/git/git";
import { readUpstreams, UPSTREAMS_FILE, upstreamsText } from "#core/migrate/upstreams";
import {
  fetchWork,
  incoming,
  probeUpstreams,
  projectUpstreams,
  takenText,
  type WriterWork,
} from "#core/migrate/writerWork";
import { Observability } from "#core/observability";
import type { Project } from "#core/project/project";
import { decode } from "#core/source/source";
import { trackingRef } from "#core/sync";

import { APP_AUTHOR, personAuthor } from "./author";
import type { Domain, Services } from "./services";

/** New work in one book, with the text the review compares against. */
interface IncomingWork extends WriterWork {
  /** This project's book with their changes in the places they changed. */
  readonly proposal: string;
}

interface WriterFacts {
  /** How many books follow a Writer project; 0 when the project follows none. */
  readonly followed: number;
  readonly checking: boolean;
  readonly work: readonly IncomingWork[];
  readonly checkedAt: number | undefined;
}

const NONE: WriterFacts = { followed: 0, checking: false, work: [], checkedAt: undefined };

const [held, setHeld] = createSignal<ReadonlyMap<string, WriterFacts>>(new Map(), {
  name: "writerWatch",
});

const put = (root: string, facts: WriterFacts): void => {
  setHeld((map) => new Map(map).set(root, facts));
};

/** The commits the shared project's `.upstreams.json` records, by book: work a teammate took. */
const takenOnShared = (root: string): Effect.Effect<ReadonlyMap<string, string>, never, Domain> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const repo = yield* Effect.option(git.open(root));
    if (Option.isNone(repo)) return new Map();
    const branch = Option.getOrUndefined(
      yield* Effect.orElseSucceed(git.branch(repo.value), () => Option.none<string>()),
    );
    if (branch === undefined) return new Map();
    const bytes = yield* Effect.option(git.show(repo.value, trackingRef(branch), UPSTREAMS_FILE));
    if (Option.isNone(bytes)) return new Map();
    const text = decode(bytes.value);
    if (text._tag === "Failure") return new Map();
    const upstreams = Option.getOrElse(readUpstreams(text.success.text), () => []);
    return new Map(
      upstreams.flatMap((upstream) => upstream.books.map((book) => [book, upstream.commit])),
    );
  });

const stagingOf = (services: Services): string => `${services.hostInfo.paths().temp}/writer`;

/**
 * Checks the project's Writer upstreams. Never rejects: a remote that does
 * not answer, or a project that cannot be fetched, has no new work this
 * time. Run AFTER the shared project's check.
 */
export const checkWriter = async (services: Services, project: Project): Promise<void> => {
  const root = project.root;
  const upstreams = await services.run(projectUpstreams(services.fileSystem, root));
  if (upstreams.length === 0) {
    put(root, NONE);
    return;
  }
  const before = held().get(root) ?? NONE;
  const followed = new Set(upstreams.flatMap((each) => each.books)).size;
  put(root, { ...before, followed, checking: true });
  const operation = services.composition.observability.operation("upstream.check", {
    "upstream.followed": upstreams.length,
  });
  try {
    const work = await services.run(
      Effect.provideService(
        Effect.gen(function* () {
          const shared = yield* takenOnShared(root);
          const probed = yield* probeUpstreams(upstreams);
          const moved = probed.filter(
            (each): each is typeof each & { readonly head: string } =>
              each.head !== undefined &&
              each.head !== each.upstream.commit &&
              !each.upstream.books.some((book) => shared.get(book) === each.head),
          );
          const found: IncomingWork[] = [];
          for (const each of moved) {
            const fetched = yield* Effect.orElseSucceed(
              fetchWork(each, stagingOf(services)),
              () => undefined,
            );
            if (fetched === undefined) continue;
            const ours = project.book(fetched.book)?.source().text;
            if (ours === undefined) continue;
            const proposal = incoming(services.galley, fetched, ours);
            // Their saves already match what this project holds: nothing to review.
            if (proposal === undefined || proposal === ours) continue;
            found.push({ ...fetched, proposal });
          }
          return { found, probed: probed.length, moved: moved.length };
        }),
        Observability,
        operation,
      ),
    );
    operation.end("passed", {
      "upstream.probed": work.probed,
      "upstream.moved": work.moved,
      "upstream.work": work.found.length,
    });
    put(root, {
      followed,
      checking: false,
      work: work.found,
      checkedAt: Date.now(),
    });
  } catch (cause) {
    operation.end("failed", { "upstream.reason": String(cause) });
    put(root, { ...before, followed, checking: false });
  }
};

/**
 * Marks the given books' Writer work taken: `.upstreams.json` with their
 * heads, written into the project. Returns its path, for the commit that
 * records the review, or `undefined` when there is nothing to mark.
 */
export const takeWriterWork = (
  services: Services,
  project: Project,
  books: readonly string[],
): Effect.Effect<string | undefined, unknown, Domain> => {
  // Read once, now: the work offered when Record was pressed.
  const work = (untrack(held).get(project.root) ?? NONE).work.filter((each) =>
    books.includes(each.book),
  );
  return Effect.gen(function* () {
    if (work.length === 0) return undefined;
    const upstreams = yield* projectUpstreams(services.fileSystem, project.root);
    const path = `${project.root}/${UPSTREAMS_FILE}`;
    yield* services.fileSystem.writeFileString(
      path,
      takenText(
        upstreams,
        new Map(work.map((each) => [each.book, each.head])),
        new Date().toISOString().slice(0, 10),
      ),
    );
    return path;
  });
};

/** Forget the work just taken, so the popover stops offering it. */
export const forgetWriterWork = (root: string, books: readonly string[]): void => {
  const facts = held().get(root);
  if (facts === undefined) return;
  put(root, { ...facts, work: facts.work.filter((each) => !books.includes(each.book)) });
};

/**
 * "Stop following Writer projects": `.upstreams.json` with no upstreams,
 * recorded as one version. The Writer projects themselves are untouched;
 * this project just stops asking them, here and for every teammate who
 * receives the version.
 */
export const stopFollowingWriter = (
  services: Services,
  root: string,
): Effect.Effect<void, unknown, Domain> =>
  Effect.gen(function* () {
    const path = `${root}/${UPSTREAMS_FILE}`;
    yield* services.fileSystem.writeFileString(path, upstreamsText([]));
    const author = Option.getOrElse(yield* personAuthor(), () => APP_AUTHOR);
    const git = yield* Git;
    const repo = yield* git.init(root);
    yield* git.commit(
      repo,
      [{ path, stamp: { revision: 0, length: 0 } }],
      "Stop following Writer projects",
      author,
    );
    put(root, NONE);
  });

export const writerWatch = {
  facts: (root: string | undefined): WriterFacts =>
    root === undefined ? NONE : (held().get(root) ?? NONE),
};
