import type { Address } from "@sefer/text/location/address";
import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";

import { createApprovals, type ApprovalsHandle } from "#app/approvals";
import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { createExcerptFeed, readBooks, StetView } from "#app/ui/excerpts";
import { PanelHeader, SegmentedControl } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import { keyTermGuides, keyTerms, sourceReadings, type SourceReading } from "#app/workflows/stet";
import { refOccurrences, type Occurrence } from "#core/excerpts/excerpts";
import { DEFAULT_LOCALE } from "#core/stet/fixture";
import type { Guide, Term } from "#core/stet/stet";

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

type Shell = ReturnType<typeof useShell>;

function createTermsLoad(shell: Shell, locale: () => string) {
  const [terms, setTerms] = createSignal<readonly Term[]>([], { name: "terms" });

  const [guides, setGuides] = createSignal<readonly Guide[]>([], { name: "termGuides" });
  const [loading, setLoading] = createSignal(true, { name: "termsLoading" });
  const [problem, setProblem] = createSignal("", { name: "termsProblem" });

  createEffect(
    () => locale(),
    (want) => {
      setLoading(true);
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
            t("Could not read the spiritual-terms guide: {reason}", {
              reason: found.failure.reason,
            }),
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

  return { terms, guides, loading, problem };
}

function createTermsHits(
  shell: Shell,
  terms: () => readonly Term[],
  selected: () => Term | undefined,
  additional: () => boolean,
) {
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

  const coreTotals = createMemo(
    (): ReadonlyMap<string, number> => {
      const held = terms();
      const coreOf = (term: Term): readonly Address[] => {
        const curated = term.occurrences.filter((occurrence) => occurrence.curated);
        return (curated.length > 0 ? curated : term.occurrences).map((each) => each.address);
      };
      const wanted = new Set(held.flatMap((term) => coreOf(term).map((address) => address.book)));
      const books = readBooks(shell, wanted, analyze);
      const out = new Map<string, number>();
      for (const term of held) {
        const addresses = coreOf(term);
        let count = 0;
        for (const book of books) count += refOccurrences(book, addresses).length;
        out.set(term.id, count);
      }
      return out;
    },
    { name: "termCoreTotals" },
  );

  const curatedAt = createMemo(
    () => new Set(curatedHits().map((hit) => `${hit.bookId}:${hit.from}`)),
    { name: "termCuratedAt" },
  );

  return { analyze, curatedHits, allHits, hits, coreTotals, curatedAt };
}

function createTermReadings(
  shell: Shell,
  selected: () => Term | undefined,
  hits: () => readonly Occurrence[],
) {
  const [readings, setReadings] = createSignal<ReadonlyMap<string, SourceReading>>(new Map(), {
    name: "termSourceReadings",
  });
  createEffect(
    () => selected()?.id,
    () => {
      const term = untrack(selected);
      const project = untrack(shell.project);
      if (term === undefined || project === undefined) {
        setReadings(new Map());
        return;
      }
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
  return readings;
}

interface TermsModel {
  readonly selected: () => Term | undefined;
  readonly load: ReturnType<typeof createTermsLoad>;
  readonly counts: ReturnType<typeof createTermsHits>;
  readonly feed: ReturnType<typeof createExcerptFeed>;
  readonly readings: () => ReadonlyMap<string, SourceReading>;
  readonly approvals: () => ApprovalsHandle | undefined;
  readonly additional: () => boolean;
  readonly setAdditional: (next: boolean) => void;
  readonly locale: () => string;
  readonly filter: () => string;
  readonly updateSearch: (next: TermsSearch) => void;
}

function TermsView(props: { readonly model: TermsModel }) {
  const shell = useShell();
  return (
    <Show when={props.model.approvals()}>
      {(held) => (
        <StetView
          approvals={held()}
          terms={props.model.load.terms()}
          selected={props.model.selected()?.id ?? ""}
          onSelect={(id) => props.model.updateSearch({ term: id })}
          filter={props.model.filter()}
          onFilter={(text) => props.model.updateSearch({ q: text })}
          guides={props.model.load.guides()}
          locale={props.model.locale()}
          onLocale={(next) => props.model.updateSearch({ locale: next, term: undefined })}
          loading={props.model.load.loading()}
          groups={props.model.feed.groups()}
          views={props.model.feed.views}
          outline={props.model.feed.outline()}
          onOpen={props.model.feed.openInEditor}
          seat={props.model.feed.seat}
          seatedOf={props.model.feed.seatedOf}
          shownOf={props.model.feed.shownOf}
          analyze={props.model.feed.analyze}
          onEdited={props.model.feed.edited}
          initial={props.model.feed.initial}
          onExpand={props.model.feed.expand}
          mode={shell.mode() === "usfm" ? "usfm" : "regular"}
          sourceOf={(excerpt) => props.model.readings().get(excerpt.sid)}
          additional={props.model.additional()}
          onAdditional={props.model.setAdditional}
          additionalCount={
            props.model.counts.allHits().length - props.model.counts.curatedHits().length
          }
          coreTotalOf={(id) => props.model.counts.coreTotals().get(id) ?? 0}
          isCurated={(excerpt) =>
            excerpt.hits.some((hit) =>
              props.model.counts.curatedAt().has(`${hit.bookId}:${hit.from}`),
            )
          }
        />
      )}
    </Show>
  );
}

function Terms() {
  const shell = useShell();
  const approvals = createMemo(
    (): ApprovalsHandle | undefined => {
      const project = shell.project();
      return project === undefined ? undefined : createApprovals(shell.services, project.root);
    },
    { name: "termsApprovals" },
  );
  const navigate = useNavigate();
  const params = Route.useSearch();

  const locale = (): string => params().locale ?? DEFAULT_LOCALE;
  const filter = (): string => params().q ?? "";

  const updateSearch = (next: TermsSearch): void => {
    void navigate({
      to: "/project/$slug/terms",
      params: { slug: shell.slug() },
      search: { ...params(), ...next },
      replace: true,
    });
  };

  const load = createTermsLoad(shell, locale);

  const selected = createMemo(
    () => {
      const asked = params().term;
      const held = load.terms();
      if (asked !== undefined) {
        const found = held.find((term) => term.id === asked);
        if (found !== undefined) return found;
      }
      return held[0];
    },
    { name: "selectedTerm" },
  );

  const [additional, setAdditional] = createSignal(false, { name: "termsAdditional" });
  createEffect(
    () => selected()?.id,
    () => {
      setAdditional(false);
    },
  );

  const counts = createTermsHits(shell, load.terms, selected, additional);
  const feed = createExcerptFeed({ hits: counts.hits, name: "terms", analyze: counts.analyze });
  const readings = createTermReadings(shell, selected, counts.hits);
  const model: TermsModel = {
    selected,
    load,
    counts,
    feed,
    readings,
    approvals,
    additional,
    setAdditional,
    locale,
    filter,
    updateSearch,
  };

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6">
      <PanelHeader
        title={selected()?.term ?? t("Spiritual terms")}
        actions={
          <Show when={load.guides().length > 0}>
            <SegmentedControl
              label={t("Spiritual terms source language")}
              tone="light"
              items={load.guides().map((guide) => ({
                value: guide.locale,
                label: languageOf(guide.locale.split("-")[0] ?? guide.locale),
              }))}
              value={locale()}
              onChange={(next) => updateSearch({ locale: next, term: undefined })}
            />
          </Show>
        }
      />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-primary">{t("Open a project first.")}</p>}
      >
        <Show when={load.problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {load.problem()}
          </p>
        </Show>

        <TermsView model={model} />
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
  head: () => ({ meta: [{ title: "Sefer — spiritual terms" }] }),
  component: () => <ShellGate>{() => <Terms />}</ShellGate>,
});
