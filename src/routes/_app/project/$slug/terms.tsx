import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { createExcerptFeed, readBooks, StetView } from "#app/ui/excerpts";
import { PanelHeader, Select } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import { keyTermGuides, keyTerms, sourceReadings, type SourceReading } from "#app/workflows/stet";
import { refOccurrences, type Occurrence } from "#core/excerpts/excerpts";
import type { Address } from "#core/location/address";
import { DEFAULT_LOCALE } from "#core/stet/fixture";
import type { Guide, Term } from "#core/stet/stet";

/**
 * `/terms` — Key terms (STET), its own pane.
 *
 * Find and Key terms are separate panes with similar UI, not a mode toggle on
 * one page (`documentation/architecture/stet.md`). `/find?mode=stet` still
 * resolves — it redirects here — so a link somebody saved keeps working.
 *
 * ## The three steps this screen is
 *
 *  1. **The guide.** `keyTerms` decodes the committed catalogue through
 *     `src/core/stet`. It names references for the whole canon and has never
 *     heard of this project.
 *  2. **The mapping.** For each book the project has, `refOccurrences` asks
 *     Location (`resolve`, over Galley's table of contents) where those
 *     Addresses ARE in that book's own text — `JUD 1:2` inside a `\v 1-2` —
 *     and drops the ones it does not have — the guide covers sixty-six
 *     books and a project covers four. What comes out is the same
 *     `Occurrence` shape a search produces, so the whole multibuffer below it
 *     is the one Find uses (`createExcerptFeed`).
 *  3. **The source side.** `sourceReadings` resolves, once per term, what the
 *     upper card of each pair shows: the guide's frozen reading with its
 *     precomputed highlights, else a resource bound under the `source` role,
 *     else nothing — and "nothing" is printed, not hidden.
 *
 * **The URL is the state**: `term`, `q` and `locale` are read from the search
 * params on every render, exactly as `/find` reads its own, because the app bar
 * can navigate here while the screen is already mounted.
 *
 * What is NOT here: a done count. Marking an occurrence settled needs a store
 * that survives a reload and nothing in Sefer keeps one yet, so every count is
 * `0/n` and the term list says so in a muted line rather than showing progress
 * that is not being recorded.
 */

/**
 * A guide's language, named from its locale ("en" → "English"): the picker
 * says which language the source reads in, not which edition the guide was
 * cut from. The locale itself when the platform cannot name it.
 */
const languageOf = (locale: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
};

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
      // The guide load is one operation: the locale, how many terms and
      // references it holds, how long the decode took. A locale is a tag,
      // not content, and no term's text goes in.
      const guide = shell.services.composition.observability.operation("terms.load", {
        "terms.locale": want,
      });
      void shell.services.run(Effect.result(keyTermGuides())).then((found) => {
        if (Result.isSuccess(found)) setGuides(found.success);
      });
      void shell.services.run(Effect.result(keyTerms(want))).then((found) => {
        setLoading(false);
        if (Result.isFailure(found)) {
          guide.end("failed", { "terms.reason": found.failure.reason });
          setProblem(
            t("Could not read the key-terms guide: {reason}", { reason: found.failure.reason }),
          );
          setTerms([]);
          return;
        }
        guide.end("passed", {
          "terms.count": found.success.length,
          "terms.references": found.success.reduce(
            (total, term) => total + term.occurrences.length,
            0,
          ),
        });
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

  /**
   * Whether the list shows the term's additional references — every verse the
   * guide records it in — or only the curated ones a reviewer is asked to
   * look at. Back to curated whenever another term opens.
   */
  const [additional, setAdditional] = createSignal(false, { name: "termsAdditional" });
  createEffect(
    () => selected()?.id,
    () => {
      setAdditional(false);
    },
  );

  /**
   * The open term's curated references, as Addresses. A term the guide has
   * curated nothing for treats every reference as curated, so it still has
   * verses to show.
   */
  const curatedAddresses = createMemo(
    (): readonly Address[] => {
      const all = selected()?.occurrences ?? [];
      const curated = all.filter((held) => held.curated);
      return (curated.length > 0 ? curated : all).map((held) => held.address);
    },
    { name: "termCuratedAddresses" },
  );
  const allAddresses = createMemo(
    (): readonly Address[] => selected()?.occurrences.map((held) => held.address) ?? [],
    { name: "termAddresses" },
  );

  /**
   * The mapping, per book the project has.
   *
   * The same analysis rule the feed uses — ProjectAnalysis' parse when it
   * still describes the text, the screen's memo otherwise — because a
   * reference must be resolved against the text as it is NOW, not as it was
   * when the project opened.
   */
  const analyze = shell.services.galley.memoize();

  const mapped = (wanted: readonly Address[]): readonly Occurrence[] => {
    if (wanted.length === 0) return [];
    const books = readBooks(shell, new Set(wanted.map((address) => address.book)), analyze);
    return books.flatMap((book) => refOccurrences(book, wanted));
  };
  const curatedHits = createMemo(() => mapped(curatedAddresses()), {
    name: "termCuratedOccurrences",
  });
  const allHits = createMemo(() => mapped(allAddresses()), { name: "termAllOccurrences" });
  const hits = (): readonly Occurrence[] => (additional() ? allHits() : curatedHits());

  /** The curated occurrences, by place: what the sidebar lists. */
  const curatedAt = createMemo(
    () => new Set(curatedHits().map((hit) => `${hit.bookId}:${hit.from}`)),
    { name: "termCuratedAt" },
  );

  const feed = createExcerptFeed({ hits, name: "terms", analyze });

  // The source side, resolved once per term rather than once per card: a card
  // renders synchronously and reading a resource is an Effect.
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
      // One term opened: its references mapped onto the project, and its
      // source side read. The mapping is the memo the list renders from, read
      // here so its cost lands in this record rather than in a paint; `dropped`
      // is the references the project has no verse for. Counts only: no term,
      // gloss or reference goes in.
      const opening = shell.services.composition.observability.operation("terms.select", {
        "terms.references": term.occurrences.length,
      });
      const mapped = opening.span("terms.map");
      const staticHits = untrack(hits);
      const books = new Set(staticHits.map((hit) => hit.bookId)).size;
      mapped({ "terms.occurrences": staticHits.length });
      void shell.services
        .run(sourceReadings(shell.services.library, project.root, term.occurrences))
        .then((found) => {
          opening.end("passed", {
            "terms.occurrences": staticHits.length,
            "terms.dropped": Math.max(0, term.occurrences.length - staticHits.length),
            "terms.books": books,
            "terms.readings": found.size,
          });
          setReadings(found);
        });
    },
  );

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6">
      {/* The guide picker beside the title: it decides the source reading
          every card shows. Disabled while there is only one guide. */}
      <PanelHeader
        title={t("Key terms")}
        actions={
          <Show when={guides().length > 0}>
            <Select
              aria-label={t("Key terms guide")}
              value={locale()}
              disabled={guides().length < 2}
              onChange={(event) => ask({ locale: event.currentTarget.value, term: undefined })}
            >
              <For each={guides()}>
                {(guide) => (
                  <option value={guide.locale}>
                    {t("Source Language: {language}", { language: languageOf(guide.locale) })}
                  </option>
                )}
              </For>
            </Select>
          </Show>
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
          groups={feed.groups()}
          views={feed.views}
          outline={feed.outline()}
          onOpen={feed.openInEditor}
          seat={feed.seat}
          seatedOf={feed.seatedOf}
          shownOf={feed.shownOf}
          analyze={feed.analyze}
          onEdited={feed.edited}
          onExpand={feed.expand}
          mode={shell.mode() === "usfm" ? "usfm" : "regular"}
          sourceOf={(excerpt) => readings().get(excerpt.sid)}
          additional={additional()}
          onAdditional={setAdditional}
          additionalCount={allHits().length - curatedHits().length}
          isCurated={(excerpt) =>
            excerpt.hits.some((hit) => curatedAt().has(`${hit.bookId}:${hit.from}`))
          }
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
