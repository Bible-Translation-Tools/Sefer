import type { EditorBook, Following } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import { useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result, Stream } from "effect";
import { createMemo, createSignal, type Accessor } from "solid-js";

import {
  extend,
  group,
  type BookExcerpts,
  type BookText,
  type Excerpt,
  type Extent,
  type Occurrence,
  type OutlineRow,
} from "#core/excerpts/excerpts";
import { bookHeading, describesExactly, type Analysis } from "#core/galley";
import type { ObservabilityService } from "#core/observability";

import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import type { ContextStep } from "../multibuffer/cardState";
import { createCardViews, type CardViews } from "../multibuffer/cardViews";

export interface ExcerptFeed {
  readonly views: CardViews<Excerpt>;
  readonly initial: Extent;
  readonly groups: Accessor<readonly BookExcerpts[]>;
  readonly outline: Accessor<readonly OutlineRow[]>;
  readonly analyze: (text: string) => Analysis;
  readonly shownOf: (excerpt: Excerpt) => Excerpt;
  readonly expand: (sid: string, step: ContextStep) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly seatedOf: (bookId: BookId) => Following | undefined;
  readonly openInEditor: (
    bookId: BookId,
    from: number,
    to?: number,
    into?: ObservabilityService,
  ) => void;
  readonly edited: (bookId: BookId) => void;
}

export interface ExcerptFeedOptions {
  readonly hits: Accessor<readonly Occurrence[]>;
  readonly onEdited?: () => void;
  readonly retake?: (bookId: BookId) => void;
  readonly name: string;
  readonly analyze?: (text: string) => Analysis;
}

export const readBooks = (
  shell: Shell,
  wanted: ReadonlySet<BookId>,
  analyze: (text: string) => Analysis,
): BookText[] => {
  const project = shell.project();
  if (project === undefined) return [];
  const books: BookText[] = [];
  for (const book of project.books) {
    if (!wanted.has(book.id)) continue;
    shell.stampOf(book.id);
    const source = book.source();
    const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(book.id));
    const analysis =
      held !== undefined && describesExactly(held.analysis, source.text)
        ? held.analysis
        : analyze(source.text);
    const heading = bookHeading(analysis);
    books.push({
      bookId: book.id,
      text: source.text,
      analysis,
      label: (address) => shell.location.label(address, heading),
    });
  }
  return books;
};

interface HeldBook {
  readonly revision: number;
  readonly length: number;
  readonly analysis: Analysis;
  readonly hits: readonly Occurrence[];
  readonly book: BookText;
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
}

const sameHits = (a: readonly Occurrence[], b: readonly Occurrence[]): boolean =>
  a.length === b.length && a.every((hit, at) => hit === b[at]);

interface Model {
  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  readonly books: ReadonlyMap<BookId, BookText>;
}

const buildModel = (
  shell: Shell,
  options: ExcerptFeedOptions,
  analyze: (text: string) => Analysis,
  held: Map<BookId, HeldBook>,
  initial: Extent,
): Model => {
  const project = shell.project();
  if (project === undefined) return { groups: [], outline: [], books: new Map<BookId, BookText>() };
  const hits = options.hits();
  const done = shell.services.composition.observability.span(`${options.name}.group`);
  let reused = 0;
  let rebuilt = 0;
  const byBook = new Map<BookId, Occurrence[]>();
  for (const hit of hits) {
    const list = byBook.get(hit.bookId);
    if (list === undefined) byBook.set(hit.bookId, [hit]);
    else list.push(hit);
  }
  const books = readBooks(shell, new Set(byBook.keys()), analyze);
  const groups: BookExcerpts[] = [];
  const outline: OutlineRow[] = [];
  const texts = new Map<BookId, BookText>();
  for (const book of books) {
    const own = byBook.get(book.bookId) ?? [];
    const stamp = shell.stampOf(book.bookId);
    const before = held.get(book.bookId);
    const reuse = before !== undefined && sameHits(before.hits, own);
    if (reuse) {
      reused += 1;
      groups.push(...before.groups);
      outline.push(...before.outline);
      texts.set(book.bookId, before.book);
      continue;
    }
    rebuilt += 1;
    const built = group([book], own, initial);
    groups.push(...built.groups);
    outline.push(...built.outline);
    texts.set(book.bookId, book);
    held.set(book.bookId, {
      revision: stamp?.revision ?? -1,
      length: stamp?.length ?? -1,
      analysis: book.analysis,
      hits: own,
      book,
      groups: built.groups,
      outline: built.outline,
    });
  }
  for (const id of held.keys()) if (!byBook.has(id)) held.delete(id);
  done({
    "excerpts.hits": hits.length,
    "excerpts.books_reused": reused,
    "excerpts.books_rebuilt": rebuilt,
  });
  return { groups, outline, books: texts };
};

const createSeats = (shell: Shell): Pick<ExcerptFeed, "seatedOf" | "seat"> => {
  const [seats, setSeats] = createSignal(0, { name: "excerptSeats" });
  const funnels = new WeakMap<EditorBook, Following>();
  const seatedOf = (bookId: BookId): Following | undefined => {
    seats();
    const book = shell.services.seated(bookId);
    if (book === undefined) return undefined;
    const held = funnels.get(book);
    if (held !== undefined) return held;
    const made = book.funnel();
    funnels.set(book, made);
    return made;
  };

  const seat = async (bookId: BookId): Promise<EditorBook | undefined> => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await shell.services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) {
      shell.report(t("could not open book {book}", { book: bookId }));
      return undefined;
    }
    setSeats((held) => held + 1);
    return shell.services.seated(bookId);
  };
  return { seatedOf, seat };
};

const openerOf =
  (
    shell: Shell,
    navigate: ReturnType<typeof useNavigate>,
    name: string,
  ): ExcerptFeed["openInEditor"] =>
  (
    bookId: BookId,
    from: number,
    to?: number,
    into: ObservabilityService = shell.services.composition.observability,
  ): void => {
    const project = shell.project();
    if (project === undefined) return;
    const done = into.span(`${name}.openInEditor`, `${bookId} ${from}`);
    shell.aim(bookId, from, to);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slugFor(project.root), book: bookId },
    });
    done();
  };

const editedOf = (shell: Shell, options: ExcerptFeedOptions): ExcerptFeed["edited"] => {
  return (bookId) => {
    shell.changed({ kind: "book.apply", books: [bookId] });
    const now = options.retake;
    if (now !== undefined) {
      now(bookId);
      return;
    }
    const after = options.onEdited;
    if (after === undefined) return;
    void shell.services
      .run(
        Stream.runHead(shell.services.projectAnalysis.watch()).pipe(
          Effect.timeout(500),
          Effect.ignore,
        ),
      )
      .then(after);
  };
};

export const createExcerptFeed = (options: ExcerptFeedOptions): ExcerptFeed => {
  const shell = useShell();
  const navigate = useNavigate();

  const views = createCardViews<Excerpt>("excerpt");

  const context = Math.max(
    0,
    shell.services.settings.get(shellKeys(shell.services.settings).excerptContext),
  );
  const initial: Extent = { up: context, down: context };

  const expand = (sid: string, step: ContextStep): void => {
    views.send(sid, { kind: "step", step, from: initial });
  };

  const analyze = options.analyze ?? shell.services.galley.memoize();

  const held = new Map<BookId, HeldBook>();

  const model = createMemo(() => buildModel(shell, options, analyze, held, initial), {
    name: "excerptModel",
  });

  const widened = new WeakMap<Excerpt, { readonly extent: Extent; readonly shown: Excerpt }>();

  const shownOf = (excerpt: Excerpt): Excerpt => {
    const want = views.extents().get(excerpt.sid);
    if (want === undefined) return excerpt;
    const held = widened.get(excerpt);
    if (held?.extent === want) return held.shown;
    const book = model().books.get(excerpt.bookId);
    if (book === undefined) return excerpt;
    const shown = extend(book, excerpt, want);
    widened.set(excerpt, { extent: want, shown });
    return shown;
  };

  const { seatedOf, seat } = createSeats(shell);
  const openInEditor = openerOf(shell, navigate, options.name);
  const edited = editedOf(shell, options);

  return {
    views,
    initial,
    groups: () => model().groups,
    outline: () => model().outline,
    shownOf,
    analyze,
    expand,
    seat,
    seatedOf,
    openInEditor,
    edited,
  };
};
