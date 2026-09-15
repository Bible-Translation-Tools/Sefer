/**
 * The findings panel: every finding in the project, in one shape, through the
 * reader's filter.
 *
 * `findings.list` does the ordering (severity, then position, within the
 * project's canonical book order), `findings/filter` does the subtraction and
 * the grouping, and `findings.stale` decides the badge. The fix preview is
 * computed on DEMAND — a panel showing four hundred findings pays for none of
 * them until someone asks — and `fixes.preview` refuses one computed from text
 * the book has since moved past, which is the mistake a panel like this
 * invites. `fixes.apply` then goes through `book.apply`, the one write path,
 * so a fix from this panel is the same event a fix from the editor is.
 *
 * The filter is subtractive and never authoritative: the header always says
 * "N of TOTAL shown" so a filtered panel can never read as a clean project
 * (vision §11.4), and the census, the inline marks and the corpus counts are
 * untouched by anything on this screen.
 *
 * Two things make a long list readable without lying about it. A row names
 * WHERE it is — `navigateTarget(finding, analysis)` turns the offset into
 * "PHM 1:4", and only when the analysis in hand is the one the finding was
 * computed from; otherwise the row shows the raw offset, because a chapter
 * and verse from another revision would name the wrong place with total
 * confidence. And a run of consecutive rows with the SAME code and the same
 * message collapses to one row carrying "× 21", which expands on click. The
 * collapse is per group and purely visual: the header's count, the filter
 * counts and the census are all still over findings, never over rows.
 *
 * The keyboard cursor is LOCAL to this route, and deliberately so. The shell
 * has its own findings cursor over the unfiltered list (`editor.findings.next`
 * in the palette walks the whole project, which is what that command means);
 * a cursor here that honoured the filter but shared that state would make the
 * palette command jump according to a filter it never mentioned. Two cursors
 * with two scopes is the smaller lie, and it needs no change to the shell.
 */

import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import CircleCheck from "lucide-solid/icons/circle-check";
import Wrench from "lucide-solid/icons/wrench";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { BookId } from "../../../core/book/book";
import * as Excerpts from "../../../core/excerpts/excerpts";
import * as Filter from "../../../core/findings/filter";
import type { Finding } from "../../../core/findings/finding";
import * as Findings from "../../../core/findings/findings";
import * as Fixes from "../../../core/fixes/fixes";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PanelHeader,
  SegmentedControl,
  severityTone,
  VirtualList,
  type VirtualSection,
} from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";
import { createFindingsFilter, VIEWS, type FindingsView } from "./findingsFilter";
import { FindingsFilters } from "./FindingsFilters";

/** The one row look. A literal string: Tailwind scans source text, not values. */
const ROW = [
  "flex flex-col gap-1.5 px-3.5 py-2.5 transition-colors",
  "hover:bg-surface-secondary data-[stale=true]:opacity-60",
  "aria-[current=true]:bg-brand-light",
  "aria-[current=true]:shadow-[inset_0.1875rem_0_0_0_var(--brand-base)]",
].join(" ");

/**
 * The height a row is assumed to have until it has been on screen once.
 *
 * One badge line plus a two-line quotation, at this list's width. It only has
 * to be close: the scrollbar is right from the first paint because of it, and
 * exact a frame later because a `ResizeObserver` corrects it.
 */
const ROW_ESTIMATE = 78;

/**
 * One displayed row. Ordinarily one finding; when `count` is greater than one
 * it stands for a run of identical findings and carries the toggle that opens
 * them. `id` is the cursor's identity — the finding's own semantic id, scoped
 * by the group, because the same finding appears in exactly one group per view
 * but the view can change under the cursor.
 */
interface Row {
  readonly id: string;
  readonly finding: Finding;
  readonly count: number;
  /** Whether the run this row heads is currently showing its members. */
  readonly open: boolean;
}

/** One section of the list: a group, as rows. */
interface Section {
  readonly key: string;
  readonly count: number;
  readonly rows: readonly Row[];
}

/**
 * Consecutive findings with the same code AND the same message are one thing
 * said N times — 76 rows of "\s5 is not a known marker" is a wall, not a
 * report. Only CONSECUTIVE ones fold, so the fold never re-orders and never
 * reaches across a group: `list` has already put them in position order, and
 * two runs separated by a different finding are two places to look.
 */
const runs = (findings: readonly Finding[]): readonly (readonly Finding[])[] => {
  const out: Finding[][] = [];
  for (const finding of findings) {
    const last = out.at(-1);
    const head = last?.[0];
    if (last !== undefined && head?.code === finding.code && head.message === finding.message)
      last.push(finding);
    else out.push([finding]);
  }
  return out;
};

export function FindingsPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const filters = createFindingsFilter(shell.services);
  const [preview, setPreview] = createSignal<Fixes.FixPreview | undefined>(undefined, {
    name: "fixPreview",
  });
  const [note, setNote] = createSignal("");
  const [cursor, setCursor] = createSignal(0, { name: "findingsCursor" });
  /** The runs the reader has opened, by row id. Session state, like the view. */
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set(), {
    name: "findingsExpanded",
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

  const all = (): readonly Finding[] => {
    shell.tick();
    if (shell.project() === undefined) return [];
    const listed = Findings.list(shell.services.projectAnalysis);
    const only = pattern();
    // A pattern is not one of `FindingsFilter`'s fields and should not become
    // one: it is an address another screen hands over for one visit, not a
    // preference anybody sets. So it narrows the list this panel calls "all",
    // which keeps the header's "N of TOTAL shown" honest about the question
    // that was actually asked.
    return only === undefined ? listed : listed.filter((finding) => finding.pattern === only);
  };

  const isStale = (finding: Finding): boolean => {
    shell.tick();
    const book = shell.project()?.book(finding.bookId);
    return book === undefined || Findings.stale(finding, book);
  };

  /** Counts over the unfiltered list: a chip's own count must not move as you click it. */
  const facets = () => Filter.facets(all());

  const shown = (): readonly Finding[] =>
    Filter.applyFilter(all(), filters.filter(), (finding) => isStale(finding));

  /**
   * What a group header says besides its key. Only the "by book" view has a
   * human name to add — a code and a severity ARE their own words — and the
   * name comes from the project's own metadata first, exactly as the sidebar's
   * does, so the two cannot disagree about what a book is called.
   */
  const heading = (key: string): string | undefined => {
    if (filters.view() !== "book") return undefined;
    const name = bookName(key, metadataOf(shell.project()));
    return name === key ? undefined : name;
  };

  /** Every book in the project, so a clean book still offers its chip. */
  const books = (): readonly BookId[] => shell.project()?.books.map((book) => book.id) ?? [];

  /**
   * The list as sections. `flat` is one unlabelled section rather than a
   * second rendering path — the row markup is the part worth having once.
   */
  const groups = (): readonly Filter.FindingGroup[] => {
    const rows = shown();
    const view = filters.view();
    if (view === "flat")
      return rows.length === 0 ? [] : [{ key: "", count: rows.length, findings: rows }];
    return Filter.groupBy(rows, view);
  };

  /**
   * The groups as rows: identical runs folded, opened ones unfolded. One memo
   * so the row markup, the cursor and `scrollIntoView` all read the same list
   * — and so a hundred rows do not each rebuild it.
   */
  const sections = createMemo(
    (): readonly Section[] =>
      groups().map((group) => {
        const rows: Row[] = [];
        for (const run of runs(group.findings)) {
          const head = run[0];
          if (head === undefined) continue;
          const id = `${group.key}:${head.id}`;
          if (run.length === 1) {
            rows.push({ id, finding: head, count: 1, open: false });
            continue;
          }
          rows.push({ id, finding: head, count: run.length, open: expanded().has(id) });
          if (expanded().has(id))
            for (const finding of run.slice(1))
              rows.push({ id: `${group.key}:${finding.id}`, finding, count: 1, open: false });
        }
        return { key: group.key, count: group.count, rows };
      }),
    { name: "findingsSections" },
  );

  /** Every row on screen, in reading order: what the cursor walks. */
  const visible = createMemo((): readonly Row[] => sections().flatMap((section) => section.rows), {
    name: "findingsVisibleRows",
  });

  const at = (index: number): Row | undefined => visible()[index];

  /** The cursor's row id, once per change rather than once per row. */
  const current = createMemo(() => at(cursor())?.id ?? "", { name: "findingsCursorId" });

  /** Wraps, like the palette's own finding commands, over the VISIBLE rows. */
  const step = (delta: 1 | -1): void => {
    // A snapshot on purpose: the wrap is over the list as it is when the key
    // was pressed.
    const staticCount = visible().length;
    if (staticCount === 0) return;
    setCursor((held) => (held + delta + staticCount) % staticCount);
  };

  const toggle = (id: string): void => {
    setExpanded((held) => {
      const next = new Set(held);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const analysisFor = (finding: Finding) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(finding.bookId));

  /**
   * Where a finding points, as a person writes it. `navigateTarget` fills in
   * the reference only when the analysis handed to it still describes the very
   * text the finding was measured against — so a row either names a verse it
   * can prove or shows the offset, and never guesses one in between.
   */
  const place = (finding: Finding): { readonly text: string; readonly exact: boolean } => {
    const ref = Findings.navigateTarget(finding, analysisFor(finding)?.analysis).ref;
    if (ref === undefined) return { text: `@${finding.from}`, exact: false };
    // Chapter 0 is the matter before the first `\c` — an id line, a heading,
    // a table of contents entry. "PHM 0" would read as a chapter nobody has.
    if (ref.chapter < 1) return { text: t("front"), exact: true };
    return {
      text: ref.verse === undefined ? `${ref.chapter}` : `${ref.chapter}:${ref.verse}`,
      exact: true,
    };
  };

  const open = (finding: Finding): void => {
    const project = shell.project();
    if (project === undefined) return;
    const target = Findings.navigateTarget(finding, analysisFor(finding)?.analysis);
    // Leave the aim before navigating: the book route reads it to decide the
    // opening clip (chapter preference) and the editor scrolls to it.
    shell.aim(target.bookId, target.from);
    void navigate({
      to: "/project/$id/book/$book",
      params: {
        id: encodeURIComponent(project.root),
        book: encodeURIComponent(target.bookId),
      },
    });
  };

  /** What Enter does: a folded run opens where a single row goes to the book. */
  const activate = (row: Row): void => {
    if (row.count > 1 && !row.open) {
      toggle(row.id);
      return;
    }
    open(row.finding);
  };

  /**
   * `j`/`k` and the arrows move, Enter opens.
   *
   * Listened for on the document because the panel has no single focusable
   * body, and guarded on the target: the text filter and every other field is
   * a place where `j` means `j`. Modified chords are left to
   * `src/app/commands.ts`, which owns the `Mod-` keymap.
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
        const held = at(cursor());
        if (held !== undefined) activate(held);
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

  // The cursor brings itself into view, or `j` walks off the bottom of the
  // screen. It is `VirtualList`'s `focus` that does it now, and that is not a
  // tidying: the row the cursor lands on may not be RENDERED — that is the
  // whole point of windowing — and a `scrollIntoView` on a DOM node that does
  // not exist cannot work where a computed offset can.

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
    const applied = Fixes.apply(fix, book);
    setNote(
      Result.isSuccess(applied)
        ? t("applied {label}", { label: fix.label })
        : t("refused by {rule}", { rule: applied.failure.rule }),
    );
    setPreview(undefined);
    shell.bump();
  };
  /**
   * The verse this finding is in, as the READING, with the finding's own span
   * marked.
   *
   * `quote` (`core/excerpts`) projects a window around the span and places the
   * span back inside it, so what a row shows is the sentence a translator would
   * read rather than the USFM it is written in. When the span has no character
   * in the projection at all — it is inside a marker name, an attribute, a
   * control character — `projected` comes back false and the quotation is the
   * raw slice instead, which the row says rather than quietly showing a
   * different character.
   *
   * The analysis has to be the one the finding was measured against, and
   * `ProjectAnalysis.analysis` is the only thing that holds it. A row whose
   * analysis has moved on shows nothing here rather than quoting the wrong
   * verse with total confidence — the same rule `place` follows for the
   * reference.
   */
  const excerpt = (finding: Finding): Excerpts.Quotation | undefined => {
    const held = analysisFor(finding);
    if (held === undefined) return undefined;
    if (
      finding.engine.docLen !== held.analysis.docLen ||
      finding.engine.sourceHash !== held.analysis.sourceHash
    )
      return undefined;
    try {
      return Excerpts.quote(held.analysis, finding.from, finding.to);
    } catch {
      return undefined;
    }
  };

  /**
   * One row. Stale rows stay visible and stay dim — the badge says why, and
   * hiding them is the reader's own choice ("Hide stale"), never the panel's.
   * The cursor is `aria-current`, so a screen reader hears what the eye sees.
   *
   * A row standing for a run carries the count as a toggle. Everything else on
   * it — the reference, the code, the message — is the run's first member,
   * which is what "identical" means here.
   */
  const row = (entry: Row) => {
    const finding = entry.finding;
    const quoted = () => excerpt(finding);
    return (
      <Card
        padded={false}
        data-findings-row
        data-code={finding.code}
        data-producer={finding.producer}
        data-count={entry.count}
        data-stale={isStale(finding) ? "true" : undefined}
        aria-current={current() === entry.id ? "true" : undefined}
        class={ROW}
      >
        <div class="flex flex-wrap items-center gap-2.5">
          <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
          <strong class="text-small font-semibold whitespace-nowrap text-on-surface-primary">
            {finding.bookId}{" "}
            <Show
              when={place(finding).exact}
              fallback={
                <span class="font-normal text-on-surface-tertiary" title={t("no fresh analysis")}>
                  {place(finding).text}
                </span>
              }
            >
              <span class="tabular-nums text-on-surface-secondary">{place(finding).text}</span>
            </Show>
          </strong>
          <code class="font-mono text-smallest text-on-surface-tertiary">{finding.code}</code>
          <span class="min-w-0 flex-1 truncate text-small text-on-surface-secondary">
            {finding.message}
          </span>
          <Show when={entry.count > 1}>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={entry.open ? "true" : "false"}
              aria-label={
                entry.open
                  ? t("Fold {count} identical findings", { count: entry.count })
                  : t("Unfold {count} identical findings", { count: entry.count })
              }
              class="tabular-nums"
              icon={entry.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              onClick={() => toggle(entry.id)}
            >
              × {entry.count}
            </Button>
          </Show>
          <Show when={isStale(finding)}>
            <Badge tone="muted">{t("stale")}</Badge>
          </Show>
          <Button size="sm" variant="tertiary" onClick={() => open(finding)}>
            {t("Go")}
          </Button>
          <Show when={finding.fix !== undefined}>
            <Button size="sm" icon={<Wrench size={12} />} onClick={() => offer(finding)}>
              {t("Fix")}
            </Button>
          </Show>
        </div>
        <Show when={quoted()}>
          {(quotation) => (
            <p
              data-findings-excerpt={quotation().projected ? "reading" : "markup"}
              class={
                quotation().projected
                  ? "px-0.5 text-small leading-relaxed text-on-surface-secondary"
                  : "px-0.5 font-mono text-smallest break-all text-on-surface-tertiary"
              }
            >
              <span class="opacity-70">{quotation().before}</span>
              <mark class="rounded-xs bg-brand/20 px-px font-semibold text-on-surface-primary">
                {quotation().hit}
              </mark>
              <span class="opacity-70">{quotation().after}</span>
            </p>
          )}
        </Show>
      </Card>
    );
  };

  /**
   * The list as the virtualizer wants it: one section per group, one row per
   * finding or folded run.
   *
   * Every row is rendered at an ESTIMATE first and corrected once it has been
   * on screen, so a project with thousands of findings paints the rows in the
   * viewport and nothing else. Before this the panel built every `<li>` on
   * every keystroke of the text filter, which is what made a long list feel
   * broken — see documentation/architecture/findings.md.
   */
  const feed = createMemo(
    (): readonly VirtualSection<Row>[] =>
      sections().map((section) => ({
        key: section.key,
        rows: section.rows.map((entry) => ({
          key: entry.id,
          item: entry,
          estimate: ROW_ESTIMATE,
        })),
      })),
    { name: "findingsFeed" },
  );

  return (
    <main class="flex h-screen min-w-0 flex-col gap-4 p-6" data-findings-panel>
      <PanelHeader
        title={t("Findings")}
        subtitle={t(
          "j / k or the arrows move; Enter opens a row, or unfolds a repeated one. Filters hide rows; they never delete findings.",
        )}
        actions={
          <>
            <span class="text-small text-on-surface-tertiary" data-findings-count={shown().length}>
              {t("{shown} of {total} shown", { shown: shown().length, total: all().length })}
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
        <FindingsFilters state={filters} facets={facets()} books={books()} />
        <Show when={pattern() !== undefined}>
          <p class="flex flex-wrap items-center gap-2 text-smallest text-on-surface-tertiary">
            <Badge tone="brand">{t("one pattern")}</Badge>
            {t("Showing only the sites of the pattern /inventory sent over.")}
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => void navigate({ to: "/findings", search: {} })}
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
        data-findings={shown().length}
        data-view={filters.view()}
      >
        <Show
          when={shown().length > 0}
          fallback={
            <Show
              when={all().length > 0}
              fallback={
                <EmptyState
                  icon={<CircleCheck size={22} />}
                  title={t("Nothing to report — or no project is open.")}
                />
              }
            >
              <EmptyState
                title={t("{total} findings, all hidden by the filter.", { total: all().length })}
              />
            </Show>
          }
        >
          <VirtualList<Row>
            sections={feed()}
            focus={current()}
            class="min-h-0 min-w-0 flex-1 overflow-y-auto pe-1"
            header={(section, ref) => (
              <Show when={section.key !== ""} fallback={<div ref={ref} />}>
                <header
                  ref={ref}
                  data-group={section.key}
                  class="sticky top-0 z-10 -mx-1 mb-1.5 flex items-baseline gap-2 bg-surface-secondary/95 px-1 py-2 backdrop-blur-xs"
                >
                  <h3 class="text-small font-semibold text-on-surface-primary">{section.key}</h3>
                  <Show when={heading(section.key)}>
                    {(name) => <span class="text-small text-on-surface-secondary">{name()}</span>}
                  </Show>
                  <Badge tone="muted">
                    {t("{count} shown", {
                      count: sections().find((entry) => entry.key === section.key)?.count ?? 0,
                    })}
                  </Badge>
                </header>
              </Show>
            )}
            row={(entry) => row(entry)}
          />
        </Show>
      </div>
    </main>
  );
}
