import { useNavigate } from "@tanstack/solid-router";
import { Option } from "effect";
import ExternalLink from "lucide-solid/icons/external-link";
import { For, Show, createMemo } from "solid-js";

import { quote, type Quotation } from "#core/excerpts/excerpts";
import {
  codePointLabel,
  type FlaggedSite,
  type Glyph,
  type PatternRow,
} from "#core/findings/inventory";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  cx,
  PanelHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives";
import { GlyphTile } from "./GlyphTile";

const share = (basisPoints: number): string => `${(basisPoints / 100).toFixed(2)}%`;

const rawAt = (text: string, from: number, to: number): Quotation => {
  const start = Math.max(0, from - 26);
  const end = Math.min(text.length, to + 34);
  const flat = (part: string): string => part.replace(/\s+/g, " ");
  return {
    before: `${start > 0 ? "…" : ""}${flat(text.slice(start, from))}`,
    hit: flat(text.slice(from, to)),
    after: `${flat(text.slice(to, end))}${end < text.length ? "…" : ""}`,
    projected: false,
  };
};

const ABSENT: Quotation = { before: "", hit: "", after: "", projected: true };

function Section(props: {
  readonly title: string;
  readonly note?: string;
  readonly children: import("@solidjs/web").JSX.Element;
}) {
  return (
    <section class="space-y-1.5">
      <div class="flex flex-wrap items-baseline gap-2">
        <h4 class="text-small font-semibold text-on-surface-primary">{props.title}</h4>
        <Show when={props.note !== undefined}>
          <span class="text-smallest text-on-surface-tertiary">{props.note}</span>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

export interface GlyphDetailProps {
  readonly glyph: Glyph;
  readonly bookCount: number;
  readonly pattern: number | undefined;
  readonly onPattern: (pattern: number | undefined) => void;
}

export function GlyphDetail(props: GlyphDetailProps) {
  const shell = useShell();
  const navigate = useNavigate();

  const pooled = (): boolean => props.glyph.char === "";

  const analysisOf = (bookId: string) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(bookId));

  const excerpt = (site: FlaggedSite): Quotation => {
    shell.stampOf(site.bookId);
    const analysis = analysisOf(site.bookId)?.analysis;
    if (analysis !== undefined) return quote(analysis, site.from, site.to);
    const text = shell.project()?.book(site.bookId)?.source().text;
    return text === undefined ? ABSENT : rawAt(text, site.from, site.to);
  };

  const where = (site: FlaggedSite): string => {
    const address = shell.location.addressAt(
      site.bookId,
      site.from,
      site.engine,
      analysisOf(site.bookId)?.analysis,
    );
    if (address === undefined)
      return t("{book} · offset {from}", { book: site.bookId, from: site.from });
    return shell.location.label(address);
  };

  const stale = (site: FlaggedSite): boolean => {
    const stamp = shell.stampOf(site.bookId);
    return stamp === undefined || stamp.revision !== site.stamp.revision;
  };

  const go = (site: FlaggedSite): void => {
    const project = shell.project();
    if (project === undefined) return;
    shell.aim(site.bookId, site.from);
    void navigate({
      to: "/project/$slug/book/$book",
      params: {
        slug: shell.slugFor(project.root),
        book: encodeURIComponent(site.bookId),
      },
    });
  };

  const openInFindings = (): void => {
    const channel = props.glyph.rows.find((row) => row.pattern === props.pattern)?.channel;
    if (channel === undefined) return;
    void navigate({
      to: "/project/$slug/findings",
      params: { slug: shell.slug() },
      search: { code: `sous.convention.${channel}` },
    });
  };

  const sites = (): readonly FlaggedSite[] =>
    props.pattern === undefined
      ? props.glyph.flagged
      : props.glyph.flagged.filter((site) => site.pattern === props.pattern);

  const sitesButton = (row: PatternRow) => (
    <Show when={row.flagged > 0} fallback={<span class="text-on-surface-tertiary">—</span>}>
      <Button
        size="sm"
        variant="tertiary"
        aria-pressed={props.pattern === row.pattern ? "true" : "false"}
        onClick={() => props.onPattern(props.pattern === row.pattern ? undefined : row.pattern)}
      >
        {row.flagged === 1 ? t("1 site") : t("{count} sites", { count: row.flagged })}
      </Button>
    </Show>
  );

  const usualLine = (row: PatternRow) =>
    row.usual === undefined ? null : (
      <span class="block text-smallest font-normal text-on-surface-tertiary">{row.usual}</span>
    );

  const placementUsual = (): string => {
    const cells = props.glyph.placement;
    const before = cells.find((cell) => cell.prev?.usual !== undefined)?.prev?.usual;
    const after = cells.find((cell) => cell.next?.usual !== undefined)?.next?.usual;
    return [before, after].filter((part) => part !== undefined).join(" · ");
  };

  const fraction = (row: PatternRow) => (
    <>
      <TableCell class="text-end font-mono text-smallest tabular-nums">
        {row.numerator} / {row.denominator}
      </TableCell>
      <TableCell class="text-end font-mono text-smallest tabular-nums">
        {share(row.shareBp)}
      </TableCell>
    </>
  );

  return (
    <Card class="min-w-0 space-y-5" data-glyph={props.glyph.codePoint}>
      <PanelHeader
        level={3}
        title={
          <span class="flex items-center gap-3">
            <GlyphTile char={props.glyph.char} pooled={pooled()} size="lg" />
            <span class="min-w-0">
              <span class="block truncate">{props.glyph.name}</span>
              <code class="text-small font-normal text-on-surface-tertiary">
                {codePointLabel(props.glyph.codePoint)}
              </code>
            </span>
          </span>
        }
        actions={
          <span class="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{props.glyph.pool}</Badge>
            <span class="text-small text-on-surface-tertiary">
              {t("{sites} sites · {books} of {total} books", {
                sites: props.glyph.sites,
                books: props.glyph.books,
                total: props.bookCount,
              })}
            </span>
            <Show when={props.glyph.flagged.length > 0}>
              <Badge tone="warning">
                {t("{count} flagged", { count: props.glyph.flagged.length })}
              </Badge>
            </Show>
          </span>
        }
      />

      <Show when={props.glyph.neighbours.length > 0}>
        <Section
          title={t("What sits beside it")}
          note={t("the character, or the class of character, next to this one")}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{t("Neighbour")}</TableHeader>
                <TableHeader class="text-end">{t("Count")}</TableHeader>
                <TableHeader class="text-end">{t("Share")}</TableHeader>
                <TableHeader class="text-end">{t("Books")}</TableHeader>
                <TableHeader class="text-end">{t("Flagged")}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={props.glyph.neighbours}>
                {(row) => (
                  <TableRow>
                    <TableCell>
                      <span class="flex items-center gap-2">
                        <Show
                          when={row.channel === "ExactNeighbor"}
                          fallback={<Badge tone="muted">{row.label}</Badge>}
                        >
                          <GlyphTile char={row.label} size="sm" />
                        </Show>
                        <span class="text-smallest text-on-surface-tertiary">
                          {row.channel === "ExactNeighbor" ? t("exactly") : t("any of the pool")}
                        </span>
                      </span>
                      {usualLine(row)}
                    </TableCell>
                    {fraction(row)}
                    <TableCell class="text-end font-mono text-smallest tabular-nums">
                      {row.books}
                    </TableCell>
                    <TableCell class="text-end">{sitesButton(row)}</TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </Section>
      </Show>

      <Show when={props.glyph.placement.length > 0}>
        <Section
          title={t("How it attaches to words")}
          note={placementUsual() || t("what class of character the engine found on each side")}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{t("Class")}</TableHeader>
                <TableHeader class="text-end">{t("Before")}</TableHeader>
                <TableHeader class="text-end">{t("Share")}</TableHeader>
                <TableHeader class="text-end">{t("After")}</TableHeader>
                <TableHeader class="text-end">{t("Share")}</TableHeader>
                <TableHeader class="text-end">{t("Flagged")}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={props.glyph.placement}>
                {(cell) => (
                  <TableRow>
                    <TableCell class="font-medium">{cell.class}</TableCell>
                    <TableCell class="text-end font-mono text-smallest tabular-nums">
                      {cell.prev === undefined
                        ? "—"
                        : `${cell.prev.numerator} / ${cell.prev.denominator}`}
                    </TableCell>
                    <TableCell class="text-end font-mono text-smallest tabular-nums">
                      {cell.prev === undefined ? "—" : share(cell.prev.shareBp)}
                    </TableCell>
                    <TableCell class="text-end font-mono text-smallest tabular-nums">
                      {cell.next === undefined
                        ? "—"
                        : `${cell.next.numerator} / ${cell.next.denominator}`}
                    </TableCell>
                    <TableCell class="text-end font-mono text-smallest tabular-nums">
                      {cell.next === undefined ? "—" : share(cell.next.shareBp)}
                    </TableCell>
                    <TableCell class="text-end">
                      <span class="flex justify-end gap-1">
                        {cell.prev === undefined ? null : sitesButton(cell.prev)}
                        {cell.next === undefined ? null : sitesButton(cell.next)}
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </Section>
      </Show>

      <Show when={props.glyph.runShape.length > 0}>
        <Section
          title={t("Run shape")}
          note={t("how long a run of it gets, and whether the run is only this character")}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{t("Run")}</TableHeader>
                <TableHeader class="text-end">{t("Count")}</TableHeader>
                <TableHeader class="text-end">{t("Share")}</TableHeader>
                <TableHeader class="text-end">{t("Flagged")}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={props.glyph.runShape}>
                {(row) => (
                  <TableRow>
                    <TableCell class="font-medium">
                      {row.label}
                      <Show when={row.clusters.length > 0}>
                        <span class="flex flex-wrap gap-1 pt-1">
                          <For each={row.clusters}>
                            {(cluster) => (
                              <code
                                class={cx(
                                  "rounded-xs bg-surface-secondary px-1 text-smallest font-normal",
                                  cluster.recurring
                                    ? "text-on-surface-tertiary"
                                    : "text-on-surface-primary",
                                )}
                              >
                                {cluster.text} ×{cluster.count}
                              </code>
                            )}
                          </For>
                        </span>
                      </Show>
                      {usualLine(row)}
                    </TableCell>
                    {fraction(row)}
                    <TableCell class="text-end">{sitesButton(row)}</TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </Section>
      </Show>

      <Show when={props.glyph.other.length > 0}>
        <Section
          title={t("Other signals")}
          note={t("rarity in the corpus, letter runs, and what follows it at a sentence start")}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{t("Signal")}</TableHeader>
                <TableHeader>{t("Channel")}</TableHeader>
                <TableHeader class="text-end">{t("Count")}</TableHeader>
                <TableHeader class="text-end">{t("Share")}</TableHeader>
                <TableHeader class="text-end">{t("Flagged")}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <For each={props.glyph.other}>
                {(row) => (
                  <TableRow>
                    <TableCell class="font-medium">
                      {row.label}
                      {usualLine(row)}
                    </TableCell>
                    <TableCell class="font-mono text-smallest text-on-surface-tertiary">
                      {row.channel}
                    </TableCell>
                    {fraction(row)}
                    <TableCell class="text-end">{sitesButton(row)}</TableCell>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </Section>
      </Show>

      <Section
        title={t("Flagged sites")}
        note={t("{count} of {total} shown", {
          count: sites().length,
          total: props.glyph.flagged.length,
        })}
      >
        <Show when={props.pattern !== undefined}>
          <div class="flex flex-wrap items-center gap-2 rounded-md bg-surface-secondary px-3 py-2">
            <span class="text-smallest text-on-surface-secondary">
              {t("Narrowed to one pattern.")}
            </span>
            <Button size="sm" variant="tertiary" onClick={() => props.onPattern(undefined)}>
              {t("Show all sites")}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              class="ms-auto"
              icon={<ExternalLink />}
              onClick={() => openInFindings()}
            >
              {t("Open this channel in Findings")}
            </Button>
          </div>
        </Show>

        <Show
          when={sites().length > 0}
          fallback={
            <p class="rounded-md border border-dashed border-surface-border px-3 py-4 text-center text-smallest text-on-surface-tertiary">
              {t("The engine flagged no site for this character.")}
            </p>
          }
        >
          <ul class="divide-y divide-surface-border rounded-md border border-surface-border">
            <For each={sites()}>
              {(site) => {
                // Untracked on purpose: a one-time read, not a dependency (Solid 2: STRICT_READ_UNTRACKED).
                const quoted = createMemo(() => excerpt(site), { name: "siteExcerpt" });
                return (
                  <li class="flex flex-wrap items-center gap-2 px-3 py-2" data-site={site.from}>
                    <strong class="text-small font-semibold text-on-surface-primary">
                      {where(site)}
                    </strong>
                    <For each={site.reasons}>
                      {(reason) => <Badge tone="warning">{reason}</Badge>}
                    </For>
                    <Show when={stale(site)}>
                      <Badge tone="muted">{t("stale")}</Badge>
                    </Show>
                    <Show when={!quoted().projected}>
                      <Badge tone="muted">{t("in markup")}</Badge>
                    </Show>
                    <span
                      class={cx(
                        "w-full min-w-0 truncate text-small text-on-surface-secondary sm:w-auto sm:flex-1",
                        quoted().projected ? "font-scripture" : "font-mono text-smallest",
                      )}
                      data-projected={quoted().projected ? "true" : "false"}
                    >
                      {quoted().before}
                      <mark class="rounded-xs bg-surface-warning px-0.5 text-on-surface-warning">
                        {quoted().hit}
                      </mark>
                      {quoted().after}
                    </span>
                    <Button size="sm" variant="tertiary" onClick={() => go(site)}>
                      {t("Go")}
                    </Button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </Section>
    </Card>
  );
}
