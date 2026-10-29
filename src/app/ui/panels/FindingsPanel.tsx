import type { BookId } from "@sefer/text/book";
import { useNavigate, useSearch } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import CircleCheck from "lucide-solid/icons/circle-check";
import SettingsIcon from "lucide-solid/icons/settings";
import Wrench from "lucide-solid/icons/wrench";
import X from "lucide-solid/icons/x";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import type { Excerpt } from "#core/excerpts/excerpts";
import * as Filter from "#core/findings/filter";
import type { Finding } from "#core/findings/finding";
import * as Findings from "#core/findings/findings";
import * as Fixes from "#core/fixes/fixes";

import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { excerptCard, ExcerptList, type ExcerptCardSpec, type OutlineSpec } from "../excerpts";
import type { CardAction } from "../multibuffer/CardAction";
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  IconButton,
  PanelHeader,
  SegmentedControl,
  severityTone,
} from "../primitives";
import { findingMessage } from "../rules/labelMessages";
import { createFindSource } from "../search/findSource";
import { SearchDialog } from "../search/SearchDialog";
import { SousSettingsPanel } from "../SousSettingsPanel";
import { codeLabel } from "./findingLabels";
import {
  createFindingsFeed,
  foldRuns,
  inMarkup,
  type FindingRun,
  type FindingsFeed,
  type FindingsRow,
} from "./findingsFeed";
import {
  createFindingsFilter,
  VIEWS,
  type FindingsFilterState,
  type FindingsView,
} from "./findingsFilter";
import { FindingsFilters } from "./FindingsFilters";
import { SousSentence } from "./SousSentence";
import { SuppressActions } from "./SuppressActions";

const LINE_HEIGHT = 30;

const severitiesOf = (row: FindingsRow): readonly Finding["severity"][] =>
  Filter.SEVERITIES.filter((severity) =>
    row.findings.some((finding) => finding.severity === severity),
  );

interface RunDisclosure {
  readonly isOpen: (row: FindingsRow, finding: Finding) => boolean;
  readonly toggleRun: (row: FindingsRow, finding: Finding) => void;
  readonly isWhyOpen: (row: FindingsRow, finding: Finding) => boolean;
  readonly toggleWhy: (row: FindingsRow, finding: Finding) => void;
}

const createRunDisclosure = (feed: FindingsFeed): RunDisclosure => {
  const runId = (row: FindingsRow, finding: Finding): string => `${row.sectionKey}|${finding.id}`;
  const isOpen = (row: FindingsRow, finding: Finding): boolean =>
    feed.excerpts.views.view(row.excerpt.sid).open.has(runId(row, finding));
  const toggleRun = (row: FindingsRow, finding: Finding): void =>
    feed.excerpts.views.send(row.excerpt.sid, { kind: "open", id: runId(row, finding) });
  const whyId = (row: FindingsRow, finding: Finding): string => `why|${runId(row, finding)}`;
  const isWhyOpen = (row: FindingsRow, finding: Finding): boolean =>
    feed.excerpts.views.view(row.excerpt.sid).open.has(whyId(row, finding));
  const toggleWhy = (row: FindingsRow, finding: Finding): void =>
    feed.excerpts.views.send(row.excerpt.sid, { kind: "open", id: whyId(row, finding) });
  return { isOpen, toggleRun, isWhyOpen, toggleWhy };
};

const createFindingsPool = (
  shell: Shell,
  filters: FindingsFilterState,
  pattern: () => number | undefined,
  showingSuppressed: () => boolean,
) => {
  const pool = createMemo(
    (): readonly Finding[] => {
      if (shell.project() === undefined) return [];
      const listed = showingSuppressed() ? shell.suppressedFindings() : shell.findings();
      const only = pattern();
      return only === undefined ? listed : listed.filter((finding) => finding.pattern === only);
    },
    { name: "findingsPool" },
  );

  // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
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

  const isStale = (finding: Finding): boolean => {
    const revision = revisions()[finding.bookId];
    return revision === undefined || revision !== finding.stamp.revision;
  };

  const summary = createMemo(() => Filter.summarise(pool(), filters.filter(), isStale), {
    name: "findingsSummary",
  });

  const shown = createMemo(
    (): readonly Finding[] =>
      Filter.applyFilter(Findings.list({ findings: pool }), filters.filter(), isStale),
    { name: "findingsShown" },
  );
  return { isStale, summary, shown };
};

const createFindingGo = (
  shell: Shell,
  feed: FindingsFeed,
  isStale: (finding: Finding) => boolean,
) => {
  const go = (finding: Finding, via: "go" | "key" = "go"): void => {
    navigateTo(finding.bookId, finding.from, finding.to, finding, via);
  };

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
  return go;
};

const createFixOffer = (shell: Shell) => {
  const [preview, setPreview] = createSignal<Fixes.FixPreview | undefined>(undefined, {
    name: "fixPreview",
  });
  const [note, setNote] = createSignal("");
  const analysisFor = (finding: Finding) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(finding.bookId));

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
  return { preview, setPreview, note, offer, apply };
};

const createWalk = (feed: FindingsFeed, go: (finding: Finding, via?: "go" | "key") => void) => {
  const [cursor, setCursor] = createSignal(0, { name: "findingsCursor" });
  const [walking, setWalking] = createSignal(false, { name: "findingsWalking" });
  const at = (index: number): FindingsRow | undefined => feed.rows()[index];

  const step = (delta: 1 | -1): void => {
    const staticCount = feed.rows().length;
    if (staticCount === 0) return;
    setWalking(true);
    setCursor((held) => (held + delta + staticCount) % staticCount);
  };

  {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (event.key === "Enter" && target.closest("button, a, [role=menuitem]") !== null) return;
      }
      if (event.key === "ArrowDown") step(1);
      else if (event.key === "ArrowUp") step(-1);
      else if (event.key === "Enter") {
        if (!walking()) setWalking(true);
        else {
          const finding = at(cursor())?.findings[0];
          if (finding !== undefined) go(finding, "key");
        }
      } else return;
      event.preventDefault();
    };
    // onCleanup in the component body: one inside an effect callback never runs (NO_OWNER_CLEANUP).
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
    });
  }

  const focused = (): string | undefined => (walking() ? at(cursor())?.key : undefined);
  const focusedAt = (): number | undefined =>
    walking() ? at(cursor())?.findings[0]?.from : undefined;
  return { focused, focusedAt };
};

const findingLine = (
  disclosure: RunDisclosure,
  row: FindingsRow,
  finding: Finding,
  run?: FindingRun,
) => {
  const { isOpen, toggleRun, isWhyOpen, toggleWhy } = disclosure;
  const folded = (run?.members.length ?? 1) > 1;
  const markup = inMarkup(row.excerpt, finding);
  return (
    <li
      class="flex flex-col gap-0.5"
      data-finding={finding.id}
      data-code={finding.code}
      data-severity={finding.severity}
      data-markup={markup ? "true" : undefined}
    >
      <div class="flex flex-wrap items-center gap-2">
        <Show when={severitiesOf(row).length > 1}>
          <Badge tone={severityTone(finding.severity)}>{finding.severity}</Badge>
        </Show>
        <span class="text-smallest text-on-surface-tertiary" title={finding.code}>
          {codeLabel(finding.code)}
        </span>
        <span class="min-w-0 flex-1 text-small text-on-surface-secondary">
          <Show when={finding.described} fallback={findingMessage(finding)}>
            {(described) => <SousSentence message={described()} tier="headline" />}
          </Show>
        </span>

        <Show when={finding.comparison}>
          {(comparison) => <SearchDialog queries={comparison()} />}
        </Show>
        <div class="flex items-center gap-controls">
          <SuppressActions finding={finding} />
          <Show when={finding.details !== undefined}>
            <Button
              size="sm"
              variant="tertiary"
              aria-expanded={isWhyOpen(row, finding) ? "true" : "false"}
              icon={isWhyOpen(row, finding) ? <ChevronDown /> : <ChevronRight />}
              onClick={() => toggleWhy(row, finding)}
            >
              {t("Why?")}
            </Button>
          </Show>
          <Show when={folded}>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={isOpen(row, finding) ? "true" : "false"}
              aria-label={
                isOpen(row, finding)
                  ? t("Fold {count} identical findings", { count: run?.members.length ?? 0 })
                  : t("Unfold {count} identical findings", { count: run?.members.length ?? 0 })
              }
              class="tabular-nums"
              icon={isOpen(row, finding) ? <ChevronDown /> : <ChevronRight />}
              onClick={() => toggleRun(row, finding)}
            >
              × {run?.members.length ?? 1}
            </Button>
          </Show>
        </div>
      </div>

      <Show when={isWhyOpen(row, finding) ? finding.described : undefined}>
        {(described) => (
          <p class="text-small text-on-surface-tertiary" data-why={finding.id}>
            <SousSentence message={described()} tier="details" />
          </p>
        )}
      </Show>

      <Show when={folded && isOpen(row, finding)}>
        <ul class="ms-4 flex flex-col gap-0.5 border-s border-surface-border ps-2">
          <For each={run?.members.slice(1) ?? []}>
            {(member) => findingLine(disclosure, row, member)}
          </For>
        </ul>
      </Show>
    </li>
  );
};

const createFindingsCard = (
  feed: FindingsFeed,
  offer: (finding: Finding) => void,
  disclosure: RunDisclosure,
  isStale: (finding: Finding) => boolean,
): ExcerptCardSpec => {
  const badges = (_excerpt: Excerpt, key: string) => {
    const row = feed.row(key);
    if (row === undefined) return undefined;
    return (
      <>
        <For each={severitiesOf(row)}>
          {(severity) => <Badge tone={severityTone(severity)}>{severity}</Badge>}
        </For>
        <Show when={row.findings.some(isStale)}>
          <Badge tone="muted">{t("stale")}</Badge>
        </Show>
      </>
    );
  };

  const actions = (_excerpt: Excerpt, key: string): readonly CardAction[] => {
    const row = feed.row(key);
    const fixable = foldRuns(row?.findings ?? [])
      .map((run) => run.head)
      .filter((finding) => finding.fix !== undefined);
    return fixable.map((finding) => ({
      kind: "button",
      id: `fix:${finding.code}`,
      label: fixable.length === 1 ? t("Fix") : t("Fix {code}", { code: finding.code }),
      icon: Wrench,
      onPress: () => offer(finding),
    }));
  };

  const notes = (_excerpt: Excerpt, key: string) => {
    const row = feed.row(key);
    if (row === undefined) return undefined;
    return (
      <ul class="flex flex-col gap-1" data-findings-in={row.findings.length}>
        <For each={foldRuns(row.findings)}>
          {(run) => findingLine(disclosure, row, run.head, run)}
        </For>
      </ul>
    );
  };

  return excerptCard(
    { kind: "steps", step: feed.excerpts.expand },
    { kind: "none" },
    {
      marks: { kind: "toned", tone: (source, excerpt) => feed.toneOf(source, excerpt) },
      usfm: {
        kind: "when",
        offer: (_excerpt, key) => {
          const row = feed.row(key);
          return row?.findings.some((finding) => inMarkup(row.excerpt, finding)) === true;
        },
      },
      title: (_excerpt, key) => {
        const row = feed.row(key);
        return row?.front === true ? t("{book} · front matter", { book: row.bookName }) : undefined;
      },
      info: badges,
      notes,
      actions,
      extraHeight: (_excerpt, key) => {
        const row = feed.row(key);
        return row === undefined ? 0 : 8 + LINE_HEIGHT * foldRuns(row.findings).length;
      },
    },
  );
};

function FixPreviewCard(props: {
  readonly fix: Fixes.FixPreview;
  readonly onApply: (fix: Fixes.FixPreview) => void;
  readonly onDismiss: () => void;
}) {
  return (
    <Card class="space-y-2.5 border-brand/40">
      <div class="flex flex-wrap items-center gap-2">
        <Wrench size={14} class="text-brand" aria-hidden="true" />
        <strong class="text-small font-semibold">{props.fix.label}</strong>
        <Button
          variant="primary"
          size="sm"
          class="ms-auto"
          onClick={() => props.onApply(props.fix)}
        >
          {t("Apply")}
        </Button>
        <Button size="sm" onClick={() => props.onDismiss()}>
          {t("Dismiss")}
        </Button>
      </div>
      <ul class="flex flex-col gap-1">
        <For each={props.fix.changes}>
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
  );
}

function SettingsAside(props: { readonly onClose: () => void }) {
  return (
    <aside
      aria-label={t("Proofreading settings")}
      class="flex w-[26rem] shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-surface-border bg-surface-primary p-4"
    >
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-small font-semibold text-on-surface-primary">
          {t("Proofreading settings")}
        </h3>
        <IconButton
          size="sm"
          label={t("Close settings")}
          icon={<X />}
          onClick={() => props.onClose()}
        />
      </div>
      <SousSettingsPanel bare />
    </aside>
  );
}

export function FindingsPanel() {
  const shell = useShell();
  const navigate = useNavigate();
  const filters = createFindingsFilter(shell.services);
  const [settingsOpen, setSettingsOpen] = createSignal(false, { name: "findingsSettingsOpen" });
  const [showingSuppressed, setShowingSuppressed] = createSignal(false, {
    name: "findingsShowingSuppressed",
  });
  const hiddenCount = createMemo(() => shell.suppressedFindings().length, {
    name: "findingsHiddenCount",
  });
  const source = createFindSource(() => {});
  const search = useSearch({ from: "/_app/project/$slug/findings" });

  const pattern = (): number | undefined => search().pattern;

  createEffect(
    () => search().code,
    (code) => {
      if (code === undefined) return;
      // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
      untrack(() => {
        filters.update({ codes: [code], books: null });
      });
    },
  );

  const { isStale, summary, shown } = createFindingsPool(
    shell,
    filters,
    pattern,
    showingSuppressed,
  );

  const books = (): readonly BookId[] => shell.project()?.books.map((book) => book.id) ?? [];

  const feed = createFindingsFeed({ findings: shown, view: filters.view });

  const [body, setBody] = createSignal(false, { name: "findingsBody" });
  let after: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    after = setTimeout(() => setBody(true), 0);
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    if (after !== undefined) clearTimeout(after);
  });

  const go = createFindingGo(shell, feed, isStale);
  const { preview, setPreview, note, offer, apply } = createFixOffer(shell);
  const disclosure = createRunDisclosure(feed);
  const { focused, focusedAt } = createWalk(feed, go);

  const sections: OutlineSpec = {
    rowKey: (group, excerpt) => `${group.bookId}|${excerpt.sid}`,
    title: t("Groups with findings"),
    label: (row) => {
      const head = feed.head(row.bookId);
      if (head === undefined) return row.bookId;
      return head.front ? t("{book} front", { book: head.label }) : head.label;
    },
  };

  const card = createFindingsCard(feed, offer, disclosure, isStale);

  const mode = (): "regular" | "usfm" => (shell.mode() === "usfm" ? "usfm" : "regular");

  return (
    <main class="flex h-full min-w-0 flex-col gap-4 p-6" data-findings-panel>
      <PanelHeader
        title={t("Findings")}
        actions={
          <>
            <span class="text-small text-on-surface-tertiary" data-findings-count={summary().shown}>
              {t("{shown} of {total} shown", { shown: summary().shown, total: summary().total })}
            </span>

            <Button
              size="sm"
              variant={showingSuppressed() ? "secondary" : "tertiary"}
              aria-pressed={showingSuppressed() ? "true" : "false"}
              data-findings-hidden={hiddenCount()}
              disabled={hiddenCount() === 0 && !showingSuppressed()}
              title={t("Findings you marked fine, on this device")}
              onClick={() => setShowingSuppressed((on) => !on)}
            >
              {showingSuppressed()
                ? t("Back to findings")
                : t("{count} marked fine", { count: hiddenCount() })}
            </Button>
            <SegmentedControl<FindingsView>
              label={t("Group findings by")}
              items={VIEWS.map((view) => ({ value: view.value, label: t(view.label) }))}
              value={filters.view()}
              onChange={(view) => filters.setView(view)}
            />
          </>
        }
      />

      <Card class="space-y-2" data-tour="findings-filters">
        <div class="flex items-start gap-2">
          <FindingsFilters
            class="min-w-0 flex-1"
            state={filters}
            facets={summary().facets}
            books={books()}
          />
          <source.Picker />

          <IconButton
            size="sm"
            label={t("Proofreading settings")}
            icon={<SettingsIcon />}
            aria-pressed={settingsOpen() ? "true" : "false"}
            onClick={() => setSettingsOpen((open) => !open)}
          />
        </div>
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
          <FixPreviewCard fix={fix()} onApply={apply} onDismiss={() => setPreview(undefined)} />
        )}
      </Show>

      <div class="flex min-h-0 min-w-0 flex-1 gap-4">
        <div
          class={cx(
            "flex min-h-0 min-w-0 flex-1 flex-col transition-opacity duration-150",
            shell.findingsPending() && "opacity-60",
          )}
          aria-busy={shell.findingsPending() ? "true" : undefined}
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
                goneLabel={t("Resolved")}
                resultsKey={JSON.stringify(filters.filter())}
                groups={feed.groups()}
                views={feed.excerpts.views}
                outline={feed.outline()}
                seat={feed.excerpts.seat}
                seatedOf={feed.excerpts.seatedOf}
                shownOf={feed.excerpts.shownOf}
                analyze={feed.excerpts.analyze}
                onEdited={feed.excerpts.edited}
                focus={focused()}
                activeHit={focusedAt()}
                mode={mode()}
                card={card}
                sections={sections}
                pairedOf={source.shown() ? source.pairedOf : undefined}
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
        <Show when={settingsOpen()}>
          <SettingsAside onClose={() => setSettingsOpen(false)} />
        </Show>
      </div>
    </main>
  );
}
