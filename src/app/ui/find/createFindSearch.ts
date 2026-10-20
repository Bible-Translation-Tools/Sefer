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

export function createFindSearch(inputs: SearchInputs) {
  const { shell, scope, results, sources, books: bookScopes } = inputs;
  const { markup, query } = inputs.query;
  const { hits, setHits, setReferenceHits, setHelpHits, setProblem, setCursor, searched } = results;
  const { setSearched, setPreview } = results;
  const { analysisOf, searchable } = sources;
  const { booksFor, projectBooks, signature } = bookScopes;

  // ~0.6MB of mask maps for a whole Bible; readings rebuilt per search (~9ms).
  const readings = createReadings(shell.services.galley);

  let latest = 0;
  const run = async (over?: Over): Promise<void> => {
    const generation = (latest += 1);
    const previous = untrack(searched);
    setPreview(undefined);
    setSearched("");
    const project = shell.project();
    if (project === undefined) return;
    const books = project.books;
    const staticQuery = query(over);
    const want = over?.scope ?? scope();
    const only = booksFor(want);
    const options: Search.Options =
      only === undefined ? { analysisOf } : { books: only, analysisOf };
    if (staticQuery.text === "") {
      setHits([]);
      setReferenceHits([]);
      setHelpHits([]);
      setProblem("");
      return;
    }
    if (!Search.longEnough(staticQuery.text)) {
      setHits([]);
      setReferenceHits([]);
      setHelpHits([]);
      setProblem(
        t("Type at least {count} characters to search the whole project.", {
          count: Search.MINIMUM_QUERY,
        }),
      );
      return;
    }

    const search = shell.services.composition.observability.operation("find.run", {
      "find.scope": want,
      "find.books": only === undefined ? books.length : only.length,
      "find.regex": staticQuery.regex === true,
      "find.case": staticQuery.caseSensitive === true,
      "find.whole_word": staticQuery.wholeWord === true,
      "find.markup": markup(),
      "find.chars": staticQuery.text.length,
    });

    if (want === "helps") {
      const context = borrowedContext(shell.services);
      const stop = search.span("find.scan");
      const found: HelpHit[] = [];
      for (const { resource, documents } of untrack(searchable)) {
        const listed = await shell.services.run(
          Effect.result(documents.list(projectBooks(), context)),
        );
        if (generation !== latest) {
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
      return;
    }

    if (want === "reference") {
      const analysis = shell.services.projectAnalysis;
      const references = analysis.references().flatMap((id) => {
        const text = analysis.referenceText(id);
        return text === undefined ? [] : [{ id, text }];
      });
      const stop = search.span("find.scan");
      const found = Search.findInReferences(readings, references, staticQuery, options);
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
      return;
    }

    const stop = search.span("find.scan");
    const found = markup()
      ? Search.find(books, staticQuery, options)
      : Search.findInReading(readings, books, staticQuery, options);
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
    if (previous !== signature(staticQuery, want)) setCursor(0);
    setHits(found.success);
    setSearched(signature(staticQuery, want));
    search.end("ready", {
      "find.hits": found.success.length,
      "find.hit_books": new Set(found.success.map((hit) => hit.bookId)).size,
    });
  };

  const fresh = createFreshReadings(shell.services.galley);
  const retake = (bookId: BookId): void => {
    const project = shell.project();
    const book = project?.book(bookId);
    const staticQuery = query();
    const want = scope();
    if (project === undefined || book === undefined) return;
    if (want === "reference" || want === "helps" || !Search.longEnough(staticQuery.text)) return;
    const only = booksFor(want);
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
    const others = untrack(hits).filter((hit) => hit.bookId !== bookId);
    const at = others.findIndex((hit) => (order.get(hit.bookId) ?? 0) > turn);
    const next =
      at < 0
        ? [...others, ...found.success]
        : [...others.slice(0, at), ...found.success, ...others.slice(at)];
    setHits(next);
    op.end("ready", { "find.hits": found.success.length, "find.total": next.length });
  };

  return { run, retake };
}
