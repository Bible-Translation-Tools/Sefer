import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result, Stream } from "effect";
import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

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
 *  - `resolveHit` decides whether a hit can still be trusted, so a card that
 *    named a revision the book has moved past refuses instead of editing the
 *    wrong range.
 *  - Replace is **deliberately not surfaced yet**: `src/core/search` keeps
 *    `replace`, `replaceInBook` and `planReplace`, and this screen offers
 *    none of them — an edit happens through a card's Edit button, in the
 *    satellite, where the editing phases judge it like any other keystroke.
 *
 * **The URL is the state**, not a seed for it: `mode`, `q` and `scope` are
 * read from the search params on every render, and the controls that change
 * them navigate. The rail's Key terms tile and the workspace toolbar's search
 * box both link here, and this screen is already mounted when they do — a
 * one-time read of the params would have left the tile lit and the view
 * unchanged. What stays local is what is not yet a search: the text being
 * typed, the three matching toggles, and the match cursor.
 */

type Mode = "find" | "stet";

type Scope = "book" | "project";

interface FindSearch {
  readonly q?: string;
  readonly mode?: Mode;
  readonly scope?: Scope;
}

function Find() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();

  /** The three the URL owns. Read, never held. */
  const mode = (): Mode => params().mode ?? "find";
  const scope = (): Scope => params().scope ?? "project";
  const asked = (): string => params().q ?? "";

  /** One navigation, merged over what the URL already says. */
  const ask = (next: FindSearch): void => {
    void navigate({ to: "/find", search: { ...params(), ...next }, replace: true });
  };

  // The box starts on whatever the URL asked for; the effect below keeps it
  // there. Untracked because this is the initial value of a signal, not a
  // derivation of the params — Solid 2 is right to ask which one it is.
  const [text, setText] = createSignal(untrack(asked), { name: "query" });
  const [regex, setRegex] = createSignal(false, { name: "regex" });
  const [matchCase, setMatchCase] = createSignal(false, { name: "matchCase" });
  const [wholeWord, setWholeWord] = createSignal(false, { name: "wholeWord" });

  const [hits, setHits] = createSignal<readonly Search.Hit[]>([], { name: "hits" });
  const [problem, setProblem] = createSignal("", { name: "problem" });
  const [cursor, setCursor] = createSignal(0, { name: "cursor" });
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
    readonly scope?: Scope;
    readonly text?: string;
  }

  const query = (over?: Over): Search.Query =>
    (over?.mode ?? mode()) === "stet"
      ? { text: over?.term ?? term(), wholeWord: true }
      : {
          text: over?.text ?? text(),
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

  /**
   * The URL, searched.
   *
   * This is the mount AND every later arrival: a link into `/find` while the
   * screen is already open changes the params and nothing else, so the search
   * has to hang off them rather than off the component body. The values are
   * handed to `run` rather than read back from it for the reason `Over`
   * exists — Solid batches, and the signals are not written yet.
   *
   * `untrack` around the call says what the search is: a one-time read of the
   * toggles as they stand. Tracking them here would re-run the search when
   * "match case" was pressed, which is a change to what the NEXT search means,
   * not an instruction to run one.
   */
  createEffect(
    () => ({ q: asked(), mode: mode(), scope: scope() }),
    (now) => {
      setText(now.q);
      untrack(() => {
        void run({ mode: now.mode, scope: now.scope, text: now.q });
      });
    },
  );

  /**
   * The Find button and the Enter key. A query the URL already names is simply
   * re-run: navigating to the same search changes nothing, and the reader who
   * pressed Find again would get no answer at all.
   */
  const commit = (): void => {
    if (asked() === text()) void run({ text: text() });
    else ask({ q: text() });
  };

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
            onChange={(next) => ask({ mode: next === "stet" ? "stet" : "find" })}
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
          <Card>
            <div class="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                icon={<SearchIcon size={14} />}
                wrapperClass="w-72"
                placeholder={t("Find in project")}
                value={text()}
                onInput={(event) => setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit();
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
                onChange={(next) => ask({ scope: next === "book" ? "book" : "project" })}
                items={[
                  { value: "book", label: t("This book"), disabled: focusedBook() === undefined },
                  { value: "project", label: t("Whole project") },
                ]}
              />

              <Button variant="primary" size="sm" onClick={commit}>
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
    ...(search["scope"] === "book" ? { scope: "book" as const } : {}),
  }),
  head: () => ({ meta: [{ title: "Sefer — find" }] }),
  component: () => <ShellGate>{() => <Find />}</ShellGate>,
});
