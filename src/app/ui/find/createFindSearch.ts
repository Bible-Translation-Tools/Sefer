import type { BookId } from "@sefer/text/book";
import { Effect, Result } from "effect";
import { untrack } from "solid-js";

import { t } from "#app/i18n";
import { borrowedContext } from "#app/kinds/context";
import type { useShell } from "#app/ProjectContext";
import { createFreshReadings, createReadings } from "#core/search/reading";
import * as Search from "#core/search/search";

import type { FindBooks } from "./createFindBooks";
import type { FindQuery } from "./createFindQuery";
import type { FindResults } from "./createFindResults";
import type { FindSources } from "./createFindSources";
import type { HelpHit, Over, Scope } from "./helpers";

export interface SearchInputs {
  readonly shell: ReturnType<typeof useShell>;
  readonly scope: () => Scope;
  readonly query: FindQuery;
  readonly results: FindResults;
  readonly sources: FindSources;
  readonly books: FindBooks;
}

type Operation = ReturnType<
  ReturnType<typeof useShell>["services"]["composition"]["observability"]["operation"]
>;

interface Scan {
  readonly search: Operation;
  readonly text: ReturnType<FindQuery["query"]>;
  readonly options: Search.Options;
  readonly want: Scope;
  readonly books: NonNullable<ReturnType<SearchInputs["shell"]["project"]>>["books"];
  readonly previous: string;
  readonly generation: number;
  readonly latest: () => number;
  readonly readings: ReturnType<typeof createReadings>;
}

function clearAll(inputs: SearchInputs, problem: string): void {
  const { setHits, setReferenceHits, setHelpHits, setProblem } = inputs.results;
  setHits([]);
  setReferenceHits([]);
  setHelpHits([]);
  setProblem(problem);
}

async function scanHelps(inputs: SearchInputs, scan: Scan): Promise<void> {
  const { shell, results, sources } = inputs;
  const { setHits, setReferenceHits, setHelpHits, setProblem } = results;
  const { searchable } = sources;
  const { search, text: staticQuery } = scan;
  const context = borrowedContext(shell.services);
  const stop = search.span("find.scan");
  const found: HelpHit[] = [];
  for (const { resource, documents } of untrack(searchable)) {
    const listed = await shell.services.run(
      Effect.result(documents.list(inputs.books.projectBooks(), context)),
    );
    if (scan.generation !== scan.latest()) {
      stop();
      search.end("declined", { "find.reason": "superseded" });
      return;
    }
    if (Result.isFailure(listed)) continue;
    const texts = new Map(listed.success.map((document) => [document.id, document.text]));
    const scanned = Search.findInDocuments(listed.success, staticQuery);
    if (Result.isFailure(scanned)) {
      stop();
      setProblem(scanned.failure.description);
      setHelpHits([]);
      search.end("refused", { "find.reason": scanned.failure.reason });
      return;
    }
    for (const hit of scanned.success)
      found.push({ title: resource.title, text: texts.get(hit.document) ?? "", hit });
  }
  stop();
  setHits([]);
  setReferenceHits([]);
  setProblem("");
  setHelpHits(found);
  search.end("ready", { "find.hits": found.length, "find.resources": searchable().length });
}

function scanReferences(inputs: SearchInputs, scan: Scan): void {
  const { shell, results } = inputs;
  const { setHits, setReferenceHits, setHelpHits, setProblem } = results;
  const { search } = scan;
  const analysis = shell.services.projectAnalysis;
  const references = analysis.references().flatMap((id) => {
    const text = analysis.referenceText(id);
    return text === undefined ? [] : [{ id, text }];
  });
  const stop = search.span("find.scan");
  const found = Search.findInReferences(scan.readings, references, scan.text, scan.options);
  stop();
  setHits([]);
  setHelpHits([]);
  if (Result.isFailure(found)) {
    setProblem(found.failure.description);
    setReferenceHits([]);
    search.end("refused", { "find.reason": found.failure.reason });
    return;
  }
  setProblem("");
  setReferenceHits(found.success);
  search.end("ready", {
    "find.hits": found.success.length,
    "find.references": references.length,
  });
}

function scanBooks(inputs: SearchInputs, scan: Scan): void {
  const { results, books: bookScopes } = inputs;
  const { setHits, setReferenceHits, setHelpHits, setProblem, setCursor, setSearched } = results;
  const { search, text: staticQuery, want } = scan;
  const stop = search.span("find.scan");
  const found = inputs.query.markup()
    ? Search.find(scan.books, staticQuery, scan.options)
    : Search.findInReading(scan.readings, scan.books, staticQuery, scan.options);
  stop();
  setReferenceHits([]);
  setHelpHits([]);
  if (Result.isFailure(found)) {
    setProblem(found.failure.description);
    setHits([]);
    search.end("refused", { "find.reason": found.failure.reason });
    return;
  }
  setProblem("");
  if (scan.previous !== bookScopes.signature(staticQuery, want)) setCursor(0);
  setHits(found.success);
  setSearched(bookScopes.signature(staticQuery, want));
  search.end("ready", {
    "find.hits": found.success.length,
    "find.hit_books": new Set(found.success.map((hit) => hit.bookId)).size,
  });
}

function createRun(inputs: SearchInputs, readings: Scan["readings"]) {
  const { shell, scope, results, sources, books: bookScopes } = inputs;
  const { markup, query } = inputs.query;
  const { setSearched, setPreview, searched } = results;
  let latest = 0;
  return async (over?: Over): Promise<void> => {
    const generation = (latest += 1);
    const previous = untrack(searched);
    setPreview(undefined);
    setSearched("");
    const project = shell.project();
    if (project === undefined) return;
    const books = project.books;
    const staticQuery = query(over);
    const want = over?.scope ?? scope();
    const only = bookScopes.booksFor(want);
    const options: Search.Options =
      only === undefined
        ? { analysisOf: sources.analysisOf }
        : { books: only, analysisOf: sources.analysisOf };
    if (staticQuery.text === "") return clearAll(inputs, "");
    if (!Search.longEnough(staticQuery.text))
      return clearAll(
        inputs,
        t("Type at least {count} characters to search the whole project.", {
          count: Search.MINIMUM_QUERY,
        }),
      );

    const search = shell.services.composition.observability.operation("find.run", {
      "find.scope": want,
      "find.books": only === undefined ? books.length : only.length,
      "find.regex": staticQuery.regex === true,
      "find.case": staticQuery.caseSensitive === true,
      "find.whole_word": staticQuery.wholeWord === true,
      "find.markup": markup(),
      "find.chars": staticQuery.text.length,
    });
    const scan: Scan = {
      search,
      text: staticQuery,
      options,
      want,
      books,
      previous,
      generation,
      latest: () => latest,
      readings,
    };
    if (want === "helps") return scanHelps(inputs, scan);
    if (want === "reference") return scanReferences(inputs, scan);
    scanBooks(inputs, scan);
  };
}

function createRetake(inputs: SearchInputs) {
  const { shell, scope, results, sources, books: bookScopes } = inputs;
  const { markup, query } = inputs.query;
  const { analysisOf } = sources;
  const fresh = createFreshReadings(shell.services.galley);
  return (bookId: BookId): void => {
    const project = shell.project();
    const book = project?.book(bookId);
    const staticQuery = query();
    const want = scope();
    if (project === undefined || book === undefined) return;
    if (want === "reference" || want === "helps" || !Search.longEnough(staticQuery.text)) return;
    const only = bookScopes.booksFor(want);
    if (only !== undefined && !only.includes(bookId)) return;
    const op = shell.services.composition.observability.operation("find.retake", {
      "find.book": bookId,
      "find.markup": markup(),
    });
    const found = markup()
      ? Search.find([book], staticQuery, { books: [bookId], analysisOf })
      : Search.findInReading(fresh, [book], staticQuery, { books: [bookId], analysisOf });
    if (Result.isFailure(found)) {
      op.end("refused", { "find.reason": found.failure.reason });
      return;
    }
    const order = new Map(project.books.map((entry, at) => [entry.id, at]));
    const turn = order.get(bookId) ?? 0;
    const others = untrack(results.hits).filter((hit) => hit.bookId !== bookId);
    const at = others.findIndex((hit) => (order.get(hit.bookId) ?? 0) > turn);
    const next =
      at < 0
        ? [...others, ...found.success]
        : [...others.slice(0, at), ...found.success, ...others.slice(at)];
    results.setHits(next);
    op.end("ready", { "find.hits": found.success.length, "find.total": next.length });
  };
}

export function createFindSearch(inputs: SearchInputs) {
  // ~0.6MB of mask maps for a whole Bible; readings rebuilt per search (~9ms).
  const readings = createReadings(inputs.shell.services.galley);
  const run = createRun(inputs, readings);
  const retake = createRetake(inputs);
  return { run, retake };
}
