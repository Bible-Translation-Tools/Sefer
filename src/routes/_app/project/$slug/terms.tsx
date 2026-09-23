import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { createExcerptFeed, readBooks, StetView } from "#app/ui/excerpts";
import { PanelHeader } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import {
  keyTermGuides,
  keyTerms,
  occurrenceRef,
  sourceReadings,
  type SourceReading,
} from "#app/workflows/stet";
import type { Ref } from "#core/book/book";
import { refOccurrences, type Occurrence } from "#core/excerpts/excerpts";
import { DEFAULT_LOCALE } from "#core/stet/fixture";
import type { Guide, Term } from "#core/stet/stet";

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

interface TermsSearch {
  readonly term?: string;
  readonly q?: string;
  readonly locale?: string;
}

function Terms() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();

  const locale = (): string => params().locale ?? DEFAULT_LOCALE;
  const filter = (): string => params().q ?? "";

  /** One navigation, merged over what the URL already says. */
  const ask = (next: TermsSearch): void => {
    void navigate({
      to: "/project/$slug/terms",
      params: { slug: shell.slug() },
      search: { ...params(), ...next },
      replace: true,
    });
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
      const wanted = refs();
      if (wanted.length === 0) return [];
      const books = readBooks(shell, new Set(wanted.map((ref) => ref.book)), analyze);
      return books.flatMap((book) => refOccurrences(book, wanted));
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

  const note = (): string =>
    t(
      "Key terms come from the committed {locale} guide; nothing records which occurrences are settled, so every count is 0.",
      { locale: locale() },
    );

  return (
    <main class="flex h-screen min-w-0 flex-col gap-4 p-6">
      <PanelHeader title={t("Key terms")} />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

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
    </main>
  );
}

export const Route = createFileRoute("/_app/project/$slug/terms")({
  validateSearch: (search: Record<string, unknown>): TermsSearch => ({
    ...(typeof search["term"] === "string" && search["term"] !== ""
      ? { term: search["term"] }
      : {}),
    ...(typeof search["q"] === "string" && search["q"] !== "" ? { q: search["q"] } : {}),
    ...(typeof search["locale"] === "string" && search["locale"] !== ""
      ? { locale: search["locale"] }
      : {}),
  }),
  head: () => ({ meta: [{ title: "Sefer — key terms" }] }),
  component: () => <ShellGate>{() => <Terms />}</ShellGate>,
});
