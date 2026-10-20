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

type Params = ReturnType<typeof Route.useSearch>;

function createFindModel(
  shell: ReturnType<typeof useShell>,
  navigate: ReturnType<typeof useNavigate>,
  params: Params,
) {
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

  return {
    shell,
    params,
    scope,
    asked,
    ask,
    query,
    results,
    sources,
    books,
    replace,
    commit,
    expect,
    feedHits,
    feed,
    feedPairedOf,
    cursorSid,
    cursorAt,
    step,
    mode,
    card,
  };
}

type FindModel = ReturnType<typeof createFindModel>;

function FindControls(props: { readonly model: FindModel }) {
  return (
    <Card>
      <div class="flex flex-col gap-3">
        <FindSearchBar query={props.model.query} commit={props.model.commit} />
        <FindScopeRow
          shell={props.model.shell}
          scope={props.model.scope}
          ask={props.model.ask}
          books={props.model.books}
          sources={props.model.sources}
          expect={props.model.expect}
          results={props.model.results}
          feedHits={props.model.feedHits}
          step={props.model.step}
        />
      </div>
    </Card>
  );
}

function FindNotices(props: { readonly model: FindModel }) {
  return (
    <>
      <Show when={props.model.scope() === "reference" && props.model.expect.expectShown()}>
        <FindExpectCard
          params={props.model.params}
          ask={props.model.ask}
          expect={props.model.expect}
        />
      </Show>

      <Show
        when={
          props.model.replace.replaceEnabled() &&
          props.model.scope() !== "reference" &&
          props.model.scope() !== "helps"
        }
      >
        <FindReplaceCard
          scope={props.model.scope}
          results={props.model.results}
          replace={props.model.replace}
        />
      </Show>

      <Show when={props.model.results.problem() !== ""}>
        <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
          {props.model.results.problem()}
        </p>
      </Show>
    </>
  );
}

function FindResultsList(props: { readonly model: FindModel }) {
  return (
    <ExcerptList
      goneLabel={t("No longer matches")}
      resultsKey={props.model.asked()}
      groups={props.model.feed.groups()}
      views={props.model.feed.views}
      outline={props.model.feed.outline()}
      card={props.model.card}
      seat={props.model.feed.seat}
      seatedOf={props.model.feed.seatedOf}
      shownOf={props.model.feed.shownOf}
      analyze={props.model.feed.analyze}
      onEdited={props.model.feed.edited}
      focus={props.model.cursorSid()}
      activeHit={props.model.cursorAt()}
      mode={props.model.mode()}
      pairedOf={props.model.feedPairedOf()}
      empty={
        <EmptyState
          icon={<SearchIcon size={22} />}
          title={
            props.model.feedHits().length === 0 && props.model.query.text() !== ""
              ? t("No matches")
              : t("Nothing searched yet")
          }
          description={
            props.model.scope() === "reference"
              ? t("Searching {count} reference book(s); your own verse is the editable one.", {
                  count: props.model.sources.bound().ids.length,
                })
              : t("Results are grouped by verse, one card each, read-only until you edit.")
          }
        />
      }
    />
  );
}

function Find() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();
  const model = createFindModel(shell, navigate, params);

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6">
      <PanelHeader title={t("Find")} />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
        <FindControls model={model} />
        <FindNotices model={model} />
        <FindResultsList model={model} />
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
