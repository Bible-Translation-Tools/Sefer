import type { BookId } from "@sefer/text/book";
import type { Address } from "@sefer/text/location/address";
import { bookName } from "@sefer/text/location/canon";
import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { Effect, Exit, Option, Result } from "effect";
import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import CodeIcon from "lucide-solid/icons/code";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import { t } from "#app/i18n";
import { borrowedContext } from "#app/kinds/context";
import { useShell } from "#app/ProjectContext";
import { shellKeys } from "#app/settings";
import {
  createExcerptFeed,
  excerptCard,
  ExcerptList,
  readBooks,
  type Paired,
} from "#app/ui/excerpts";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PanelHeader,
  BookScope,
  scopeBooks,
  type BookScopeKind,
  SegmentedControl,
  Switch,
} from "#app/ui/primitives";
import { createFindSource } from "#app/ui/search/findSource";
import { ShellGate } from "#app/ui/ShellGate";
import { metadataOf } from "#app/ui/workspace/project";
import * as Workflows from "#app/workflows/references";
import {
  refOccurrences,
  type BookText,
  type Excerpt,
  type Occurrence,
} from "#core/excerpts/excerpts";
import { bookHeading, type Analysis } from "#core/galley";
import type { Documents } from "#core/resources/kinds/handle";
import type { Resource } from "#core/resources/library";
import { expectIn, expectedPattern } from "#core/search/expect";
import { createFreshReadings, createReadings } from "#core/search/reading";
import * as Search from "#core/search/search";

type Scope = BookScopeKind | "reference" | "helps";

interface HelpHit {
  readonly title: string;
  readonly text: string;
  readonly hit: Search.DocumentHit;
}

interface Searchable {
  readonly resource: Resource;
  readonly documents: Documents;
}

const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const verseKeys = (address: Address): readonly string[] => {
  if (address.kind !== "verses") return [];
  const { book, from, to } = address;
  if (from.chapter !== to.chapter)
    return [`${book} ${from.chapter}:${from.verse}`, `${book} ${to.chapter}:${to.verse}`];
  const keys: string[] = [];
  for (let verse = from.verse; verse <= to.verse; verse += 1)
    keys.push(`${book} ${from.chapter}:${verse}`);
  return keys;
};

type Expected = "without" | "with" | "all";

interface FindSearch {
  readonly q?: string;
  readonly scope?: Scope;
  readonly expect?: string;
  readonly show?: Expected;
}

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

  // The signal's initial value from the URL, not a derivation of it.
  const [text, setText] = createSignal(untrack(asked), { name: "query" });
  const [regex, setRegex] = createSignal(false, { name: "regex" });
  const [markup, setMarkup] = createSignal(false, { name: "markup" });

  // ~0.6MB of mask maps for a whole Bible; readings rebuilt per search (~9ms).
  const readings = createReadings(shell.services.galley);
  const [matchCase, setMatchCase] = createSignal(false, { name: "matchCase" });
  const [wholeWord, setWholeWord] = createSignal(false, { name: "wholeWord" });

  const [hits, setHits] = createSignal<readonly Search.Hit[]>([], { name: "hits" });
  const [referenceHits, setReferenceHits] = createSignal<readonly Search.ReferenceHit[]>([], {
    name: "referenceHits",
  });
  const [helpHits, setHelpHits] = createSignal<readonly HelpHit[]>([], { name: "helpHits" });
  const [problem, setProblem] = createSignal("", { name: "problem" });
  const [cursor, setCursor] = createSignal(0, { name: "cursor" });
  const replaceKey = shellKeys(shell.services.settings).enableReplaceAll;
  const replaceEnabled = () => shell.services.settings.get(replaceKey);
  const [replacement, setReplacement] = createSignal("", { name: "replacement" });
  const [searched, setSearched] = createSignal("", { name: "searched" });
  const [preview, setPreview] = createSignal<
    | { readonly signature: string; readonly hits: readonly Search.Hit[]; readonly insert: string }
    | undefined
  >(undefined, { name: "replacePreview" });

  const [box, setBox] = createSignal<HTMLInputElement | undefined>(undefined, { name: "box" });

  const analyze = shell.services.galley.memoize();

  const referenceParses = new Map<string, Analysis>();
  const analysisOf = (id: string): Analysis | undefined => {
    const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(id));
    if (held !== undefined) return held.analysis;
    const text = shell.services.projectAnalysis.referenceText(id);
    if (text === undefined) return undefined;
    const parsed = referenceParses.get(id);
    if (parsed !== undefined && parsed.text === text) return parsed;
    const fresh = shell.services.galley.analyze(text, "find.reference");
    referenceParses.set(id, fresh);
    return fresh;
  };

  const occurrencesAt = (addresses: readonly Address[]): readonly Occurrence[] => {
    const books = readBooks(shell, new Set(addresses.map((address) => address.book)), analyze);
    return books.flatMap((book) => refOccurrences(book, addresses));
  };

  const referenceMatches = createMemo(
    (): readonly Occurrence[] => {
      const wanted = referenceHits();
      if (wanted.length === 0) return [];
      const addresses = wanted.flatMap((hit) => (hit.address === undefined ? [] : [hit.address]));
      if (addresses.length === 0) return [];

      return occurrencesAt(addresses);
    },
    { name: "referenceMatches" },
  );

  const helpMatches = createMemo(
    (): readonly Occurrence[] => {
      const addresses = helpHits().flatMap(({ hit }) => hit.addresses);
      if (addresses.length === 0) return [];
      return occurrencesAt(addresses);
    },
    { name: "helpMatches" },
  );

  const helpReadings = createMemo(
    (): ReadonlyMap<string, HelpHit> => {
      const out = new Map<string, HelpHit>();
      for (const held of helpHits())
        for (const address of held.hit.addresses)
          for (const key of verseKeys(address)) if (!out.has(key)) out.set(key, held);
      return out;
    },
    { name: "helpReadings" },
  );

  const helpPairedOf = (excerpt: Excerpt): Paired | undefined => {
    const readings = helpReadings();
    for (const key of verseKeys(excerpt.address)) {
      const held = readings.get(key);
      if (held !== undefined)
        return {
          kind: "static",
          name: held.title,
          text: held.text,
          spans: [{ from: held.hit.from, to: held.hit.to }],
        };
    }
    return undefined;
  };

  createEffect(
    () => box(),
    (input) => {
      if (input === undefined) return;
      input.focus();
      input.select();
    },
  );

  const [bound, setBound] = createSignal(Workflows.EMPTY, { name: "boundReferences" });
  const [rebound, setRebound] = createSignal(0, { name: "findRebound" });
  const source = createFindSource(() => setRebound((held) => held + 1));

  createEffect(
    () => ({ id: shell.project()?.root, tick: rebound() }),
    ({ id }) => {
      if (id === undefined) {
        setBound(Workflows.EMPTY);
        return;
      }
      void shell.services.run(Workflows.bindReferences(id)).then(setBound);
    },
  );

  const hasReference = (): boolean => bound().ids.length > 0;

  const [searchable, setSearchable] = createSignal<readonly Searchable[]>([], {
    name: "findSearchable",
  });
  createEffect(
    () => ({ root: shell.project()?.root, tick: rebound() }),
    ({ root }) => {
      if (root === undefined) {
        setSearchable([]);
        return;
      }
      void shell.services
        .run(shell.services.library.picked(root))
        .then(async (picks) => {
          const found: Searchable[] = [];
          const seen = new Set<string>();
          for (const { resource } of picks) {
            if (seen.has(resource.id)) continue;
            seen.add(resource.id);
            const exit = await shell.resources.open(resource);
            if (Exit.isSuccess(exit) && exit.value.handle.documents !== undefined)
              found.push({ resource, documents: exit.value.handle.documents });
          }
          return found;
        })
        .then(setSearchable);
    },
  );
  createEffect(
    () => searchable(),
    (now) => {
      if (now.length > 0 && untrack(scope) === "helps") void untrack(() => run());
    },
  );
  const helpsTitle = (): string =>
    searchable()
      .map((each) => each.resource.title)
      .join(", ");

  interface Over {
    readonly scope?: Scope;
    readonly text?: string;
  }

  const query = (over?: Over): Search.Query => ({
    text: over?.text ?? text(),
    caseSensitive: matchCase(),
    wholeWord: wholeWord(),
    regex: regex(),
  });

  const focusedBook = (): BookId | undefined => shell.focused()?.id;

  const [custom, setCustom] = createSignal<readonly BookId[]>([], { name: "findCustomBooks" });
  const projectBooks = (): readonly BookId[] => shell.project()?.books.map((book) => book.id) ?? [];
  const bookScope = (): BookScopeKind => {
    const held = scope();
    return held === "reference" || held === "helps" ? "project" : held;
  };

  const booksFor = (want: Scope): readonly BookId[] | undefined =>
    want === "reference" || want === "helps"
      ? undefined
      : scopeBooks(want, projectBooks(), focusedBook(), custom());
  const signature = (query: Search.Query, want: Scope): string =>
    JSON.stringify([
      want,
      booksFor(want),
      query.text,
      query.caseSensitive,
      query.wholeWord,
      query.regex,
      markup(),
    ]);

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

  const previewReplace = (): void => {
    if (!replaceEnabled() || scope() === "reference" || scope() === "helps" || hits().length === 0)
      return;
    const current = signature(query(), scope());
    if (current !== searched()) {
      setProblem(t("Run Find again before replacing."));
      return;
    }
    const project = shell.project();
    if (project === undefined) return;
    const selected = hits();
    for (const book of project.books) {
      const matches = selected.filter((hit) => hit.bookId === book.id);
      if (matches.length > 0 && Search.planReplace(book, matches, replacement()) === null) {
        setProblem(t("Results changed or cross markup. Run Find again before replacing."));
        return;
      }
    }
    setProblem("");
    setPreview({ signature: current, hits: selected, insert: replacement() });
  };

  const applyReplace = (): void => {
    const snapshot = preview();
    if (snapshot === undefined || !replaceEnabled()) return;
    setPreview(undefined);
    if (snapshot.signature !== searched() || snapshot.signature !== signature(query(), scope())) {
      setProblem(t("Search options changed. Preview replacements again."));
      return;
    }
    const project = shell.project();
    if (project === undefined) return;
    const batches = project.books.flatMap((book) => {
      const matches = snapshot.hits.filter((hit) => hit.bookId === book.id);
      return matches.length === 0 ? [] : [{ book, matches }];
    });
    if (
      batches.some(
        ({ book, matches }) => Search.planReplace(book, matches, snapshot.insert) === null,
      )
    ) {
      setProblem(t("Results changed or cross markup. Run Find again before replacing."));
      return;
    }
    let replaced = 0;
    const changed: BookId[] = [];
    for (const { book, matches } of batches) {
      const result = Search.replaceInBook(book, matches, snapshot.insert);
      if (Result.isFailure(result)) break;
      replaced += matches.length;
      changed.push(book.id);
    }
    if (changed.length > 0) shell.changed({ kind: "book.apply", books: changed });
    shell.report(
      t("Replaced {count} match(es) in {books} book(s).", {
        count: replaced,
        books: changed.length,
      }),
    );
    void run();
    if (replaced !== snapshot.hits.length)
      setProblem(t("Some replacements were refused. Review the changed books and run Find again."));
  };

  let lastAsked: { readonly q: string; readonly scope: string } | undefined;
  createEffect(
    () => ({
      q: asked(),
      scope: scope(),
      references: scope() === "reference" ? bound().ids.join("\n") : "",
    }),
    (now) => {
      if (lastAsked?.q !== now.q || lastAsked.scope !== now.scope) setText(now.q);
      lastAsked = { q: now.q, scope: now.scope };
      untrack(() => {
        void run({ scope: now.scope, text: now.q });
      });
    },
  );

  let toggled = false;
  createEffect(
    () => [matchCase(), wholeWord(), regex(), markup(), scope() === "custom" ? custom() : 0],
    () => {
      if (!toggled) {
        toggled = true;
        return;
      }
      untrack(commit);
    },
  );

  const commit = (): void => {
    if (asked() === text()) void run({ text: text() });
    else ask({ q: text() });
  };

  const expected = createMemo(() => params().expect ?? "", { name: "findExpect" });
  const expectation = createMemo(
    () => {
      if (scope() !== "reference") return undefined;
      const pattern = expectedPattern(expected());
      if (pattern === undefined) return undefined;
      const addresses = referenceHits().flatMap((hit) =>
        hit.address === undefined ? [] : [hit.address],
      );
      const books = readBooks(shell, new Set(addresses.map((address) => address.book)), analyze);
      const split = books.map((book) => expectIn(book, addresses, pattern));
      return {
        has: split.flatMap((book) => book.has),
        missing: split.flatMap((book) => book.missing),
      };
    },
    { name: "expectation" },
  );
  const showing = (): Expected => params().show ?? "without";
  const [expecting, setExpecting] = createSignal(false, { name: "findExpecting" });
  const expectShown = (): boolean => expecting() || params().expect !== undefined;
  const toggleExpect = (on: boolean): void => {
    setExpecting(on);
    if (!on) ask({ expect: undefined, show: undefined });
  };

  const feedHits = createMemo(
    (): readonly Occurrence[] => {
      if (scope() === "helps") return helpMatches();
      if (scope() !== "reference") return hits();
      const split = expectation();
      if (split === undefined) return referenceMatches();
      const shown = showing();
      if (shown === "with") return split.has;
      if (shown === "without") return split.missing;
      return [...split.missing, ...split.has];
    },
    { name: "feedHits" },
  );

  const feed = createExcerptFeed({
    hits: feedHits,
    name: "find",
    onEdited: () => {
      void run();
    },
    retake: (bookId) => retake(bookId),
  });

  const referenceReadings = createMemo(
    (): ReadonlyMap<string, Search.ReferenceHit> => {
      const out = new Map<string, Search.ReferenceHit>();
      for (const hit of referenceHits()) {
        if (hit.address === undefined) continue;
        for (const key of verseKeys(hit.address)) if (!out.has(key)) out.set(key, hit);
      }
      return out;
    },
    { name: "referenceReadings" },
  );

  const referenceBooks = new Map<string, BookText>();
  const referenceBook = (hit: Search.ReferenceHit): BookText | undefined => {
    const analysis = analysisOf(hit.source);
    const book = hit.address?.book;
    if (analysis === undefined || book === undefined) return undefined;
    const held = referenceBooks.get(hit.source);
    if (held !== undefined && held.analysis === analysis) return held;
    const heading = bookHeading(analysis);
    const made: BookText = {
      bookId: book,
      text: analysis.text,
      analysis,
      label: (address) => shell.location.label(address, heading),
    };
    referenceBooks.set(hit.source, made);
    return made;
  };

  const pairedOf = (excerpt: Excerpt): Paired | undefined => {
    const held = pairFor(excerpt);
    if (held === undefined) return undefined;
    const book = referenceBook(held);
    const name = fileName(held.source);
    if (book === undefined) return { kind: "static", name, text: held.preview, spans: [] };
    return {
      kind: "text",
      name,
      book,
      hits: [{ bookId: book.bookId, from: held.from, to: held.to }],
    };
  };

  const feedPairedOf = () => {
    if (scope() === "helps") return helpPairedOf;
    if (!source.shown()) return undefined;
    return scope() === "reference" ? pairedOf : source.pairedOf;
  };

  const scopeLabel = (): string => {
    if (scope() === "book") return t("this book");
    return scope() === "project" ? t("the project") : t("the chosen books");
  };

  const pairFor = (excerpt: Excerpt): Search.ReferenceHit | undefined => {
    const readings = referenceReadings();
    for (const key of verseKeys(excerpt.address)) {
      const held = readings.get(key);
      if (held !== undefined) return held;
    }
    return undefined;
  };

  const cursorSid = createMemo(
    () => {
      const hit = feedHits()[cursor()];
      if (hit === undefined) return undefined;
      for (const entry of feed.groups())
        for (const excerpt of entry.excerpts)
          if (excerpt.bookId === hit.bookId && excerpt.hits.some((held) => held.from === hit.from))
            return excerpt.sid;
      return undefined;
    },
    { name: "cursorSid" },
  );

  const mode = (): "regular" | "usfm" => (shell.mode() === "usfm" ? "usfm" : "regular");

  const cursorAt = (): number | undefined => feedHits()[cursor()]?.from;

  const step = (delta: 1 | -1): void => {
    const total = feedHits().length;
    if (total === 0) return;
    setCursor((held) => (held + delta + total) % total);
  };

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
            <div class="flex items-center gap-2" data-tour="find-search">
              <Input
                ref={setBox}
                type="search"
                icon={<SearchIcon />}
                wrapperClass="min-w-0 flex-1"
                placeholder={t("Find in project")}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
                }}
              />
              <div
                role="group"
                aria-label={t("Match options")}
                class="flex h-12 shrink-0 items-center gap-0.5 rounded-lg border border-surface-border bg-surface-secondary px-1.5"
              >
                <IconButton
                  size="sm"
                  label={t("Match case")}
                  icon={<CaseSensitiveIcon />}
                  aria-pressed={matchCase() ? "true" : "false"}
                  onClick={() => setMatchCase((held) => !held)}
                />
                <IconButton
                  size="sm"
                  label={t("Whole word")}
                  icon={<WholeWordIcon />}
                  aria-pressed={wholeWord() ? "true" : "false"}
                  onClick={() => setWholeWord((held) => !held)}
                />
                <IconButton
                  size="sm"
                  label={t("Regular expression")}
                  icon={<RegexIcon />}
                  aria-pressed={regex() ? "true" : "false"}
                  onClick={() => setRegex((held) => !held)}
                />
                <IconButton
                  size="sm"
                  label={t("Search the markup, not the reading")}
                  icon={<CodeIcon />}
                  aria-pressed={markup() ? "true" : "false"}
                  onClick={() => setMarkup((held) => !held)}
                />
              </div>
              <Button variant="primary" class="shrink-0" onClick={commit}>
                {t("Find")}
              </Button>
            </div>

            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <BookScope
                value={bookScope()}
                onChange={(next) => ask({ scope: next })}
                books={projectBooks().map((id) => ({
                  id,
                  name: bookName(id, metadataOf(shell.project())),
                }))}
                custom={custom()}
                onCustom={setCustom}
                hasFocused={focusedBook() !== undefined}
                disabled={scope() === "reference" || scope() === "helps"}
              />
              <div class="flex items-center gap-3" data-tour="find-reference">
                <source.Picker />
                <Switch
                  label={t("Search the source text")}
                  checked={scope() === "reference"}
                  disabled={!hasReference()}
                  onChange={(on) => ask({ scope: on ? "reference" : "project" })}
                />
                <Show when={scope() === "reference"}>
                  <span data-tour="find-expect-toggle">
                    <Switch label={t("Expect…")} checked={expectShown()} onChange={toggleExpect} />
                  </span>
                </Show>
                <Show when={searchable().length > 0}>
                  <span data-tour="find-helps">
                    <Switch
                      label={t("Search {title}", { title: helpsTitle() })}
                      checked={scope() === "helps"}
                      onChange={(on) => ask({ scope: on ? "helps" : "project" })}
                    />
                  </span>
                </Show>
              </div>
              <div class="ms-auto flex items-center gap-1">
                <Show when={scope() === "helps" && helpHits().length !== feedHits().length}>
                  <span class="text-smallest tabular-nums text-on-surface-tertiary">
                    {t("{count} in {title}", { count: helpHits().length, title: helpsTitle() })}
                  </span>
                </Show>
                <Show
                  when={scope() === "reference" && referenceHits().length !== feedHits().length}
                >
                  <span class="text-smallest tabular-nums text-on-surface-tertiary">
                    {t("{count} in the reference", { count: referenceHits().length })}
                  </span>
                </Show>
                <span
                  class="text-small tabular-nums text-on-surface-tertiary"
                  data-count={feedHits().length}
                >
                  {feedHits().length === 0
                    ? t("0 results")
                    : t("{at}/{total}", { at: cursor() + 1, total: feedHits().length })}
                </span>
                <IconButton
                  size="sm"
                  label={t("Previous match")}
                  icon={<ChevronUpIcon />}
                  disabled={feedHits().length === 0}
                  onClick={() => step(-1)}
                />
                <IconButton
                  size="sm"
                  label={t("Next match")}
                  icon={<ChevronDownIcon />}
                  disabled={feedHits().length === 0}
                  onClick={() => step(1)}
                />
              </div>
            </div>
          </div>
        </Card>

        <Show when={scope() === "reference" && expectShown()}>
          <Card data-tour="find-expect">
            <div class="flex flex-wrap items-center gap-3">
              <Input
                aria-label={t("Expected in your text")}
                wrapperClass="w-64"
                placeholder={t("Expected in your text, e.g. Yesu")}
                value={params().expect ?? ""}
                onChange={(event) => ask({ expect: event.currentTarget.value.trim() || undefined })}
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    ask({ expect: event.currentTarget.value.trim() || undefined });
                }}
              />
              <Show
                when={expectation()}
                fallback={
                  <span class="text-small text-on-surface-tertiary">
                    {t(
                      "Where the source matched, what should your text say? Sefer shows the verses that do not say it.",
                    )}
                  </span>
                }
              >
                {(split) => (
                  <div data-tour="find-expect-split">
                    <SegmentedControl<Expected>
                      label={t("Which verses to show")}
                      items={[
                        {
                          value: "without",
                          label: t("Without it ({count})", { count: split().missing.length }),
                        },
                        {
                          value: "with",
                          label: t("With it ({count})", { count: split().has.length }),
                        },
                        { value: "all", label: t("All") },
                      ]}
                      value={showing()}
                      onChange={(show) => ask({ show })}
                    />
                  </div>
                )}
              </Show>
            </div>
          </Card>
        </Show>

        <Show when={replaceEnabled() && scope() !== "reference" && scope() !== "helps"}>
          <Card>
            <div class="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t("Replace with")}
                placeholder={t("Replace with (literal text)")}
                value={replacement()}
                onInput={(event) => {
                  setReplacement(event.currentTarget.value);
                  setPreview(undefined);
                }}
              />
              <Button size="sm" disabled={hits().length === 0} onClick={previewReplace}>
                {t("Preview Replace all")}
              </Button>
            </div>
            <Show when={preview()} keyed>
              {(held) => (
                <div class="mt-3 space-y-2 text-small">
                  <p>
                    {t("Replace {count} match(es) in {books} book(s) within {scope}.", {
                      count: held.hits.length,
                      books: new Set(held.hits.map((hit) => hit.bookId)).size,
                      scope: scopeLabel(),
                    })}
                  </p>
                  <p class="text-on-surface-secondary">
                    {t("Replacement is literal text: {replacement}", {
                      replacement: held.insert === "" ? t("(delete matches)") : held.insert,
                    })}
                  </p>
                  <div class="flex gap-2">
                    <Button variant="primary" size="sm" onClick={applyReplace}>
                      {t("Apply Replace all")}
                    </Button>
                    <Button size="sm" onClick={() => setPreview(undefined)}>
                      {t("Cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </Show>
          </Card>
        </Show>

        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {problem()}
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
                feedHits().length === 0 && text() !== ""
                  ? t("No matches")
                  : t("Nothing searched yet")
              }
              description={
                scope() === "reference"
                  ? t("Searching {count} reference book(s); your own verse is the editable one.", {
                      count: bound().ids.length,
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
