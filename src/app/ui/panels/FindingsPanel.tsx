/**
 * The findings panel: every finding in the project, in one shape, through the
 * reader's filter — as the SAME multibuffer Find shows.
 *
 * It is the component the reader already knows from searching. Identical
 * cards, identical chrome, the same expand-up/expand-down context arrows, the
 * same outline column, the same sticky headers, the same Edit-as-satellite. The purpose is that someone
 * scanning a place — a Sous finding about a comma, say — sees everything that
 * might be wrong there, in the verse it is wrong in, with the workflow they
 * already have. So this file draws no list of its own: `findingsFeed.ts` turns
 * findings into occurrences and hands them to `createExcerptFeed`, exactly as
 * `/find` hands it search hits, and what is left here is the toolbar, the
 * header of each card, and the two things that can be done about a finding.
 *
 * What did NOT change is everything the page is answerable for.
 *
 * `findings.list` does the ordering, `findings/filter` does the subtraction,
 * and the filter is subtractive and never authoritative: the header always
 * says "N of TOTAL shown", so a filtered panel can never read as a clean
 * project, and the census, the inline marks and the corpus
 * counts are untouched by anything on this screen.
 *
 * A card's reference is still DERIVED or not shown — an excerpt exists only
 * because a parse of the text the finding was measured in placed it, so
 * "Philemon 1:4" on a card is a fact and not a guess.
 *
 * A fix preview is still computed on DEMAND — a page of four hundred findings
 * pays for none of them until someone asks — `fixes.preview` refuses one
 * computed from text the book has since moved past, and `fixes.apply` goes
 * through `book.apply`, the one write path, so a fix from this page is the
 * same event a fix from the editor is.
 *
 * A run of identical findings inside one verse still folds to one line with
 * "× N", which expands on click. It is purely presentational: every count on
 * the page is over findings, never over lines.
 *
 * The keyboard cursor is LOCAL to this route, and deliberately so. The shell
 * has its own findings cursor over the unfiltered list (`editor.findings.next`
 * in the palette walks the whole project, which is what that command means);
 * a cursor here that honoured the filter but shared that state would make the
 * palette command jump according to a filter it never mentioned. It walks
 * CARDS now rather than rows, and the card it is on wears the ring Find puts
 * on the card holding the current match.
 */

import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import CircleCheck from "lucide-solid/icons/circle-check";
import Wrench from "lucide-solid/icons/wrench";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { BookId } from "#core/book/book";
import type { Excerpt } from "#core/excerpts/excerpts";
import * as Filter from "#core/findings/filter";
import type { Finding } from "#core/findings/finding";
import * as Findings from "#core/findings/findings";
import * as Fixes from "#core/fixes/fixes";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { ExcerptList, type ExcerptDecor } from "../excerpts";
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  PanelHeader,
  SegmentedControl,
  severityTone,
} from "../primitives";
import {
  createFindingsFeed,
  foldRuns,
  inMarkup,
  markupSlice,
  type FindingRun,
  type FindingsRow,
} from "./findingsFeed";
import { createFindingsFilter, VIEWS, type FindingsView } from "./findingsFilter";
import { FindingsFilters } from "./FindingsFilters";

/** One finding's line in a card header, before it has been measured. */
const LINE_HEIGHT = 30;

export function FindingsPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const filters = createFindingsFilter(shell.services);
  const [preview, setPreview] = createSignal<Fixes.FixPreview | undefined>(undefined, {
    name: "fixPreview",
  });
  const [note, setNote] = createSignal("");
  const [cursor, setCursor] = createSignal(0, { name: "findingsCursor" });
  /**
   * Has the reader moved the cursor yet?
   *
   * Until they have, there IS no current card: the ring and the scroll belong
   * to a gesture somebody made, and a page that scrolled itself to its first
   * card on arrival would take the top of the list away from the reader before
   * they had read it. Find behaves the same — its ring appears when the match
   * arrows are used.
   */
  const [walking, setWalking] = createSignal(false, { name: "findingsWalking" });
  /** The folded runs the reader has opened, by line id. Session state. */
  const [opened, setOpened] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "findingsOpened",
  });
  /** The markup slices the reader has pinned open — hover shows them anyway. */
  const [pinned, setPinned] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "findingsSlices",
  });

  /**
   * `?code=` and `?pattern=`, from the inventory's "the other sites of this
   * pattern" link. They were already being sent and were silently dropped —
   * a route that does not validate a search param does not receive it — and
   * `/findings` validates them now.
   */
  // SAFETY: `strict: false` gives the union of every route's search; both
  // fields are read as `unknown` and each is narrowed before it is used.
  const search = useSearch({ strict: false }) as () => {
    readonly code?: unknown;
    readonly pattern?: unknown;
  };

  /** The pattern the link named, when it named one this list could be about. */
  const pattern = (): number | undefined => {
    const held = search().pattern;
    return typeof held === "number" && Number.isInteger(held) && held >= 0 ? held : undefined;
  };

  /**
   * Seeds the code filter from the URL, once per distinct code.
   *
   * A seed and not a lock: the chips are still the reader's, and "All codes"
   * clears it. In an effect rather than at construction because the filter is
   * restored from Settings first, and a write on the same tick as that read
   * would be lost.
   */
  createEffect(
    () => search().code,
    (code) => {
      if (typeof code !== "string" || code === "") return;
      // `untrack`: `update` reads the current filter to merge the patch onto
      // it, and a read inside an effect callback is the one Solid warns about
      // — it would not track, and here it must not.
      untrack(() => {
        filters.update({ codes: [code] });
      });
    },
  );

  /**
   * The findings this panel is about, in whatever order the shell published
   * them.
   *
   * UNSORTED on purpose. Sorting is for the list, and the list is the half
   * that waits a frame; the header needs counts, and counts do not care about
   * order. When no pattern narrows it this is the store's own array, so the
   * ordinary case allocates nothing at all.
   */
  const pool = createMemo(
    (): readonly Finding[] => {
      if (shell.project() === undefined) return [];
      const listed = shell.findings();
      const only = pattern();
      // A pattern is not one of `FindingsFilter`'s fields and should not become
      // one: it is an address another screen hands over for one visit, not a
      // preference anybody sets. So it narrows the list this panel calls "all",
      // which keeps the header's "N of TOTAL shown" honest about the question
      // that was actually asked.
      return only === undefined ? listed : listed.filter((finding) => finding.pattern === only);
    },
    { name: "findingsPool" },
  );

  /**
   * Every book's current revision, as ONE plain object.
   *
   * Staleness is a revision comparison, and the revisions live in the shell's
   * `books` store — so asking per finding meant twenty thousand store-proxy
   * reads per pass, from inside a `<For>` where Solid cannot track them
   * (STRICT_READ_UNTRACKED, and it was right to complain). Read once here, in
   * a tracking scope, keyed by book: sixty-six reads when a book's text moves,
   * and a plain lookup per finding.
   */
  const revisions = createMemo(
    (): Readonly<Record<BookId, number>> => {
      const out: Record<BookId, number> = {};
      for (const book of shell.project()?.books ?? []) {
        const stamp = shell.stampOf(book.id);
        if (stamp !== undefined) out[book.id] = stamp.revision;
      }
      return out;
    },
    { name: "bookRevisions" },
  );

  /** Has the book moved on since the publication that measured this finding? */
  const isStale = (finding: Finding): boolean => {
    const revision = revisions()[finding.bookId];
    return revision === undefined || revision !== finding.stamp.revision;
  };

  /**
   * Everything the HEADER needs, in one walk and no sort.
   *
   * The counts and the filter chips as `list` (a sort), then `facets`, then
   * `applyFilter` would be three more walks of twenty thousand findings, all
   * of it before the panel could paint, because the header says "N of TOTAL
   * shown". Measured on a 66-book project that was about a third of the first
   * task, and none of it needs the findings in order.
   *
   * Facets are counted over the UNFILTERED pool: a chip's own count must not
   * move as you click it.
   */
  const summary = createMemo(() => Filter.summarise(pool(), filters.filter(), isStale), {
    name: "findingsSummary",
  });

  /**
   * The body's list: sorted, then filtered.
   *
   * Read by the feed and by nothing the header draws, so the sort happens in
   * the task that builds the list rather than the one that paints the panel.
   */
  const shown = createMemo(
    (): readonly Finding[] =>
      Filter.applyFilter(Findings.list({ findings: pool }), filters.filter(), isStale),
    { name: "findingsShown" },
  );

  /** Every book in the project, so a clean book still offers its chip. */
  const books = (): readonly BookId[] => shell.project()?.books.map((book) => book.id) ?? [];

  const feed = createFindingsFeed({ findings: shown, view: filters.view });

  /**
   * The list waits for the shell to be on screen.
   *
   * Opening this panel was ONE synchronous task of ~114ms — the route
   * transition, the feed's model over twenty thousand findings, the virtual
   * list and its first layout, all before the browser painted anything. The
   * click read as a freeze. Traced and profiled, that task had no hot spot to
   * remove: the top sixteen costs were a long tail, none above 14%, so making
   * any of it faster was never going to reach a hundred milliseconds.
   *
   * What reaches it is doing less BEFORE the paint. The header, the counts and
   * the filters are cheap and they are what says the click landed; the list is
   * the expensive half and nobody can read it in the first frame anyway. Solid
   * makes the split almost free: memos are pull-based, so while this is false
   * `feed`'s model is never read and therefore never computed.
   *
   * `requestAnimationFrame` runs BEFORE the paint, so the timeout it schedules
   * is what runs after the frame is committed. That ordering is the whole
   * mechanism — a bare rAF would build the list in the very frame it is meant
   * to come after.
   */
  const [body, setBody] = createSignal(false, { name: "findingsBody" });
  let after: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    after = setTimeout(() => setBody(true), 0);
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    if (after !== undefined) clearTimeout(after);
  });

  const at = (index: number): FindingsRow | undefined => feed.rows()[index];

  /** Wraps, like the palette's own finding commands, over the cards on screen. */
  const step = (delta: 1 | -1): void => {
    // A snapshot on purpose: the wrap is over the list as it is when the key
    // was pressed.
    const staticCount = feed.rows().length;
    if (staticCount === 0) return;
    setWalking(true);
    setCursor((held) => (held + delta + staticCount) % staticCount);
  };

  /** One id in or out of a set. Both sets below are session state. */
  const flip = (held: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(held);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  const toggleRun = (id: string): void => {
    setOpened((held) => flip(held, id));
  };

  const toggleSlice = (id: string): void => {
    setPinned((held) => flip(held, id));
  };

  const analysisFor = (finding: Finding) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(finding.bookId));

  /**
   * Go: the main editor, aimed at this finding's own span.
   *
   * Through the feed, so it is the same navigation a card's "Open in editor"
   * makes and the same span is measured — `openInEditor` leaves the aim before
   * it navigates, because the book route reads it to decide the opening clip.
   */
  const go = (finding: Finding, via: "go" | "key" = "go"): void => {
    navigateTo(finding.bookId, finding.from, finding.to, finding, via);
  };

  /**
   * Every jump from this panel to the editor, as one `findings.navigate`.
   *
   * It says what KIND of finding was followed — code, severity, producer, never
   * its message, which quotes the document — and whether the target still
   * resolves: the book is in the project and has not moved since the
   * publication that measured the finding. A stale jump still lands; it lands
   * where the finding WAS, and that is the thing worth being able to count.
   */
  const navigateTo = (
    bookId: BookId,
    from: number,
    to: number | undefined,
    finding: Finding | undefined,
    via: "go" | "key" | "card",
  ): void => {
    const inProject = shell.project()?.books.some((book) => book.id === bookId) === true;
    const stale = finding === undefined ? undefined : isStale(finding);
    const operation = shell.services.composition.observability.operation("findings.navigate", {
      "book.id": bookId,
      "findings.via": via,
      ...(finding === undefined
        ? {}
        : {
            "finding.code": finding.code,
            "finding.severity": finding.severity,
            "finding.producer": finding.producer,
          }),
    });
    feed.excerpts.openInEditor(bookId, from, to, operation);
    operation.end("passed", {
      "findings.resolved": inProject && stale !== true,
      "findings.in_project": inProject,
      ...(stale === undefined ? {} : { "findings.stale": stale }),
    });
  };

  /** A card's own "Open in editor", which names a span rather than a finding. */
  const openCard = (bookId: BookId, from: number, to?: number): void => {
    const finding = shown().find(
      (held) =>
        held.bookId === bookId && held.from === from && (to === undefined || held.to === to),
    );
    navigateTo(bookId, from, to, finding, "card");
  };

  const offer = (finding: Finding): void => {
    const book = shell.services.seated(finding.bookId);
    const analysis = analysisFor(finding);
    if (book === undefined || analysis === undefined) {
      setPreview(undefined);
      setNote(
        t("Open {book} first — a fix is applied to the book, not to the list.", {
          book: finding.bookId,
        }),
      );
      return;
    }
    const previewed = Fixes.preview(finding, book, analysis.analysis);
    if (Result.isFailure(previewed)) {
      setPreview(undefined);
      setNote(t("no fix: {reason}", { reason: previewed.failure.reason }));
      return;
    }
    setNote("");
    setPreview(previewed.success);
  };

  const apply = (fix: Fixes.FixPreview): void => {
    const book = shell.services.seated(fix.finding.bookId);
    if (book === undefined) return;
    const applied = Fixes.applyFix(fix, book);
    setNote(
      Result.isSuccess(applied)
        ? t("applied {label}", { label: fix.label })
        : t("refused by {rule}", { rule: applied.failure.rule }),
    );
    setPreview(undefined);
    shell.changed({ kind: "book.apply", books: [fix.finding.bookId] });
  };

  /**
   * `j`/`k` and the arrows move, Enter opens.
   *
   * Listened for on the document because the page has no single focusable
   * body, and guarded on the target: the text filter and every other field is
   * a place where `j` means `j`, and so is an open satellite. Modified chords
   * are left to `src/app/commands.ts`, which owns the `Mod-` keymap.
   */
  {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if (event.key === "j" || event.key === "ArrowDown") step(1);
      else if (event.key === "k" || event.key === "ArrowUp") step(-1);
      else if (event.key === "Enter") {
        // Enter before any movement takes the cursor rather than the reader:
        // opening a book nobody pointed at is not what that key means here.
        if (!walking()) setWalking(true);
        else {
          const finding = at(cursor())?.findings[0];
          if (finding !== undefined) go(finding, "key");
        }
      } else return;
      event.preventDefault();
    };
    // Components run once in Solid, so the body is the mount: no `onMount`
    // wrapper, and `onCleanup` takes the listener off with the route.
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
    });
  }

  /** The card the cursor is on, and the finding inside it that it names. */
  const focused = (): string | undefined => (walking() ? at(cursor())?.key : undefined);
  const focusedAt = (): number | undefined =>
    walking() ? at(cursor())?.findings[0]?.from : undefined;

  /**
   * One finding, as a line in a card's header.
   *
   * `run` is present when this line stands for a fold; its members are drawn
   * below it once the reader opens it. Everything on the line is the run's
   * first member, which is what "identical" means here.
   */
  const line = (row: FindingsRow, finding: Finding, run?: FindingRun) => {
    const id = `${row.key}|${finding.id}`;
    const folded = (run?.members.length ?? 1) > 1;
    const markup = inMarkup(row.excerpt, finding);
    return (
      <li
        class="group/finding flex flex-col gap-0.5"
        data-finding={finding.id}
        data-code={finding.code}
        data-severity={finding.severity}
        data-markup={markup ? "true" : undefined}
      >
        <div class="flex flex-wrap items-center gap-2">
          <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
          <code class="font-mono text-smallest text-on-surface-tertiary">{finding.code}</code>
          <span class="min-w-0 flex-1 text-small text-on-surface-secondary">{finding.message}</span>
          <Show when={markup}>
            {/* The span has no character in the reading — it is inside a
                marker name, an attribute, a control character. The card keeps
                showing the verse, says so here, and offers the raw slice
                rather than quietly marking a different character. */}
            <button
              type="button"
              data-markup-toggle
              aria-expanded={pinned().has(id) ? "true" : "false"}
              class="cursor-pointer"
              onClick={() => toggleSlice(id)}
            >
              <Badge tone="muted">{t("in markup")}</Badge>
            </button>
          </Show>
          <Show when={isStale(finding)}>
            <Badge tone="muted">{t("stale")}</Badge>
          </Show>
          <Show when={folded}>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={opened().has(id) ? "true" : "false"}
              aria-label={
                opened().has(id)
                  ? t("Fold {count} identical findings", { count: run?.members.length ?? 0 })
                  : t("Unfold {count} identical findings", { count: run?.members.length ?? 0 })
              }
              class="tabular-nums"
              icon={opened().has(id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              onClick={() => toggleRun(id)}
            >
              × {run?.members.length ?? 1}
            </Button>
          </Show>
          <Button size="sm" variant="tertiary" onClick={() => go(finding)}>
            {t("Go")}
          </Button>
          <Show when={finding.fix !== undefined}>
            <Button size="sm" icon={<Wrench size={12} />} onClick={() => offer(finding)}>
              {t("Fix")}
            </Button>
          </Show>
        </div>

        <Show when={markup}>
          {/* Hover shows it; a click pins it open. The same rule the inventory
              follows: raw USFM is never the card's BODY, only the answer to
              "what is there, then". */}
          <p
            data-markup-slice
            class={cx(
              "px-0.5 font-mono text-smallest break-all text-on-surface-tertiary",
              pinned().has(id) ? "block" : "hidden group-hover/finding:block",
            )}
          >
            <span class="opacity-70">{markupSlice(row.excerpt, finding).before}</span>
            <mark class="rounded-xs bg-surface-warning px-px font-semibold text-on-surface-warning">
              {markupSlice(row.excerpt, finding).hit}
            </mark>
            <span class="opacity-70">{markupSlice(row.excerpt, finding).after}</span>
          </p>
        </Show>

        <Show when={folded && opened().has(id)}>
          <ul class="ms-4 flex flex-col gap-0.5 border-s border-surface-border ps-2">
            <For each={run?.members.slice(1) ?? []}>{(member) => line(row, member)}</For>
          </ul>
        </Show>
      </li>
    );
  };

  /** The findings this card is answering for, folded. */
  const notes = (_excerpt: Excerpt, key: string) => {
    const row = feed.row(key);
    if (row === undefined) return undefined;
    return (
      <ul class="flex flex-col gap-1" data-findings-in={row.findings.length}>
        <For each={foldRuns(row.findings)}>{(run) => line(row, run.head, run)}</For>
      </ul>
    );
  };

  const decor: ExcerptDecor = {
    rowKey: (group, excerpt) => `${group.bookId}|${excerpt.sid}`,
    outlineTitle: t("Groups with findings"),
    outlineLabel: (row) => {
      const head = feed.head(row.bookId);
      if (head === undefined) return row.bookId;
      return head.front ? t("{book} front", { book: head.label }) : head.label;
    },
    header: (group) => {
      const head = feed.head(group.bookId);
      return (
        <>
          <Show
            when={filters.view() === "severity"}
            fallback={
              <strong
                class={cx(
                  "text-small font-semibold text-on-surface-primary",
                  filters.view() === "code" && "font-mono",
                )}
              >
                {head?.label ?? group.bookId}
              </strong>
            }
          >
            <Badge tone={severityTone(head?.label ?? "")}>{head?.label}</Badge>
          </Show>
          <Show when={head?.detail}>
            {(detail) => <span class="text-small text-on-surface-secondary">{detail()}</span>}
          </Show>
          <span class="ms-auto text-smallest text-on-surface-tertiary">
            {t("{count} findings", { count: head?.count ?? group.count })}
          </span>
        </>
      );
    },
    // Chapter 0 is the matter before the first `\c` — an id line, a heading, a
    // table of contents entry — and `core/excerpts` labels it "Genesis 0",
    // which is a chapter nobody has.
    label: (_excerpt, key) => {
      const row = feed.row(key);
      return row?.front === true ? t("{book} · front matter", { book: row.bookName }) : undefined;
    },
    markTone: (source, excerpt) => feed.toneOf(source, excerpt),
    extraHeight: (_excerpt, key) => {
      const row = feed.row(key);
      return row === undefined ? 0 : 8 + LINE_HEIGHT * foldRuns(row.findings).length;
    },
    notes,
  };

  /**
   * The shell's mode, as the card's two-way choice — the same reduction Find
   * makes. In USFM mode a card shows the raw slice with the span marked, which
   * is the one place raw USFM is the body rather than the footnote.
   */
  const mode = (): "regular" | "usfm" => (shell.mode() === "usfm" ? "usfm" : "regular");

  return (
    <main class="flex h-screen min-w-0 flex-col gap-4 p-6" data-findings-panel>
      <PanelHeader
        title={t("Findings")}
        subtitle={t(
          "j / k or the arrows move between cards; Enter opens one in the editor. Filters hide cards; they never delete findings.",
        )}
        actions={
          <>
            <span class="text-small text-on-surface-tertiary" data-findings-count={summary().shown}>
              {t("{shown} of {total} shown", { shown: summary().shown, total: summary().total })}
            </span>
            <SegmentedControl<FindingsView>
              label={t("Group findings by")}
              size="sm"
              items={VIEWS.map((view) => ({ value: view.value, label: t(view.label) }))}
              value={filters.view()}
              onChange={(view) => filters.setView(view)}
            />
          </>
        }
      />

      {/* One toolbar row, not a column: the filters are four questions asked
          rarely, and on a project of sixty-six books the book chips alone used
          to push the findings below the fold. */}
      <Card class="space-y-2">
        <FindingsFilters state={filters} facets={summary().facets} books={books()} />
        <Show when={pattern() !== undefined}>
          <p class="flex flex-wrap items-center gap-2 text-smallest text-on-surface-tertiary">
            <Badge tone="brand">{t("one pattern")}</Badge>
            {t("Showing only the sites of the pattern /inventory sent over.")}
            <Button
              size="sm"
              variant="tertiary"
              onClick={() =>
                void navigate({
                  to: "/project/$slug/findings",
                  params: { slug: shell.slug() },
                  search: {},
                })
              }
            >
              {t("Show every finding")}
            </Button>
          </p>
        </Show>
      </Card>

      <Show when={note() !== ""}>
        <Card class="text-small text-on-surface-secondary">{note()}</Card>
      </Show>

      <Show when={preview()}>
        {(fix) => (
          <Card class="space-y-2.5 border-brand/40">
            <div class="flex flex-wrap items-center gap-2">
              <Wrench size={14} class="text-brand" aria-hidden="true" />
              <strong class="text-small font-semibold">{fix().label}</strong>
              <Button variant="primary" size="sm" class="ms-auto" onClick={() => apply(fix())}>
                {t("Apply")}
              </Button>
              <Button size="sm" onClick={() => setPreview(undefined)}>
                {t("Dismiss")}
              </Button>
            </div>
            <ul class="flex flex-col gap-1">
              <For each={fix().changes}>
                {(change) => (
                  <li class="flex gap-3 rounded-sm bg-surface-secondary px-2 py-1 font-mono text-smallest">
                    <code class="text-on-surface-tertiary">
                      {change.from}–{change.to}
                    </code>
                    <code class="min-w-0 break-all">
                      {change.insert === "" ? t("(delete)") : change.insert}
                    </code>
                  </li>
                )}
              </For>
            </ul>
          </Card>
        )}
      </Show>

      <div
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        data-findings={summary().shown}
        data-view={filters.view()}
      >
        <Show
          when={summary().shown > 0}
          fallback={
            <Show
              when={summary().total > 0}
              fallback={
                <EmptyState
                  icon={<CircleCheck size={22} />}
                  title={t("Nothing to report — or no project is open.")}
                />
              }
            >
              <EmptyState
                title={t("{total} findings, all hidden by the filter.", {
                  total: summary().total,
                })}
              />
            </Show>
          }
        >
          <Show when={body()} fallback={<div class="min-h-0 flex-1" aria-busy="true" />}>
            <ExcerptList
              groups={feed.groups()}
              outline={feed.outline()}
              onOpen={openCard}
              seat={feed.excerpts.seat}
              analyze={feed.excerpts.analyze}
              onEdited={feed.excerpts.edited}
              onExpand={feed.excerpts.expand}
              focus={focused()}
              activeHit={focusedAt()}
              mode={mode()}
              decor={decor}
              empty={
                <EmptyState
                  icon={<CircleCheck size={22} />}
                  title={t("Nothing to report in the books that are open.")}
                />
              }
            />
          </Show>
        </Show>
      </div>
    </main>
  );
}
