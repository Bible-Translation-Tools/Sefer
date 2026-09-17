import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { createExcerptFeed, MatchFormattingView, StetView } from "../app/ui/excerpts";
import { PanelHeader, SegmentedControl } from "../app/ui/primitives";
import { ShellGate } from "../app/ui/ShellGate";
import * as References from "../app/workflows/references";
import {
  keyTermGuides,
  keyTerms,
  matchFormatting,
  occurrenceRef,
  sourceReadings,
  type MatchFormatting,
  type SourceReading,
} from "../app/workflows/stet";
import { trustedBy, type Ref } from "../core/book/book";
import { refOccurrences, type BookText, type Occurrence } from "../core/excerpts/excerpts";
import { chaptersTouched } from "../core/galley";
import { describesExactly } from "../core/galley";
import { DEFAULT_LOCALE } from "../core/stet/fixture";
import type { Guide, Term } from "../core/stet/stet";

/**
 * `/terms` — Key terms (STET), its own pane.
 *
 * It was a `mode=stet` branch on `/find` and is not any more: Will's decision
 * on the gap list is that Find and Key terms are "SEPARATE panes/routes with
 * similar UI, not a mode toggle on one page" (design-direction.md, "Decisions
 * on the gap list", item 5). `/find?mode=stet` still resolves — it redirects
 * here — so a link somebody saved keeps working.
 *
 * ## The three steps this screen is
 *
 *  1. **The guide.** `keyTerms` decodes the committed catalogue through
 *     `src/core/stet`. It names references for the whole canon and has never
 *     heard of this project.
 *  2. **The mapping.** For each book the project has, `refOccurrences` asks
 *     Onion's table of contents where those references ARE in that book's own
 *     text, and drops the ones it does not have — the guide covers sixty-six
 *     books and a project covers four. What comes out is the same
 *     `Occurrence` shape a search produces, so the whole multibuffer below it
 *     is the one Find uses (`createExcerptFeed`).
 *  3. **The source side.** `sourceReadings` resolves, once per term, what the
 *     upper card of each pair shows: the guide's frozen reading with its
 *     precomputed highlights, else a resource bound under the `source` role,
 *     else nothing — and "nothing" is printed, not hidden.
 *
 * **The URL is the state**: `term`, `q` and `locale` are read from the search
 * params on every render, exactly as `/find` reads its own, because the rail
 * can navigate here while the screen is already mounted.
 *
 * What is NOT here: a done count. Marking an occurrence settled needs a store
 * that survives a reload and nothing in Sefer keeps one yet, so every count is
 * `0/n` and the term list says so in a muted line rather than showing progress
 * that is not being recorded.
 */

/**
 * The two things this route shows.
 *
 * `terms` is the multibuffer above. `format` is MATCH FORMATTING — the same
 * pair of texts, asked a different question: not "is this term rendered well
 * here" but "does this book have the source's shape". They share a route
 * because they share a premise (a source bound to this project) and a reader
 * moves between them in one sitting; they are a segmented control rather than
 * two routes because neither is a destination anybody links to directly.
 */
type View = "terms" | "format";

/** The last path segment of a reference id, which is its whole file path. */
const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

interface TermsSearch {
  readonly term?: string;
  readonly q?: string;
  readonly locale?: string;
  readonly view?: View;
}

function Terms() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();

  const locale = (): string => params().locale ?? DEFAULT_LOCALE;
  const filter = (): string => params().q ?? "";
  const view = (): View => params().view ?? "terms";

  /** One navigation, merged over what the URL already says. */
  const ask = (next: TermsSearch): void => {
    void navigate({ to: "/terms", search: { ...params(), ...next }, replace: true });
  };

  const [terms, setTerms] = createSignal<readonly Term[]>([], { name: "terms" });
  const [guides, setGuides] = createSignal<readonly Guide[]>([], { name: "termGuides" });
  const [loading, setLoading] = createSignal(true, { name: "termsLoading" });
  const [problem, setProblem] = createSignal("", { name: "termsProblem" });
  const [readings, setReadings] = createSignal<ReadonlyMap<string, SourceReading>>(new Map(), {
    name: "termSourceReadings",
  });

  // The guide the URL names, loaded. A guide is a megabyte behind a dynamic
  // import, so this is asynchronous and the list says "loading" until it
  // lands; the catalogue caches by locale, so coming back is free.
  createEffect(
    () => locale(),
    (want) => {
      setLoading(true);
      void shell.services.run(Effect.result(keyTermGuides())).then((found) => {
        if (Result.isSuccess(found)) setGuides(found.success);
      });
      void shell.services.run(Effect.result(keyTerms(want))).then((found) => {
        setLoading(false);
        if (Result.isFailure(found)) {
          setProblem(
            t("Could not read the key-terms guide: {reason}", { reason: found.failure.reason }),
          );
          setTerms([]);
          return;
        }
        setProblem("");
        setTerms(found.success);
      });
    },
  );

  /** The open term: the one the URL names, or the guide's first. */
  const selected = createMemo(
    () => {
      const asked = params().term;
      const held = terms();
      if (asked !== undefined) {
        const found = held.find((term) => term.id === asked);
        if (found !== undefined) return found;
      }
      return held[0];
    },
    { name: "selectedTerm" },
  );

  /** The guide's references for the open term, as refs. */
  const refs = createMemo((): readonly Ref[] => selected()?.occurrences.map(occurrenceRef) ?? [], {
    name: "termRefs",
  });

  /**
   * The mapping, per book the project has.
   *
   * The same analysis rule the feed uses — ProjectAnalysis' parse when it
   * still describes the text, the screen's memo otherwise — because a
   * reference must be resolved against the text as it is NOW, not as it was
   * when the project opened.
   */
  const analyze = shell.services.galley.memoize();

  const hits = createMemo(
    (): readonly Occurrence[] => {
      const project = shell.project();
      const wanted = refs();
      if (project === undefined || wanted.length === 0) return [];
      const books = new Set(wanted.map((ref) => ref.book));
      const out: Occurrence[] = [];
      for (const book of project.books) {
        if (!books.has(book.id)) continue;
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
        const text: BookText = { bookId: book.id, text: source.text, analysis };
        out.push(...refOccurrences(text, wanted));
      }
      return out;
    },
    { name: "termOccurrences" },
  );

  const feed = createExcerptFeed({ hits, name: "terms", analyze });

  // The source side, resolved once per term rather than once per card: a card
  // renders synchronously and a Library lookup is an Effect.
  createEffect(
    () => selected()?.id,
    () => {
      // Snapshots, not dependencies: the compute above names the one thing
      // that should re-run this, and the readings are fetched for the term
      // selected at that moment.
      const term = untrack(selected);
      const project = untrack(shell.project);
      if (term === undefined || project === undefined) {
        setReadings(new Map());
        return;
      }
      void shell.services
        .run(sourceReadings(shell.services.library, project.root, term.occurrences))
        .then(setReadings);
    },
  );

  // -------------------------------------------------------------------------
  // Match formatting
  //
  // The source is a LIBRARY resource, not a project book, so the pair is found
  // by book code: the focused book's id against the reference file whose name
  // carries the same code. That is the same loose rule `Library.lookup` uses,
  // and it is loose on purpose — resource layouts vary and the manifest that
  // would answer authoritatively is YAML.
  // -------------------------------------------------------------------------

  const [bound, setBound] = createSignal(References.EMPTY, { name: "boundReferences" });
  const [sourceText, setSourceText] = createSignal("", { name: "matchSourceText" });
  const [sourceId, setSourceId] = createSignal("", { name: "matchSourceId" });

  createEffect(
    () => ({ root: shell.project()?.root, book: shell.focused()?.id, want: view() }),
    (now) => {
      if (now.want !== "format" || now.root === undefined) return;
      void shell.services.run(References.bindReferences(now.root)).then((found) => {
        setBound(found);
        const book = now.book;
        const match =
          book === undefined
            ? undefined
            : found.ids.find((id) =>
                id
                  .slice(id.lastIndexOf("/") + 1)
                  .toLowerCase()
                  .includes(book.toLowerCase()),
              );
        setSourceId(match ?? "");
        if (match === undefined) {
          setSourceText("");
          return;
        }
        void shell.services
          .run(References.textOfReference(match))
          .then((text) => setSourceText(text ?? ""));
      });
    },
  );

  const target = (): { readonly id: string; readonly text: string } | undefined => {
    const book = shell.focused();
    if (book === undefined) return undefined;
    // One book, one dependency: this follows the focused book's text and
    // nothing else's.
    shell.stampOf(book.id);
    return { id: book.id, text: book.source().text };
  };

  /**
   * Both skeletons and the transaction, recomputed when either text moves.
   *
   * Synchronous: these are wasm calls on the handle this process already holds,
   * and the whole point of fetching both skeletons at once is that the
   * highlight then costs nothing per cursor move.
   */
  const matched = createMemo(
    (): MatchFormatting | undefined => {
      const side = target();
      const text = sourceText();
      const id = sourceId();
      if (side === undefined || id === "" || text === "") return undefined;
      try {
        return matchFormatting(shell.services.galley, side, { id, text });
      } catch {
        // A book the overlay refuses — a stale address, a text the engine will
        // not parse — is not a crash on this screen: the view says there is
        // nothing to match and the reader picks another book.
        return undefined;
      }
    },
    { name: "matchFormatting" },
  );

  const applyOverlay = (): void => {
    const found = matched();
    const book = shell.focused();
    if (found === undefined || book === undefined) return;
    const applied = book.apply(found.overlay.edits, "format", trustedBy("format"));
    shell.report(
      Result.isFailure(applied)
        ? t("match formatting refused: {reason}", { reason: applied.failure.description })
        : t("matched {book} to the source's formatting", { book: book.id }),
    );
    shell.changed({ kind: "book.apply", books: [book.id] });
  };

  const note = (): string =>
    t(
      "Key terms come from the committed {locale} guide; nothing records which occurrences are settled, so every count is 0.",
      { locale: locale() },
    );

  return (
    <main class="flex h-screen min-w-0 flex-col gap-4 p-6">
      <PanelHeader
        title={view() === "format" ? t("Match formatting") : t("Key terms")}
        actions={
          <SegmentedControl
            label={t("View")}
            size="sm"
            value={view()}
            onChange={(next) => ask({ view: next === "format" ? "format" : "terms" })}
            items={[
              { value: "terms", label: t("Key terms") },
              { value: "format", label: t("Match formatting") },
            ]}
          />
        }
      />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

        <Show when={view() === "format"}>
          <MatchFormattingView
            found={matched()}
            targetText={target()?.text ?? ""}
            sourceText={sourceText()}
            targetLabel={shell.focused()?.id ?? t("no book open")}
            sourceLabel={
              sourceId() === "" ? t("no source bound for this book") : fileName(sourceId())
            }
            chapters={matched() === undefined ? [] : chaptersTouched(matched()!.overlay.report)}
            appliable={shell.focused() !== undefined && sourceId() !== ""}
            onApply={applyOverlay}
            empty={
              bound().resources.length === 0
                ? t("Bind a source or reference resource to this project first.")
                : shell.focused() === undefined
                  ? t("Open the book you want to match.")
                  : t("No reference file matches this book's code.")
            }
          />
        </Show>

        <Show when={view() === "terms"}>
          <StetView
            terms={terms()}
            selected={selected()?.id ?? ""}
            onSelect={(id) => ask({ term: id })}
            filter={filter()}
            onFilter={(text) => ask({ q: text })}
            guides={guides()}
            locale={locale()}
            onLocale={(next) => ask({ locale: next, term: undefined })}
            loading={loading()}
            note={note()}
            groups={feed.groups()}
            outline={feed.outline()}
            onOpen={feed.openInEditor}
            seat={feed.seat}
            analyze={feed.analyze}
            onEdited={feed.edited}
            onExpand={feed.expand}
            mode={shell.mode() === "usfm" ? "usfm" : "regular"}
            sourceOf={(excerpt) => readings().get(excerpt.sid)}
          />
        </Show>
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/terms")({
  validateSearch: (search: Record<string, unknown>): TermsSearch => ({
    ...(typeof search["term"] === "string" && search["term"] !== ""
      ? { term: search["term"] }
      : {}),
    ...(typeof search["q"] === "string" && search["q"] !== "" ? { q: search["q"] } : {}),
    ...(typeof search["locale"] === "string" && search["locale"] !== ""
      ? { locale: search["locale"] }
      : {}),
    ...(search["view"] === "format" ? { view: "format" as const } : {}),
  }),
  head: () => ({ meta: [{ title: "Sefer — key terms" }] }),
  component: () => <ShellGate>{() => <Terms />}</ShellGate>,
});
