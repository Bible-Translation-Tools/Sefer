/**
 * The multibuffer's feed: occurrences in, groups out, plus the four actions
 * every screen that shows excerpts needs.
 *
 * Find and Key terms are separate panes with separate URLs, and they agree on
 * everything below the hits: which books to analyse, how a card expands, what
 * Edit seats, where Open in editor goes, and what happens after an accepted
 * edit. That agreement used to be two copies of the same ninety lines in two
 * routes; it is this file instead, so a fix to the staleness rule or the
 * analysis cache lands on both panes at once.
 *
 * What it deliberately does NOT own is the hits. Find's are search results and
 * Key terms' are a guide's references mapped onto the project — two very
 * different productions, and the only thing they have in common is the shape
 * they arrive in (`core/excerpts`' `Occurrence`).
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result, Stream } from "effect";
import { createMemo, createSignal, type Accessor } from "solid-js";

import type { BookId } from "#core/book/book";
import {
  extend,
  group,
  type BookExcerpts,
  type BookText,
  type Extent,
  type Occurrence,
  type OutlineRow,
} from "#core/excerpts/excerpts";
import { describesExactly, type Analysis } from "#core/galley";
import type { EditorBook } from "#editor/index";

import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";

export interface ExcerptFeed {
  readonly groups: Accessor<readonly BookExcerpts[]>;
  readonly outline: Accessor<readonly OutlineRow[]>;
  /** One memoized parse for the whole screen; handed to every open satellite. */
  readonly analyze: (text: string) => Analysis;
  /** Show one more verse above (-1) or below (+1) of one card. */
  readonly expand: (sid: string, direction: -1 | 1) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly openInEditor: (bookId: BookId, from: number, to?: number) => void;
  /** An excerpt's edit session ended: rebuild, then tell the caller. */
  readonly edited: () => void;
}

export interface ExcerptFeedOptions {
  readonly hits: Accessor<readonly Occurrence[]>;
  /**
   * Called once the project has re-published after an accepted edit. Find
   * re-runs its search here; a feed whose hits are not derived from the text
   * needs nothing, because the model already re-read the books.
   */
  readonly onEdited?: () => void;
  /** Names this screen's `openInEditor` span — "find", "terms". */
  readonly name: string;
  /**
   * The parse cache to use. A screen that has to analyse books BEFORE it has
   * hits — Key terms resolves a guide's references against each book's table
   * of contents — passes its own, so the project is parsed once for the screen
   * rather than once for the mapping and once again for the cards.
   */
  readonly analyze?: (text: string) => Analysis;
}

/**
 * The named books as the excerpt model reads them: canonical text plus the
 * parse that describes it, in project order. Call it inside a memo — it is
 * what makes that memo depend on the books it reads.
 *
 * ProjectAnalysis already holds a parse per book, and it is used when it
 * still fits the text; otherwise `analyze` answers. Before this, Find, Key
 * terms and the feed each carried their own copy of the loop.
 */
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
    // The stamp of the book whose text is about to be read, so this depends
    // on the books it USES and not on every edit anywhere. The stamp is the
    // signal and the Book is still the source: a revision moves on every
    // accepted edit, which can only over-fire (an undo back to identical
    // text is a new revision) and never under-fire. A content hash would be
    // the other trade — exact, and a whole engine parse to compute.
    shell.stampOf(book.id);
    const source = book.source();
    const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(book.id));
    const analysis =
      held !== undefined && describesExactly(held.analysis, source.text)
        ? held.analysis
        : analyze(source.text);
    books.push({ bookId: book.id, text: source.text, analysis });
  }
  return books;
};

export const createExcerptFeed = (options: ExcerptFeedOptions): ExcerptFeed => {
  const shell = useShell();
  const navigate = useNavigate();

  /**
   * How far each card has been expanded, by verse sid.
   *
   * Here rather than in the card: a card scrolls out of the list's window and
   * its row is unmounted, and "show me one more verse" must survive that — as
   * it must survive the re-read an accepted edit provokes. A sid that is no
   * longer in the results is simply never asked for.
   */
  const [extents, setExtents] = createSignal<ReadonlyMap<string, Extent>>(new Map(), {
    name: "excerptExtents",
  });

  const expand = (sid: string, direction: -1 | 1): void => {
    setExtents((held) => {
      const next = new Map(held);
      const now = next.get(sid) ?? { up: 1, down: 1 };
      next.set(
        sid,
        direction === -1 ? { up: now.up + 1, down: now.down } : { up: now.up, down: now.down + 1 },
      );
      return next;
    });
  };

  // One memo for the whole screen, not one per excerpt: every book that holds
  // a hit is analysed through it, and a fresh memo per render would re-parse
  // the project on every keystroke.
  const analyze = options.analyze ?? shell.services.galley.memoize();

  /** The hits grouped over the books that hold them, as `readBooks` reads them. */
  const model = createMemo(
    () => {
      const project = shell.project();
      if (project === undefined) return { groups: [], outline: [] };
      const hits = options.hits();
      const books = readBooks(shell, new Set(hits.map((hit) => hit.bookId)), analyze);
      const built = group(books, hits);
      if (extents().size === 0) return built;
      // Only the cards the reader actually expanded are rebuilt; the rest are
      // the objects `group` already made, so a list of hundreds costs one
      // extra projection per expansion and nothing per untouched card.
      const texts = new Map(books.map((book) => [book.bookId, book] as const));
      return {
        outline: built.outline,
        groups: built.groups.map((entry) => {
          const text = texts.get(entry.bookId);
          if (text === undefined) return entry;
          return {
            ...entry,
            excerpts: entry.excerpts.map((excerpt) => {
              const want = extents().get(excerpt.sid);
              return want === undefined ? excerpt : extend(text, excerpt, want);
            }),
          };
        }),
      };
    },
    { name: "excerptModel" },
  );

  /**
   * The book the open excerpt editor is editing.
   *
   * `seat` is the feed's only door to an editable excerpt, and an excerpt
   * editor is a satellite on that one seat — so the book seated last is the
   * book `edited()` is about. Remembered here rather than threaded back
   * through `ExcerptList.onEdited`, which carries a card key and not a book.
   */
  let seated: BookId | undefined;

  const seat = async (bookId: BookId): Promise<EditorBook | undefined> => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await shell.services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) {
      shell.report(t("could not open book {book}", { book: bookId }));
      return undefined;
    }
    seated = bookId;
    return shell.services.seated(bookId);
  };

  /**
   * Open the main editor on a hit.
   *
   * Synchronous, deliberately: `aim` then `navigate`, with nothing awaited
   * between the click and the route change, because every await here is time
   * the reader spends looking at a card that did not visibly react. The span
   * is what says where the remaining time goes — the route's own `focus`
   * instantiates the book, and on a big one that is the part worth measuring.
   */
  const openInEditor = (bookId: BookId, from: number, to?: number): void => {
    const project = shell.project();
    if (project === undefined) return;
    const done = shell.services.composition.observability.span(
      `${options.name}.openInEditor`,
      `${bookId} ${from}`,
    );
    shell.aim(bookId, from, to);
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slugFor(project.root), book: bookId },
    });
    done();
  };

  /**
   * An accepted edit, and whatever the screen does about it.
   *
   * The wait is not a fudge. `findProjected` searches the CORPUS, and a book's
   * corpus registration is refreshed one scheduler pass after its text moved
   * (`ProjectAnalysis.supply`) — so searching the instant an edit lands would
   * answer from the text before it, and the result count would be a revision
   * behind. The next republish is the honest cue; the timeout is there because
   * an edit that was REFUSED republishes nothing at all.
   */
  const edited = (): void => {
    // Nothing seated means no excerpt was editable, so no edit was accepted.
    shell.changed({ kind: "book.apply", books: seated === undefined ? [] : [seated] });
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

  return {
    groups: () => model().groups,
    outline: () => model().outline,
    analyze,
    expand,
    seat,
    openInEditor,
    edited,
  };
};
