import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import SearchIcon from "lucide-solid/icons/search";
import { Show } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { createExcerptFeed, excerptCard, ExcerptList } from "#app/ui/excerpts";
import { createFindBooks } from "#app/ui/find/createFindBooks";
import { createFindCursor } from "#app/ui/find/createFindCursor";
import { createFindExpect } from "#app/ui/find/createFindExpect";
import { createFindMatches } from "#app/ui/find/createFindMatches";
import { createFindPairing } from "#app/ui/find/createFindPairing";
import { createFindQuery } from "#app/ui/find/createFindQuery";
import { createFindReplace } from "#app/ui/find/createFindReplace";
import { createFindResults } from "#app/ui/find/createFindResults";
import { createFindSearch } from "#app/ui/find/createFindSearch";
import { createFindSources } from "#app/ui/find/createFindSources";
import { createFindTriggers } from "#app/ui/find/createFindTriggers";
import { FindExpectCard } from "#app/ui/find/FindExpectCard";
import { FindReplaceCard } from "#app/ui/find/FindReplaceCard";
import { FindScopeRow } from "#app/ui/find/FindScopeRow";
import { FindSearchBar } from "#app/ui/find/FindSearchBar";
import type { FindSearch, Scope } from "#app/ui/find/helpers";
import { Card, EmptyState, PanelHeader } from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";

function Find() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();

  const scope = (): Scope => params().scope ?? "project";
  const asked = (): string => params().q ?? "";

  const ask = (next: FindSearch): void => {
    void navigate({
      to: "/project/$slug/find",
      params: { slug: shell.slug() },
      search: { ...params(), ...next },
      replace: true,
    });
  };

  const query = createFindQuery(asked);
  const results = createFindResults();
  const sources = createFindSources({ shell, scope, rerunHelps: () => void search.run() });
  const books = createFindBooks({ shell, scope, markup: query.markup });
  const search = createFindSearch({ shell, scope, query, results, sources, books });
  const replace = createFindReplace({ shell, scope, query, results, books, run: search.run });
  const { commit } = createFindTriggers({
    asked,
    scope,
    query,
    books,
    sources,
    run: search.run,
    ask,
  });
  const expect = createFindExpect({ shell, params, scope, results, sources, ask });
  const { feedHits } = createFindMatches({ scope, results, sources, expect });

  const feed = createExcerptFeed({
    hits: feedHits,
    name: "find",
    onEdited: () => {
      void search.run();
    },
    retake: (bookId) => search.retake(bookId),
  });

  const { feedPairedOf } = createFindPairing({ shell, scope, results, sources });
  const { cursorSid, cursorAt, step } = createFindCursor({ results, feedHits, feed });

  const mode = (): "regular" | "usfm" => (shell.mode() === "usfm" ? "usfm" : "regular");

  const card = excerptCard(
    { kind: "steps", step: feed.expand },
    { kind: "editor", to: feed.openInEditor },
  );

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6">
      <PanelHeader title={t("Find")} />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
        <Card>
          <div class="flex flex-col gap-3">
            <FindSearchBar query={query} commit={commit} />
            <FindScopeRow
              shell={shell}
              scope={scope}
              ask={ask}
              books={books}
              sources={sources}
              expect={expect}
              results={results}
              feedHits={feedHits}
              step={step}
            />
          </div>
        </Card>

        <Show when={scope() === "reference" && expect.expectShown()}>
          <FindExpectCard params={params} ask={ask} expect={expect} />
        </Show>

        <Show when={replace.replaceEnabled() && scope() !== "reference" && scope() !== "helps"}>
          <FindReplaceCard scope={scope} results={results} replace={replace} />
        </Show>

        <Show when={results.problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {results.problem()}
          </p>
        </Show>

        <ExcerptList
          goneLabel={t("No longer matches")}
          resultsKey={asked()}
          groups={feed.groups()}
          views={feed.views}
          outline={feed.outline()}
          card={card}
          seat={feed.seat}
          seatedOf={feed.seatedOf}
          shownOf={feed.shownOf}
          analyze={feed.analyze}
          onEdited={feed.edited}
          focus={cursorSid()}
          activeHit={cursorAt()}
          mode={mode()}
          pairedOf={feedPairedOf()}
          empty={
            <EmptyState
              icon={<SearchIcon size={22} />}
              title={
                feedHits().length === 0 && query.text() !== ""
                  ? t("No matches")
                  : t("Nothing searched yet")
              }
              description={
                scope() === "reference"
                  ? t("Searching {count} reference book(s); your own verse is the editable one.", {
                      count: sources.bound().ids.length,
                    })
                  : t("Results are grouped by verse, one card each, read-only until you edit.")
              }
            />
          }
        />
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/_app/project/$slug/find")({
  validateSearch: (search: Record<string, unknown>): FindSearch => ({
    ...(typeof search["q"] === "string" && search["q"] !== "" ? { q: search["q"] } : {}),
    ...(search["scope"] === "book" ||
    search["scope"] === "ot" ||
    search["scope"] === "nt" ||
    search["scope"] === "custom" ||
    search["scope"] === "reference" ||
    search["scope"] === "helps"
      ? { scope: search["scope"] }
      : {}),
    ...((typeof search["expect"] === "string" && search["expect"] !== "") ||
    typeof search["expect"] === "number"
      ? { expect: String(search["expect"]) }
      : {}),
    ...(search["show"] === "with" || search["show"] === "all" || search["show"] === "without"
      ? { show: search["show"] }
      : {}),
  }),
  beforeLoad: ({ location, params }) => {
    if (new URLSearchParams(location.searchStr).get("mode") === "stet")
      throw redirect({ to: "/project/$slug/terms", params: { slug: params.slug }, search: {} });
  },
  head: () => ({ meta: [{ title: "Sefer — find" }] }),
  component: () => <ShellGate>{() => <Find />}</ShellGate>,
});
