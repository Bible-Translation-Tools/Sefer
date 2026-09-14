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
 * The keyboard cursor is LOCAL to this route, and deliberately so. The shell
 * has its own findings cursor over the unfiltered list (`editor.findings.next`
 * in the palette walks the whole project, which is what that command means);
 * a cursor here that honoured the filter but shared that state would make the
 * palette command jump according to a filter it never mentioned. Two cursors
 * with two scopes is the smaller lie, and it needs no change to the shell.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import CircleCheck from "lucide-solid/icons/circle-check";
import Wrench from "lucide-solid/icons/wrench";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";

import type { BookId } from "../../../core/book/book";
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
} from "../primitives";
import { createFindingsFilter, VIEWS, type FindingsView } from "./findingsFilter";
import { FindingsFilters } from "./FindingsFilters";

/** The one row look. A literal string: Tailwind scans source text, not values. */
const ROW = [
  "flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 transition-colors",
  "hover:bg-surface-secondary data-[stale=true]:opacity-60",
  "aria-[current=true]:bg-brand-light",
  "aria-[current=true]:shadow-[inset_0.1875rem_0_0_0_var(--brand-base)]",
].join(" ");

/** A row's stable identity for the cursor — the finding's own semantic id. */
const idOf = (finding: Finding | undefined): string => finding?.id ?? "";

export function FindingsPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const filters = createFindingsFilter(shell.services);
  const [preview, setPreview] = createSignal<Fixes.FixPreview | undefined>(undefined, {
    name: "fixPreview",
  });
  const [note, setNote] = createSignal("");
  const [cursor, setCursor] = createSignal(0, { name: "findingsCursor" });

  const all = (): readonly Finding[] => {
    shell.tick();
    return shell.project() === undefined ? [] : Findings.list(shell.services.projectAnalysis);
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

  const at = (index: number): Finding | undefined => shown()[index];

  /** Wraps, like the palette's own finding commands, over the FILTERED list. */
  const step = (delta: 1 | -1): void => {
    const rows = shown();
    if (rows.length === 0) return;
    setCursor((held) => (held + delta + rows.length) % rows.length);
  };

  const analysisFor = (finding: Finding) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(finding.bookId));

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
        if (held !== undefined) open(held);
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

  // A grouped list is taller than the viewport, so the cursor has to bring
  // itself into view or `j` walks off the bottom of the screen. Queried rather
  // than held in a ref: the row is re-created by `<For>` on every filter
  // change, and `aria-current` already names exactly one of them.
  createEffect(
    () => `${cursor()}:${shown().length}`,
    () => {
      document
        .querySelector('[data-findings-row][aria-current="true"]')
        ?.scrollIntoView({ block: "nearest" });
    },
  );

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
   * One row. Stale rows stay visible and stay dim — the badge says why, and
   * hiding them is the reader's own choice ("Hide stale"), never the panel's.
   * The cursor is `aria-current`, so a screen reader hears what the eye sees.
   */
  const row = (finding: Finding) => (
    <li
      data-findings-row
      data-code={finding.code}
      data-producer={finding.producer}
      data-stale={isStale(finding) ? "true" : undefined}
      aria-current={idOf(at(cursor())) === finding.id ? "true" : undefined}
      class={ROW}
    >
      <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
      <strong class="text-small font-semibold text-on-surface-primary">{finding.bookId}</strong>
      <code class="font-mono text-smallest text-on-surface-tertiary">{finding.code}</code>
      <span class="min-w-0 flex-1 truncate text-small text-on-surface-secondary">
        {finding.message}
      </span>
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
    </li>
  );

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader
        title={t("Findings")}
        subtitle={t(
          "j / k or the arrows move, Enter opens. Filters hide rows; they never delete findings.",
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

      <div class="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <FindingsFilters
          state={filters}
          facets={facets()}
          books={books()}
          class="lg:sticky lg:top-6"
        />

        <div class="min-w-0 space-y-3" data-findings={shown().length} data-view={filters.view()}>
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

          <For each={groups()}>
            {(group) => (
              <Show
                when={group.key !== ""}
                fallback={
                  <Card padded={false} class="overflow-hidden">
                    <ul class="divide-y divide-surface-border">
                      <For each={group.findings}>{row}</For>
                    </ul>
                  </Card>
                }
              >
                <section data-group={group.key}>
                  <header class="sticky top-0 z-10 -mx-1 mb-1.5 flex items-baseline gap-2 bg-surface-secondary/90 px-1 py-2 backdrop-blur-sm">
                    <h3 class="text-small font-semibold text-on-surface-primary">{group.key}</h3>
                    <Badge tone="muted">{t("{count} shown", { count: group.count })}</Badge>
                  </header>
                  <Card padded={false} class="overflow-hidden">
                    <ul class="divide-y divide-surface-border">
                      <For each={group.findings}>{row}</For>
                    </ul>
                  </Card>
                </section>
              </Show>
            )}
          </For>

          <Show when={shown().length === 0}>
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
          </Show>
        </div>
      </div>
    </main>
  );
}
