import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";
import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import { t } from "../app/i18n";
import { useShell } from "../app/ProjectContext";
import { createExcerptFeed, ExcerptList } from "../app/ui/excerpts";
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
import * as Workflows from "../app/workflows/references";
import type { BookId } from "../core/book/book";
import { Galley } from "../core/galley";
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
 * **Find only.** Key terms used to be a `mode` on this screen and is now its
 * own pane at `/terms`, because the two are different jobs that happen to
 * share a list — Will's decision on the gap list, item 5. The only trace left
 * is the redirect below, so `/find?mode=stet` still lands somewhere sensible.
 * Everything the two panes DO share is `createExcerptFeed`.
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
 * **The URL is the state**, not a seed for it: `q` and `scope` are read from
 * the search params on every render, and the controls that change them
 * navigate. The workspace toolbar's search box links here, and this screen is
 * already mounted when it does — a one-time read of the params would have left
 * the view unchanged. What stays local is what is not yet a search: the text
 * being typed, the three matching toggles, and the match cursor.
 */

/**
 * Where to look. The first two are this project's own books; `reference` is
 * the Library's `source` and `reference` bindings, registered with their text
 * so the engine can search them (`src/app/workflows/references.ts`).
 *
 * A reference hit is NOT an excerpt and is not offered as one: there is no
 * Book behind it, nothing to seat, and nothing to edit. It renders as a
 * reading — the resource it came from and the text around the match — because
 * that is honestly all it is.
 */
type Scope = "book" | "project" | "reference";

/**
 * The last path segment of a registered reference id.
 *
 * The id is the resource file's whole path, which is right for the engine and
 * unreadable on a card. The file name is what a translator recognises —
 * `58-PHM.usfm` — and the full path is on the element for anyone debugging.
 */
const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

interface FindSearch {
  readonly q?: string;
  readonly scope?: Scope;
}

function Find() {
  const shell = useShell();
  const navigate = useNavigate();
  const params = Route.useSearch();

  /** The two the URL owns. Read, never held. */
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
  const [referenceHits, setReferenceHits] = createSignal<readonly Search.ReferenceHit[]>([], {
    name: "referenceHits",
  });
  const [problem, setProblem] = createSignal("", { name: "problem" });
  const [cursor, setCursor] = createSignal(0, { name: "cursor" });

  /**
   * The project's bound references, registered with the corpus.
   *
   * Resolved once when the screen mounts and whenever the project changes,
   * rather than before each search: registration is idempotent per id and
   * unchanged text costs a checksum, but reading every reference book off disk
   * is not something to do on each Enter. It is also what decides whether the
   * Reference segment is offered at all — a scope with nothing in it is worse
   * than no scope, because it answers "no matches" to a question it never
   * asked.
   */
  const [bound, setBound] = createSignal(Workflows.EMPTY, { name: "boundReferences" });

  createEffect(
    () => shell.project()?.root,
    (root) => {
      if (root === undefined) {
        setBound(Workflows.EMPTY);
        return;
      }
      void shell.services.run(Workflows.bindReferences(root)).then(setBound);
    },
  );

  const hasReference = (): boolean => bound().ids.length > 0;

  /**
   * What the next search should look for.
   *
   * `over` is not a convenience. Solid 2 BATCHES writes: a handler that wrote
   * a signal and then searched would read that signal back as the value it had
   * before the click, and the screen would search the previous text with the
   * previous toggles. So every handler that changes what to search for hands
   * the new value in rather than writing it and reading it back.
   */
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

  /**
   * One search, through whichever door the toggles name.
   *
   * The engine path stays an Effect because a search can fail and this screen
   * reports why, not because it suspends — the engine is in this process and
   * the call is synchronous. The corpus already holds every book of the open
   * project (`ProjectAnalysis.attach` registers them as it opens), so nothing
   * here registers anything.
   */
  const run = async (over?: Over): Promise<void> => {
    const project = shell.project();
    if (project === undefined) return;
    const books = project.books;
    const staticQuery = query(over);
    const want = over?.scope ?? scope();
    const only = want === "book" ? focusedBook() : undefined;
    const options = { limit: 500, ...(only === undefined ? {} : { books: [only] }) };
    if (staticQuery.text === "") {
      setHits([]);
      setReferenceHits([]);
      setProblem("");
      return;
    }

    // The reference scope is a different door and a different result shape —
    // read-only hits in books this project does not own — so it is answered
    // here rather than folded into the excerpt path below.
    if (want === "reference") {
      const found = await shell.services.run(
        Effect.flatMap(Galley, (galley) =>
          Effect.result(Search.findInReferences(galley, staticQuery, options)),
        ),
      );
      setHits([]);
      if (Result.isFailure(found)) {
        setProblem(found.failure.description);
        setReferenceHits([]);
        return;
      }
      setProblem("");
      setReferenceHits(found.success);
      return;
    }

    const found =
      staticQuery.regex === true
        ? Search.find(books, staticQuery, options)
        : await shell.services.run(
            Effect.flatMap(Galley, (galley) =>
              Effect.result(Search.findProjected(galley, books, staticQuery, options)),
            ),
          );
    setReferenceHits([]);
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
    () => ({ q: asked(), scope: scope() }),
    (now) => {
      setText(now.q);
      untrack(() => {
        void run({ scope: now.scope, text: now.q });
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
   * An accepted edit, and the search re-run over what the text now says. The
   * feed does the waiting — a book's corpus registration is a scheduler pass
   * behind its text — and calls this when the project has republished.
   */
  const feed = createExcerptFeed({
    hits,
    name: "find",
    onEdited: () => {
      void run();
    },
  });

  /** The excerpt the match cursor sits in, as a sid. */
  const cursorSid = createMemo(
    () => {
      const hit = hits()[cursor()];
      if (hit === undefined) return undefined;
      for (const entry of feed.groups())
        for (const excerpt of entry.excerpts)
          if (excerpt.bookId === hit.bookId && excerpt.hits.some((held) => held.from === hit.from))
            return excerpt.sid;
      return undefined;
    },
    { name: "cursorSid" },
  );

  /**
   * The shell's mode, as the card's two-way choice.
   *
   * Every projection but `usfm` is a variation on the reading, so anything
   * that is not `usfm` is `regular` here — the same reduction `BookEditor`
   * makes for CodeMirror's mode facet, and for the same reason: the card has
   * two surfaces, not one per named projection.
   */
  const mode = (): "regular" | "usfm" => (shell.mode() === "usfm" ? "usfm" : "regular");

  /** The match the cursor is on, as its source offset — the card's `active`. */
  const cursorAt = (): number | undefined => hits()[cursor()]?.from;

  const step = (delta: 1 | -1): void => {
    const total = hits().length;
    if (total === 0) return;
    setCursor((held) => (held + delta + total) % total);
  };

  return (
    <main class="flex h-screen min-w-0 flex-col gap-4 p-6">
      <PanelHeader title={t("Find")} />

      <Show
        when={shell.project()}
        fallback={<p class="text-small text-on-surface-tertiary">{t("Open a project first.")}</p>}
      >
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
              onChange={(next) =>
                ask({
                  scope: next === "book" ? "book" : next === "reference" ? "reference" : "project",
                })
              }
              items={[
                { value: "book", label: t("This book"), disabled: focusedBook() === undefined },
                { value: "project", label: t("Whole project") },
                {
                  value: "reference",
                  label: t("Reference"),
                  disabled: !hasReference(),
                  title: hasReference()
                    ? t("{count} reference book(s) bound to this project", {
                        count: bound().ids.length,
                      })
                    : t("Bind a source or reference resource to this project to search it."),
                },
              ]}
            />

            <Button variant="primary" size="sm" onClick={commit}>
              {t("Find")}
            </Button>

            <div class="ms-auto flex items-center gap-1">
              <span
                class="text-small tabular-nums text-on-surface-tertiary"
                data-count={scope() === "reference" ? referenceHits().length : hits().length}
              >
                {scope() === "reference"
                  ? t("{count} result(s)", { count: referenceHits().length })
                  : hits().length === 0
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

        <Show when={problem() !== ""}>
          <p class="rounded-md bg-surface-error px-4 py-3 text-small text-on-surface-error">
            {problem()}
          </p>
        </Show>

        {/* The reference scope's own results: a reading, not a multibuffer.
            No Edit, no Open in editor, no staleness badge — none of those mean
            anything for a book this project does not own. */}
        <Show when={scope() === "reference"}>
          <div class="min-h-0 flex-1 overflow-auto" data-find-references>
            <Show
              when={referenceHits().length > 0}
              fallback={
                <EmptyState
                  icon={<SearchIcon size={22} />}
                  title={text() === "" ? t("Nothing searched yet") : t("No matches")}
                  description={t("Searching {count} reference book(s), read-only.", {
                    count: bound().ids.length,
                  })}
                />
              }
            >
              <ul class="flex flex-col gap-2">
                <For each={referenceHits()}>
                  {(hit) => (
                    <li>
                      <Card class="flex flex-col gap-1" data-reference-hit={hit.source}>
                        <p class="truncate text-smallest text-on-surface-tertiary">
                          {fileName(hit.source)}
                        </p>
                        <p class="text-small break-words text-on-surface-primary">{hit.preview}</p>
                      </Card>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        </Show>

        <Show when={scope() !== "reference"}>
          <ExcerptList
            groups={feed.groups()}
            outline={feed.outline()}
            onOpen={feed.openInEditor}
            seat={feed.seat}
            analyze={feed.analyze}
            onEdited={feed.edited}
            onExpand={feed.expand}
            focus={cursorSid()}
            activeHit={cursorAt()}
            mode={mode()}
            empty={
              <EmptyState
                icon={<SearchIcon size={22} />}
                title={
                  hits().length === 0 && text() !== "" ? t("No matches") : t("Nothing searched yet")
                }
                description={t(
                  "Results are grouped by verse, one card each, read-only until you edit.",
                )}
              />
            }
          />
        </Show>
      </Show>
    </main>
  );
}

export const Route = createFileRoute("/find")({
  validateSearch: (search: Record<string, unknown>): FindSearch => ({
    ...(typeof search["q"] === "string" && search["q"] !== "" ? { q: search["q"] } : {}),
    ...(search["scope"] === "book" || search["scope"] === "reference"
      ? { scope: search["scope"] }
      : {}),
  }),
  /**
   * `/find?mode=stet` is a link to a screen this route no longer has. It is
   * answered rather than dropped: `validateSearch` has already discarded the
   * `mode` key, so the raw search string is what says where the reader meant
   * to go.
   */
  beforeLoad: ({ location }) => {
    if (new URLSearchParams(location.searchStr).get("mode") === "stet")
      throw redirect({ to: "/terms", search: {} });
  },
  head: () => ({ meta: [{ title: "Sefer — find" }] }),
  component: () => <ShellGate>{() => <Find />}</ShellGate>,
});
