import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result, Stream } from "effect";
import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronRightIcon from "lucide-solid/icons/chevron-right";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";
import { Show, createMemo, createSignal, untrack } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { ExcerptList, StetView } from "../app/ui/excerpts";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PanelHeader,
  SegmentedControl,
  Tooltip,
} from "../app/ui/primitives";
import { ShellGate } from "../app/ui/ShellGate";
import { SAMPLE_TERMS } from "../app/workflows/stet";
import type { BookId } from "../core/book/book";
import { group, type BookText } from "../core/excerpts/excerpts";
import { CorpusEngine, describesExactly } from "../core/galley";
import * as Search from "../core/search/search";

/**
 * Find, as a multibuffer.
 *
 * The screen is a find bar over a list of EXCERPTS, not a list of hits: hits
 * are grouped by the verse Onion's table of contents names, each excerpt is
 * read-only until the reader clicks Edit, and Edit opens a satellite over the
 * canonical Book rather than a copy of its text
 * (planning/03-ui/design-direction.md, "Find").
 *
 * What is still the core module's, unchanged:
 *
 *  - `findProjected` searches the ENGINE's verse-text projection — the
 *    reading, not the markup — and is the default, because a translator
 *    searching for a word does not mean the marker that happens to contain it.
 *    `find` is the raw scan, and the only door that takes a regex, so turning
 *    the regex toggle on switches doors.
 *  - `resolveHit` decides whether a hit can still be trusted, and `replace`
 *    goes through the book's one write path so the editing rules judge the
 *    replacement. A hit that crosses markup the projection dropped is not
 *    replaceable, and the button says why instead of failing.
 *  - "Replace all" is one `replaceInBook` per book: one change list, one
 *    receipt and one undo step each. There is no single corpus-wide rewrite
 *    here, and there is not meant to be (vision §12.2).
 *
 * `?q=` seeds the query and `?mode=stet` opens the key-terms feed over the
 * same list, which is what the workspace toolbar links to.
 */

type Mode = "find" | "stet";

interface FindSearch {
  readonly q?: string;
  readonly mode?: Mode;
}

function Find() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();
  // The URL seeds the screen once. A deliberate one-time read: after that the
  // signals below are the state, and a link that lands here again mounts a new
  // component.
  const seed = untrack(params);

  const [text, setText] = createSignal(seed.q ?? "", { name: "query" });
  const [insert, setInsert] = createSignal("", { name: "replaceWith" });
  const [regex, setRegex] = createSignal(false, { name: "regex" });
  const [matchCase, setMatchCase] = createSignal(false, { name: "matchCase" });
  const [wholeWord, setWholeWord] = createSignal(false, { name: "wholeWord" });
  const [scope, setScope] = createSignal<"book" | "project">("project", { name: "scope" });
  const [hits, setHits] = createSignal<readonly Search.Hit[]>([], { name: "hits" });
  const [problem, setProblem] = createSignal("", { name: "problem" });
  const [cursor, setCursor] = createSignal(0, { name: "cursor" });
  const [replacing, setReplacing] = createSignal(false, { name: "replaceOpen" });
  const [mode, setMode] = createSignal<Mode>(seed.mode ?? "find", { name: "findMode" });
  const [term, setTerm] = createSignal(SAMPLE_TERMS[0]?.id ?? "God", { name: "term" });

  // One memo for the whole screen, not one per excerpt: every book that holds
  // a hit is analysed through it, and a fresh memo per render would re-parse
  // the project on every keystroke.
  const analyze = shell.services.galley.memoize();

  /**
   * What the next search should look for.
   *
   * `over` is not a convenience. Solid 2 BATCHES writes: a handler that calls
   * `setMode("stet")` and then searches would read `mode()` back as the value
   * it had before the click, and the screen would search the previous term
   * with the previous toggles. So every handler that changes what to search
   * for hands the new value in rather than writing it and reading it back.
   */
  interface Over {
    readonly mode?: Mode;
    readonly term?: string;
    readonly scope?: "book" | "project";
  }

  const query = (over?: Over): Search.Query =>
    (over?.mode ?? mode()) === "stet"
      ? { text: over?.term ?? term(), wholeWord: true }
      : {
          text: text(),
          caseSensitive: matchCase(),
          wholeWord: wholeWord(),
          regex: regex(),
        };

  const focusedBook = (): BookId | undefined => shell.focused()?.id;

  /**
   * One search, through whichever door the toggles name.
   *
   * The engine path is asynchronous because the corpus is: on desktop the
   * projections live in the native process, which is exactly where the search
   * has to run. The corpus already holds every book of the open project —
   * `ProjectAnalysis.attach` registers them as it opens — so nothing here
   * registers anything.
   */
  const run = async (over?: Over): Promise<void> => {
    const project = shell.project();
    if (project === undefined) return;
    const books = project.books;
    const staticQuery = query(over);
    const only = (over?.scope ?? scope()) === "book" ? focusedBook() : undefined;
    const options = { limit: 500, ...(only === undefined ? {} : { books: [only] }) };
    if (staticQuery.text === "") {
      setHits([]);
      setProblem("");
      return;
    }
    const found =
      staticQuery.regex === true
        ? Search.find(books, staticQuery, options)
        : await shell.services.run(
            Effect.flatMap(CorpusEngine, (corpus) =>
              Effect.result(Search.findProjected(corpus, books, staticQuery, options)),
            ),
          );
    if (Result.isFailure(found)) {
      setProblem(found.failure.description);
      setHits([]);
      return;
    }
    setProblem("");
    setCursor(0);
    setHits(found.success);
  };

  // The component body runs once in Solid, so this IS the mount: a link that
  // arrived with a query, or in key-terms mode, searches without a second
  // click.
  if (seed.q !== undefined || seed.mode === "stet") void run();

  /**
   * The books the excerpt model needs: canonical text plus the parse that
   * describes it. ProjectAnalysis already holds one per book — the project was
   * analysed as it opened — and it is used when it still fits the text;
   * otherwise the screen's own memo answers.
   */
  const model = createMemo(
    () => {
      // Read the tick so an accepted edit rebuilds the excerpts.
      shell.tick();
      const project = shell.project();
      if (project === undefined) return { groups: [], outline: [] };
      const wanted = new Set(hits().map((hit) => hit.bookId));
      const books: BookText[] = [];
      for (const book of project.books) {
        if (!wanted.has(book.id)) continue;
        const source = book.source();
        const held = Option.getOrUndefined(shell.services.projectAnalysis.analysis(book.id));
        const analysis =
          held !== undefined && describesExactly(held.analysis, source.text)
            ? held.analysis
            : analyze(source.text);
        books.push({ bookId: book.id, text: source.text, analysis });
      }
      return group(books, hits());
    },
    { name: "excerptModel" },
  );

  /** The excerpt the match cursor sits in, as a sid. */
  const cursorSid = createMemo(
    () => {
      const hit = hits()[cursor()];
      if (hit === undefined) return undefined;
      for (const entry of model().groups)
        for (const excerpt of entry.excerpts)
          if (excerpt.bookId === hit.bookId && excerpt.hits.some((held) => held.from === hit.from))
            return excerpt.sid;
      return undefined;
    },
    { name: "cursorSid" },
  );

  const step = (delta: 1 | -1): void => {
    const total = hits().length;
    if (total === 0) return;
    setCursor((held) => (held + delta + total) % total);
  };

  const seat = async (bookId: BookId) => {
    const project = shell.project();
    if (project === undefined) return undefined;
    const opened = await shell.services.run(Effect.result(project.instantiate(bookId)));
    if (Result.isFailure(opened)) {
      shell.report(t("could not open book {book}", { book: bookId }));
      return undefined;
    }
    return shell.services.seated(bookId);
  };

  const openInEditor = (bookId: BookId, from: number): void => {
    const project = shell.project();
    if (project === undefined) return;
    shell.aim(bookId, from);
    void navigate({
      to: "/project/$id/book/$book",
      params: { id: encodeURIComponent(project.root), book: bookId },
    });
  };

  /**
   * An accepted edit, and the search re-run over what the text now says.
   *
   * The wait is not a fudge. `findProjected` searches the CORPUS, and a book's
   * corpus registration is refreshed one scheduler pass after its text moved
   * (`ProjectAnalysis.supply`) — so searching the instant an edit lands would
   * answer from the text before it, and the result count would be a revision
   * behind. The next republish is the honest cue; the timeout is there because
   * an edit that was REFUSED republishes nothing at all.
   */
  const edited = (): void => {
    shell.bump();
    void shell.services
      .run(
        Stream.runHead(shell.services.projectAnalysis.watch()).pipe(
          Effect.timeout(500),
          Effect.ignore,
        ),
      )
      .then(() => run());
  };

  /** The hit the cursor is on, replaced through the book's one write path. */
  const replaceOne = (): void => {
    const project = shell.project();
    const hit = hits()[cursor()];
    if (project === undefined || hit === undefined) return;
    const result = Search.replace(hit, insert(), project.books);
    shell.report(
      Result.isSuccess(result)
        ? t("replaced 1 match in {book}", { book: hit.bookId })
        : t("refused by {rule}", { rule: result.failure.rule }),
    );
    edited();
  };

  /**
   * Every hit, book by book: one `replaceInBook` per book, which is one change
   * list, one receipt and one undo step for that book. Split hits are refused
   * by `planReplace`, so a book that holds one is skipped whole and said so.
   */
  const replaceAll = (): void => {
    const project = shell.project();
    if (project === undefined) return;
    let changed = 0;
    let refused = 0;
    for (const book of project.books) {
      const mine = hits().filter((hit) => hit.bookId === book.id && !Search.spansMarkup(hit));
      if (mine.length === 0) continue;
      const result = Search.replaceInBook(book, mine, insert());
      if (Result.isSuccess(result)) changed += mine.length;
      else refused += mine.length;
    }
    shell.report(
      refused === 0
        ? t("replaced {count} matches", { count: changed })
        : t("replaced {count} matches, refused {refused}", { count: changed, refused }),
    );
    edited();
  };

  const splitHits = createMemo(() => hits().filter(Search.spansMarkup).length, {
    name: "splitHits",
  });

  const list = () => (
    <ExcerptList
      groups={model().groups}
      outline={model().outline}
      onOpen={openInEditor}
      seat={seat}
      analyze={analyze}
      onEdited={edited}
      focus={cursorSid()}
      empty={
        <EmptyState
          icon={<SearchIcon size={22} />}
          title={hits().length === 0 && text() !== "" ? t("No matches") : t("Nothing searched yet")}
          description={t("Results are grouped by verse, one card each, read-only until you edit.")}
        />
      }
    />
  );

  return (
    <main class="flex h-screen min-w-0 flex-col gap-4 p-6">
      <PanelHeader
        title={t("Find")}
        actions={
          <SegmentedControl
            label={t("Feed")}
            size="sm"
            value={mode()}
            onChange={(next) => {
              const chosen = next === "stet" ? "stet" : "find";
              setMode(chosen);
              void run({ mode: chosen });
            }}
            items={[
              { value: "find", label: t("Find") },
              { value: "stet", label: t("Key terms") },
            ]}
          />
        }
      />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
        <Show when={mode() === "find"}>
          <Card class="space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                icon={<SearchIcon size={14} />}
                wrapperClass="w-72"
                placeholder={t("Find in project")}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void run();
                }}
              />
              <div class="flex items-center gap-0.5">
                <IconButton
                  size="sm"
                  label={t("Match case")}
                  icon={<CaseSensitiveIcon size={15} />}
                  aria-pressed={matchCase() ? "true" : "false"}
                  onClick={() => setMatchCase((held) => !held)}
                />
                <IconButton
                  size="sm"
                  label={t("Whole word")}
                  icon={<WholeWordIcon size={15} />}
                  aria-pressed={wholeWord() ? "true" : "false"}
                  onClick={() => setWholeWord((held) => !held)}
                />
                <IconButton
                  size="sm"
                  label={t("Regular expression (searches the markup too)")}
                  icon={<RegexIcon size={15} />}
                  aria-pressed={regex() ? "true" : "false"}
                  onClick={() => setRegex((held) => !held)}
                />
              </div>

              <SegmentedControl
                label={t("Scope")}
                size="sm"
                value={scope()}
                onChange={(next) => {
                  const chosen = next === "book" ? "book" : "project";
                  setScope(chosen);
                  void run({ scope: chosen });
                }}
                items={[
                  { value: "book", label: t("This book"), disabled: focusedBook() === undefined },
                  { value: "project", label: t("Whole project") },
                ]}
              />

              <Button variant="primary" size="sm" onClick={() => void run()}>
                {t("Find")}
              </Button>

              <div class="ms-auto flex items-center gap-1">
                <span
                  class="text-small tabular-nums text-on-surface-tertiary"
                  data-count={hits().length}
                >
                  {hits().length === 0
                    ? t("0 results")
                    : t("{at}/{total}", { at: cursor() + 1, total: hits().length })}
                </span>
                <IconButton
                  size="sm"
                  label={t("Previous match")}
                  icon={<ChevronUpIcon size={15} />}
                  disabled={hits().length === 0}
                  onClick={() => step(-1)}
                />
                <IconButton
                  size="sm"
                  label={t("Next match")}
                  icon={<ChevronDownIcon size={15} />}
                  disabled={hits().length === 0}
                  onClick={() => step(1)}
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                class="flex cursor-pointer items-center gap-1 text-small text-on-surface-secondary"
                aria-expanded={replacing() ? "true" : "false"}
                onClick={() => setReplacing((held) => !held)}
              >
                <Show when={replacing()} fallback={<ChevronRightIcon size={14} />}>
                  <ChevronDownIcon size={14} />
                </Show>
                {t("Replace")}
              </button>
              <Show when={replacing()}>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    wrapperClass="w-72"
                    aria-label={t("Replace with")}
                    placeholder={t("Replace with")}
                    value={insert()}
                    onInput={(event) => setInsert(event.currentTarget.value)}
                  />
                  <Button size="sm" disabled={hits().length === 0} onClick={replaceOne}>
                    {t("Replace")}
                  </Button>
                  <Button size="sm" disabled={hits().length === 0} onClick={replaceAll}>
                    {t("Replace all")}
                  </Button>
                  <Show when={splitHits() > 0}>
                    <Tooltip
                      label={t(
                        "A match that crosses markup the projection dropped has no single range to replace — whether that markup survives is the editor's call.",
                      )}
                    >
                      <span
                        class="rounded-sm bg-surface-warning px-2 py-1 text-smallest text-on-surface-warning"
                        data-spans-markup={splitHits()}
                      >
                        {t("{count} not replaceable", { count: splitHits() })}
                      </span>
                    </Tooltip>
                  </Show>
                </div>
              </Show>
            </div>
          </Card>
        </Show>

        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

        <Show when={mode() === "stet"} fallback={list()}>
          <StetView
            terms={SAMPLE_TERMS}
            selected={term()}
            onSelect={(id) => {
              setTerm(id);
              void run({ term: id });
            }}
            standIn
            groups={model().groups}
            outline={model().outline}
            onOpen={openInEditor}
            seat={seat}
            analyze={analyze}
            onEdited={edited}
          />
        </Show>
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/find")({
  validateSearch: (search: Record<string, unknown>): FindSearch => ({
    ...(typeof search["q"] === "string" && search["q"] !== "" ? { q: search["q"] } : {}),
    ...(search["mode"] === "stet" ? { mode: "stet" as const } : {}),
  }),
  head: () => ({ meta: [{ title: "Sefer — find" }] }),
  component: () => <ShellGate>{() => <Find />}</ShellGate>,
});
