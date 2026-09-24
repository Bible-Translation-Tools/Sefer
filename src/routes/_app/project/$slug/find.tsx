import type { JSX } from "@solidjs/web";
import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { Result } from "effect";
import CaseSensitiveIcon from "lucide-solid/icons/case-sensitive";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import CodeIcon from "lucide-solid/icons/code";
import RegexIcon from "lucide-solid/icons/regex";
import SearchIcon from "lucide-solid/icons/search";
import WholeWordIcon from "lucide-solid/icons/whole-word";
import { Show, createEffect, createMemo, createSignal, untrack } from "solid-js";

import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { shellKeys } from "#app/settings";
import { createExcerptFeed, ExcerptList, readBooks } from "#app/ui/excerpts";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Input,
  PanelHeader,
  SegmentedControl,
} from "#app/ui/primitives";
import { ShellGate } from "#app/ui/ShellGate";
import * as Workflows from "#app/workflows/references";
import type { BookId } from "#core/book/book";
import { refOccurrences, type Excerpt, type Occurrence } from "#core/excerpts/excerpts";
import { createReadings } from "#core/search/reading";
import * as Search from "#core/search/search";

/**
 * Find, as a multibuffer.
 *
 * The screen is a find bar over a list of EXCERPTS, not a list of hits: hits
 * are grouped by the verse Galley's table of contents names, each excerpt is
 * read-only until the reader clicks Edit, and Edit opens a satellite over the
 * canonical Book rather than a copy of its text
 * (`documentation/architecture/design-direction.md`, "Find").
 *
 * **Find only.** Key terms is its own pane at `/terms`, because the two are
 * different jobs that happen to share a list
 * (`documentation/architecture/stet.md`). The redirect below keeps
 * `/find?mode=stet` landing somewhere sensible. Everything the two panes DO
 * share is `createExcerptFeed`.
 *
 * What is the core module's (`documentation/architecture/search.md`):
 *
 *  - `findInReading` searches the READING — the markup cut out, rebuilt here
 *    from the engine's mask map — and is the default, because a translator
 *    searching for a word does not mean the marker that happens to contain it.
 *    `find` is the raw scan of the USFM, for a search aimed AT the markup.
 *    Either takes a literal or a regex, so the matcher and the haystack are
 *    two switches and all four combinations work.
 *  - Every hit carries the stamp it was found at, and `planReplace` refuses a
 *    hit whose book has moved past it instead of editing the wrong range.
 *  - Replace all is an optional advanced action (`find.enableReplaceAll`). It
 *    previews the current search, then applies one validated edit per book
 *    through the same Book edit phases as a satellite edit.
 *
 * **The URL is the state**, not a seed for it: `q` and `scope` are read from
 * the search params on every render, and the controls that change them
 * navigate. The workspace toolbar's search box links here, and this screen is
 * often already mounted when it does — a one-time read of the params would
 * leave the view unchanged. What stays local is what is not yet a search: the text
 * being typed, the three matching toggles, and the match cursor.
 */

/**
 * Where to look. The first two are this project's own books; `reference` is
 * the Library's `source` and `reference` bindings, registered with their text
 * so the engine can search them (`src/app/workflows/references.ts`).
 *
 * A reference search still shows YOUR text. The match is found in somebody
 * else's book and the verse is the join: the card is this project's verse at
 * that reference, editable as always, with the reference's own reading above it
 * — the pair STET renders for a source verse. The reference side is never
 * editable, because there is no Book behind it and nothing to write to.
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
    void navigate({
      to: "/project/$slug/find",
      params: { slug: shell.slug() },
      search: { ...params(), ...next },
      replace: true,
    });
  };

  // The box starts on whatever the URL asked for; the effect below keeps it
  // there. Untracked because this is the initial value of a signal, not a
  // derivation of the params — Solid 2 is right to ask which one it is.
  const [text, setText] = createSignal(untrack(asked), { name: "query" });
  const [regex, setRegex] = createSignal(false, { name: "regex" });
  /**
   * Search the markup itself, rather than the reading.
   *
   * Its own switch, not a side effect of the regex toggle: turning regex on
   * changes how the search matches, never WHAT is searched. "Find every `\f`"
   * and "find `Jesus (said|answered)` in the reading" are the two cells a
   * single toggle could not reach.
   */
  const [markup, setMarkup] = createSignal(false, { name: "markup" });

  /**
   * The mask maps, held for as long as this screen is.
   *
   * ~0.6MB for a whole Bible, keyed by each book's stamp, re-cut only when a
   * book has actually changed. The READINGS are not kept — they are rebuilt per
   * search (~9ms for a corpus) and dropped, which is the trade
   * `src/core/search/reading.ts` sets out. Dying with the screen is the point:
   * nothing holds a second copy of the project while you are editing.
   */
  const readings = createReadings(shell.services.galley);
  const [matchCase, setMatchCase] = createSignal(false, { name: "matchCase" });
  const [wholeWord, setWholeWord] = createSignal(false, { name: "wholeWord" });

  const [hits, setHits] = createSignal<readonly Search.Hit[]>([], { name: "hits" });
  const [referenceHits, setReferenceHits] = createSignal<readonly Search.ReferenceHit[]>([], {
    name: "referenceHits",
  });
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

  /**
   * A parse of one book's text, memoized — the same door `/terms` uses.
   *
   * `refOccurrences` needs the verse table, and the verse table comes from an
   * analysis. The project's held analysis answers whenever it still describes
   * the text; otherwise this parses, and the memo keeps a re-search over
   * unchanged text from re-parsing the corpus.
   */
  const analyze = shell.services.galley.memoize();

  /**
   * The reference scope's hits, resolved against THIS project's books.
   *
   * A reference hit names a verse in somebody else's book. What the reader
   * wants to see is their own verse — that is the whole point of searching a
   * source — so the verse is the join: `refOccurrences` finds where each one
   * sits in this project's text, and the result is an ordinary occurrence the
   * multibuffer already knows how to render and edit.
   *
   * A reference verse this project does not have (a book it is not translating
   * yet, a verse the versification puts elsewhere) simply yields nothing here.
   * That is a real gap and the count above the list still reports the reference
   * hits, so "412 results" over 200 cards is visible rather than silent.
   */
  const referenceMatches = createMemo(
    (): readonly Occurrence[] => {
      const wanted = referenceHits();
      if (wanted.length === 0) return [];
      const refs = wanted.flatMap((hit) => (hit.ref === undefined ? [] : [hit.ref]));
      if (refs.length === 0) return [];

      const books = readBooks(shell, new Set(refs.map((ref) => ref.book)), analyze);
      return books.flatMap((book) => refOccurrences(book, refs));
    },
    { name: "referenceMatches" },
  );

  /**
   * The search box takes the caret when Find opens.
   *
   * Arriving at Find is asking to search; a screen that makes you click its one
   * input first has wasted the trip. The HTML `autofocus` attribute does not do
   * this — it applies when the browser PARSES an element, and this one is
   * created by Solid long after the page loaded — which is the same trap
   * `CommandPalette` documents.
   *
   * Keyed on the ELEMENT, so it runs once when the field is mounted and not
   * again on every later search. `select` as well as `focus` because arriving
   * with a query already in the box (a link into `/find?q=…`, or coming back to
   * the screen) usually means typing a different one, and a caret parked at the
   * end would make that a backspace exercise.
   */
  createEffect(
    () => box(),
    (input) => {
      if (input === undefined) return;
      input.focus();
      input.select();
    },
  );

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
    // `project.id`, not `root`: the id is the key `Library.bind` writes under,
    // and for a project that declares an identifier the two are different
    // strings (`core/project/project.ts`). Keyed by root, this resolved nothing
    // and the references scope was quietly unavailable.
    () => shell.project()?.id,
    (id) => {
      if (id === undefined) {
        setBound(Workflows.EMPTY);
        return;
      }
      void shell.services.run(Workflows.bindReferences(id)).then(setBound);
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
  const signature = (q: Search.Query, want: Scope): string =>
    JSON.stringify([want, focusedBook(), q.text, q.caseSensitive, q.wholeWord, q.regex, markup()]);

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
    setPreview(undefined);
    setSearched("");
    const project = shell.project();
    if (project === undefined) return;
    const books = project.books;
    const staticQuery = query(over);
    const want = over?.scope ?? scope();
    const only = want === "book" ? focusedBook() : undefined;
    // No limit. Every hit, and the count beside the box is therefore the
    // answer rather than a ceiling — see `Search.MINIMUM_QUERY` for the
    // measurements that say a project-wide find can afford it.
    const options = only === undefined ? {} : { books: [only] };
    if (staticQuery.text === "") {
      setHits([]);
      setReferenceHits([]);
      setProblem("");
      return;
    }
    // One character over 66 books is a quarter of a million hits and nothing a
    // person can read. Said out loud rather than answered with "0 results",
    // which would read as "this word is not in your project".
    if (staticQuery.text.length < Search.MINIMUM_QUERY) {
      setHits([]);
      setReferenceHits([]);
      setProblem(
        t("Type at least {count} characters to search the whole project.", {
          count: Search.MINIMUM_QUERY,
        }),
      );
      return;
    }

    // A search is one user-visible answer, including the scan and its result.
    // Keep the query itself out of telemetry: it can contain manuscript text.
    const search = shell.services.composition.observability.operation("find.run", {
      "find.scope": want,
      "find.books": only === undefined ? books.length : 1,
      "find.regex": staticQuery.regex === true,
      "find.case": staticQuery.caseSensitive === true,
      "find.whole_word": staticQuery.wholeWord === true,
      "find.markup": markup(),
      // The query's LENGTH is a fact about the search; its text is not ours.
      "find.chars": staticQuery.text.length,
    });

    // The reference scope is the same scan over somebody else's book, and a
    // different result shape — read-only hits, no stamp, nothing to edit — so
    // it is answered here rather than folded into the path below. Synchronous
    // like the rest since it stopped going through the engine.
    if (want === "reference") {
      const analysis = shell.services.projectAnalysis;
      const references = analysis.references().flatMap((id) => {
        const text = analysis.referenceText(id);
        // A reference registered without its text retains no reading to cut.
        return text === undefined ? [] : [{ id, text }];
      });
      const stop = search.span("find.scan");
      const found = Search.findInReferences(readings, references, staticQuery, options);
      stop();
      setHits([]);
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

    // TWO switches, not one. `markup` picks the haystack — the canonical USFM
    // or the reading with the markup cut out — and `regex` picks the matcher.
    const stop = search.span("find.scan");
    const found = markup()
      ? Search.find(books, staticQuery, options)
      : Search.findInReading(readings, books, staticQuery, options);
    stop();
    setReferenceHits([]);
    if (Result.isFailure(found)) {
      setProblem(found.failure.description);
      setHits([]);
      search.end("refused", { "find.reason": found.failure.reason });
      return;
    }
    setProblem("");
    setCursor(0);
    setHits(found.success);
    setSearched(signature(staticQuery, want));
    search.end("ready", {
      "find.hits": found.success.length,
      "find.hit_books": new Set(found.success.map((hit) => hit.bookId)).size,
    });
  };

  const previewReplace = (): void => {
    if (!replaceEnabled() || scope() === "reference" || hits().length === 0) return;
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
    // Preflight every book before writing any of them. Book.apply can still
    // refuse a later book; the report below gives the actual partial count.
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
   * What the multibuffer is fed, whichever scope answered.
   *
   * The reference scope searches somebody else's book and shows YOURS: its
   * matches arrive as verses, `referenceMatches` resolves those verses against
   * this project's own text, and from there down the screen is the same one —
   * same cards, same grouping, same editing. The reference's own reading rides
   * along as the card's pair, which is what STET does with a source verse.
   */
  const feedHits = createMemo(
    (): readonly Occurrence[] => (scope() === "reference" ? referenceMatches() : hits()),
    { name: "feedHits" },
  );

  const feed = createExcerptFeed({
    hits: feedHits,
    name: "find",
    // An accepted edit, and the search re-run over what the text now says. The
    // feed does the waiting — a book's corpus registration is a scheduler pass
    // behind its text — and calls this when the project has republished.
    onEdited: () => {
      void run();
    },
  });

  /**
   * The reference's own reading for one excerpt, by verse.
   *
   * INTERIM, and the honest limit of this screen today: the pair shows the
   * engine's preview — the projected text around the match, ellipsed — and not
   * the reference's whole verse. The whole verse needs the reference's own
   * excerpts built from its text, which is a second feed; the preview is what
   * the search already returned and it reads as the verse it came from.
   *
   * Keyed by `BOOK chapter:verse` rather than by sid because the two sides need
   * not agree on bridges: a reference may write `\v 4` where this project has
   * `\v 4-5`, and the excerpt would then be `PHM 1:4-5` against a hit on
   * `PHM 1:4`. `pairFor` walks the excerpt's own range instead of matching the
   * string.
   */
  const referenceReadings = createMemo(
    (): ReadonlyMap<string, Search.ReferenceHit> => {
      const out = new Map<string, Search.ReferenceHit>();
      for (const hit of referenceHits()) {
        if (hit.ref?.verse === undefined) continue;
        const key = `${hit.ref.book} ${hit.ref.chapter}:${hit.ref.verse}`;
        // First hit in a verse wins: the card shows one reading, and a verse
        // matched twice is still one verse.
        if (!out.has(key)) out.set(key, hit);
      }
      return out;
    },
    { name: "referenceReadings" },
  );

  /**
   * The reference's reading, above this project's verse.
   *
   * Read-only and visibly so: no Edit, no staleness badge, no open-in-editor.
   * There is no Book behind it and nothing here could write to it.
   */
  const renderReference = (excerpt: Excerpt): JSX.Element => {
    const held = pairFor(excerpt);
    if (held === undefined) return null;
    return (
      <div class="mb-2 border-s-2 border-surface-border ps-3" data-reference-hit={held.source}>
        <p class="truncate text-smallest text-on-surface-tertiary">{fileName(held.source)}</p>
        <p class="text-small break-words text-on-surface-secondary">{held.preview}</p>
      </div>
    );
  };

  const pairFor = (excerpt: Excerpt): Search.ReferenceHit | undefined => {
    const readings = referenceReadings();
    const match = /^(\S+) (\d+):(\d+)(?:-(\d+))?$/.exec(excerpt.sid);
    if (match === null) return undefined;
    // SAFETY: groups 1..3 are required by the pattern that just matched.
    const [book, chapter, first, last] = [match[1]!, match[2]!, Number(match[3]!), match[4]];
    const end = last === undefined ? first : Number(last);
    for (let verse = first; verse <= end; verse += 1) {
      const held = readings.get(`${book} ${chapter}:${verse}`);
      if (held !== undefined) return held;
    }
    return undefined;
  };

  /** The excerpt the match cursor sits in, as a sid. */
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
  const cursorAt = (): number | undefined => feedHits()[cursor()]?.from;

  const step = (delta: 1 | -1): void => {
    const total = feedHits().length;
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
              ref={setBox}
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
                label={t("Regular expression")}
                icon={<RegexIcon size={15} />}
                aria-pressed={regex() ? "true" : "false"}
                onClick={() => setRegex((held) => !held)}
              />
              <IconButton
                size="sm"
                label={t("Search the markup, not the reading")}
                icon={<CodeIcon size={15} />}
                aria-pressed={markup() ? "true" : "false"}
                onClick={() => setMarkup((held) => !held)}
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
              {/* The gap is stated, never swallowed. A reference search counts
                  hits in SOMEBODY ELSE'S book; the cards count verses this
                  project has. A reference book this project has not translated
                  yet makes those two numbers differ, and saying only the second
                  would quietly lose the difference. */}
              <Show when={scope() === "reference" && referenceHits().length !== feedHits().length}>
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
                icon={<ChevronUpIcon size={15} />}
                disabled={feedHits().length === 0}
                onClick={() => step(-1)}
              />
              <IconButton
                size="sm"
                label={t("Next match")}
                icon={<ChevronDownIcon size={15} />}
                disabled={feedHits().length === 0}
                onClick={() => step(1)}
              />
            </div>
          </div>
        </Card>

        <Show when={replaceEnabled() && scope() !== "reference"}>
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
                      scope: scope() === "book" ? t("this book") : t("the project"),
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

        {/* ONE list, both scopes. The reference scope used to render a card
            list of its own beside this one — a preview per hit, no verse, no
            editing, nothing the rest of the app looks like. It now feeds the
            same multibuffer, with the reference's reading as each card's pair,
            which is the shape STET uses for a source verse. The editable side
            is always this project's own text. */}
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
          renderPair={scope() === "reference" ? renderReference : undefined}
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
  beforeLoad: ({ location, params }) => {
    if (new URLSearchParams(location.searchStr).get("mode") === "stet")
      throw redirect({ to: "/project/$slug/terms", params: { slug: params.slug }, search: {} });
  },
  head: () => ({ meta: [{ title: "Sefer — find" }] }),
  component: () => <ShellGate>{() => <Find />}</ShellGate>,
});
