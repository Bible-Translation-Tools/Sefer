/**
 * The multibuffer's feed: occurrences in, groups out, plus the four actions
 * every screen that shows excerpts needs.
 *
 * Find and Key terms are separate panes with separate URLs, and they agree on
 * everything below the hits: which books to analyse, how a card expands, what
 * Edit seats, where Open in editor goes, and what happens after an accepted
 * edit. That agreement is this one file rather than a copy per route, so a
 * fix to the staleness rule or the analysis cache lands on both panes at once.
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
  type Excerpt,
  type Extent,
  type Occurrence,
  type OutlineRow,
} from "#core/excerpts/excerpts";
import { bookHeading, describesExactly, type Analysis } from "#core/galley";
import type { ObservabilityService } from "#core/observability";
import type { EditorBook, Funnel } from "#editor/index";

import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import type { ContextStep } from "./ExcerptCard";

export interface ExcerptFeed {
  readonly groups: Accessor<readonly BookExcerpts[]>;
  readonly outline: Accessor<readonly OutlineRow[]>;
  /** One memoized parse for the whole screen; handed to every open satellite. */
  readonly analyze: (text: string) => Analysis;
  /** What a card shows: the excerpt as grouped, widened by the reader's steps. */
  readonly shownOf: (excerpt: Excerpt) => Excerpt;
  /** One context step for one card: a TOC unit up or down, or the whole chapter. */
  readonly expand: (sid: string, step: ContextStep) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  /**
   * A book's seat, while one is open — the book in the editor, or the one a
   * card is editing — for every card of that book to follow as it changes.
   */
  readonly seatedOf: (bookId: BookId) => Funnel | undefined;
  /**
   * `into` is the operation the jump belongs to, when the caller opened one
   * (the Findings panel's `findings.navigate`); without it the span is a root
   * of its own, as it always was.
   */
  readonly openInEditor: (
    bookId: BookId,
    from: number,
    to?: number,
    into?: ObservabilityService,
  ) => void;
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
 * still fits the text; otherwise `analyze` answers. Find, Key terms and the
 * feed share this one loop.
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
    // Labelled by the one display rule (`shell.location.label`), with the
    // book's own heading as its second choice, read once off this parse.
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

export const createExcerptFeed = (options: ExcerptFeedOptions): ExcerptFeed => {
  const shell = useShell();
  const navigate = useNavigate();

  /**
   * How far each card has been widened, by sid.
   *
   * Here rather than in the card: a card scrolls out of the list's window and
   * its row is unmounted, and "show me one more" must survive that — as
   * it must survive the re-read an accepted edit provokes. A sid that is no
   * longer in the results is simply never asked for.
   */
  const [extents, setExtents] = createSignal<ReadonlyMap<string, Extent>>(new Map(), {
    name: "excerptExtents",
  });

  /** What every card starts from: the reader's setting, read when the screen opens. */
  const context = Math.max(
    0,
    shell.services.settings.get(shellKeys(shell.services.settings).excerptContext),
  );
  const initial: Extent = { up: context, down: context };

  const expand = (sid: string, step: ContextStep): void => {
    setExtents((held) => {
      const next = new Map(held);
      const now = next.get(sid) ?? initial;
      next.set(
        sid,
        step === "chapter"
          ? { up: now.up, down: now.down, chapter: now.chapter !== true }
          : step === "up"
            ? { up: now.up + 1, down: now.down }
            : { up: now.up, down: now.down + 1 },
      );
      return next;
    });
  };

  // One memo for the whole screen, not one per excerpt: every book that holds
  // a hit is analysed through it, and a fresh memo per render would re-parse
  // the project on every keystroke.
  const analyze = options.analyze ?? shell.services.galley.memoize();

  /**
   * The hits grouped over the books that hold them, as `readBooks` reads them.
   *
   * NOT a function of the extents. Widening one card used to rebuild this for
   * every hit — on "the" over en_ulb that is 86,556 cards regrouped, and the
   * list's 86,556 rows re-estimated, for one click on one card. A card's own
   * extent is applied where the card is drawn (`shownOf`), to the twenty the
   * list is showing.
   */
  /**
   * The last grouping of each book, and what it was built from.
   *
   * Reused whenever the book's text, its parse and its hits are the same
   * values: a seat swap (Edit on a card, the editor opening the book) rewrites
   * the book's row in the shell store, and the stamp that comes back is a new
   * object with the same revision. Rebuilt from scratch, that regrouped every
   * hit of every book — 86,556 on "the" over en_ulb — for a click on one card,
   * and every card downstream saw a new excerpt. Now it regroups the books
   * that changed and hands every other book's groups back as they were.
   */
  const held = new Map<
    BookId,
    {
      readonly revision: number;
      readonly length: number;
      readonly analysis: Analysis;
      readonly hits: readonly Occurrence[];
      readonly book: BookText;
      readonly groups: readonly BookExcerpts[];
      readonly outline: readonly OutlineRow[];
    }
  >();

  /** Two hit lists that are the same hits, by identity: a search that did not re-run. */
  const sameHits = (a: readonly Occurrence[], b: readonly Occurrence[]): boolean =>
    a.length === b.length && a.every((hit, at) => hit === b[at]);

  const model = createMemo(
    () => {
      const project = shell.project();
      if (project === undefined)
        return { groups: [], outline: [], books: new Map<BookId, BookText>() };
      const hits = options.hits();
      // A span, so a seat swap or an edit shows in the ring how much it
      // regrouped: `excerpts.group` with the books reused and rebuilt.
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
        const reuse =
          before !== undefined &&
          stamp !== undefined &&
          before.revision === stamp.revision &&
          before.length === stamp.length &&
          before.analysis === book.analysis &&
          sameHits(before.hits, own);
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
    },
    { name: "excerptModel" },
  );

  /** The last widening computed per card, so a redraw of an unchanged card costs a lookup. */
  const widened = new WeakMap<Excerpt, { readonly extent: Extent; readonly shown: Excerpt }>();

  const shownOf = (excerpt: Excerpt): Excerpt => {
    const want = extents().get(excerpt.sid);
    if (want === undefined) return excerpt;
    const held = widened.get(excerpt);
    if (held?.extent === want) return held.shown;
    const book = model().books.get(excerpt.bookId);
    if (book === undefined) return excerpt;
    const shown = extend(book, excerpt, want);
    widened.set(excerpt, { extent: want, shown });
    return shown;
  };

  /**
   * The book the open excerpt editor is editing.
   *
   * `seat` is the feed's only door to an editable excerpt, and an excerpt
   * editor is a satellite on that one seat — so the book seated last is the
   * book `edited()` is about. Remembered here rather than threaded back
   * through `ExcerptList.onEdited`, which carries a card key and not a book.
   */
  let seated: BookId | undefined;
  /**
   * Moves whenever this screen seats a book. `services.seated` is a plain map,
   * so without this a card mounted before the seat would never learn of it —
   * and the one card that asked to edit would be the only one to change.
   */
  const [seats, setSeats] = createSignal(0, { name: "excerptSeats" });
  const funnels = new WeakMap<EditorBook, Funnel>();
  const seatedOf = (bookId: BookId): Funnel | undefined => {
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
    seated = bookId;
    setSeats((held) => held + 1);
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
  const openInEditor = (
    bookId: BookId,
    from: number,
    to?: number,
    into: ObservabilityService = shell.services.composition.observability,
  ): void => {
    const project = shell.project();
    if (project === undefined) return;
    const done = into.span(`${options.name}.openInEditor`, `${bookId} ${from}`);
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
   * The wait is not a fudge. `findInReading` reads its mask map from the
   * CORPUS, and a book's corpus registration is refreshed one scheduler pass after its text moved
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
    shownOf,
    analyze,
    expand,
    seat,
    seatedOf,
    openInEditor,
    edited,
  };
};
