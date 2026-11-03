import { useNavigate } from "@tanstack/solid-router";
import { Option } from "effect";
import ExternalLink from "lucide-solid/icons/external-link";
import { For, Show, createMemo } from "solid-js";

import { m } from "#app/paraglide/messages";
import { quote, type Quotation } from "#core/excerpts/excerpts";
import {
  codePointLabel,
  type FlaggedSite,
  type Glyph,
  type PatternRow,
} from "#core/findings/inventory";

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
      return m.inventory_book_offset_from({ book: site.bookId, from: site.from });
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
        {m.inventory_count_sites({ count: row.flagged })}
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
              {m.inventory_sites_sites_books_of_total({
                sites: props.glyph.population,
                books: props.glyph.books,
                total: props.bookCount,
              })}
            </span>
            <Show when={props.glyph.flagged.length > 0}>
              <Badge tone="warning">
                {m.inventory_count_flagged({ count: props.glyph.flagged.length })}
              </Badge>
            </Show>
          </span>
        }
      />

      <Show when={props.glyph.neighbours.length > 0}>
        <Section
          title={m.inventory_what_sits_beside_it()}
          note={m.inventory_the_character_or_the_class()}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{m.inventory_neighbour()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_count()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_share()}</TableHeader>
                <TableHeader class="text-end">{m.common_books()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_flagged()}</TableHeader>
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
                          {row.channel === "ExactNeighbor"
                            ? m.inventory_exactly()
                            : m.inventory_any_of_the_pool()}
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
          title={m.inventory_how_it_attaches_to_words()}
          note={placementUsual() || m.inventory_what_class_of_character_the()}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{m.inventory_class()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_before()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_share()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_after()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_share()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_flagged()}</TableHeader>
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
        <Section title={m.inventory_run_shape()} note={m.inventory_how_long_a_run_of()}>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{m.inventory_run()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_count()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_share()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_flagged()}</TableHeader>
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
          title={m.inventory_other_signals()}
          note={m.inventory_rarity_in_the_corpus_letter()}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>{m.inventory_signal()}</TableHeader>
                <TableHeader>{m.inventory_check()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_count()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_share()}</TableHeader>
                <TableHeader class="text-end">{m.inventory_flagged()}</TableHeader>
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
        title={m.inventory_flagged_sites()}
        note={m.inventory_count_of_total_shown({
          count: sites().length,
          total: props.glyph.flagged.length,
        })}
      >
        <Show when={props.pattern !== undefined}>
          <div class="flex flex-wrap items-center gap-2 rounded-md bg-surface-secondary px-3 py-2">
            <span class="text-smallest text-on-surface-secondary">
              {m.inventory_narrowed_to_one_pattern()}
            </span>
            <Button size="sm" variant="tertiary" onClick={() => props.onPattern(undefined)}>
              {m.inventory_show_all_sites()}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              class="ms-auto"
              icon={<ExternalLink />}
              onClick={() => openInFindings()}
            >
              {m.inventory_open_this_channel_in_findings()}
            </Button>
          </div>
        </Show>

        <Show
          when={sites().length > 0}
          fallback={
            <p class="rounded-md border border-dashed border-surface-border px-3 py-4 text-center text-smallest text-on-surface-tertiary">
              {m.inventory_the_engine_flagged_no_site()}
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
                      <Badge tone="muted">{m.inventory_stale()}</Badge>
                    </Show>
                    <Show when={!quoted().projected}>
                      <Badge tone="muted">{m.inventory_in_markup()}</Badge>
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
                      {m.inventory_go()}
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
