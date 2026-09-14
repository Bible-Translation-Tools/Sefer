/**
 * One character, in full: what the publication measured about it, and every
 * site it was flagged at.
 *
 * The sections are the engine's own channels, renamed into questions a
 * translator can answer — "what sits beside it", "how it attaches to words",
 * "run shape" — because `PooledNeighbor` and `Placement` are the vocabulary of
 * the thing that counted, not of the person reading. Nothing is scored and
 * nothing is ranked against a target: every row is a fraction the engine
 * published, and every flagged site is a verse you can open.
 *
 * A row's "sites" button is the whole point of joining the two halves. A
 * pattern is a claim about the corpus; the convictions that named it are where
 * that claim landed. Pressing it filters the list below to exactly those, and
 * the secondary link hands the same question to `/findings`, which owns
 * cross-book reading.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Option } from "effect";
import ExternalLink from "lucide-solid/icons/external-link";
import { For, Show, createMemo } from "solid-js";

import {
  codePointLabel,
  siteRef,
  type FlaggedSite,
  type Glyph,
  type PatternRow,
} from "../../../core/findings/inventory";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Button,
  Card,
  PanelHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives";
import { GlyphTile } from "./GlyphTile";

/** Basis points as a percentage. `0.02%` is a real answer; `0%` is not. */
export const share = (bp: number): string => `${(bp / 100).toFixed(2)}%`;

/** How much text either side of the span the excerpt shows. */
const BEFORE = 26;
const AFTER = 34;

/**
 * A one-line quotation around a span, in three parts so the flagged character
 * can be marked in place. The newlines are flattened so a row stays a row, and
 * the markup is left in: these are offsets into canonical USFM, and hiding the
 * markers would move the character away from what the engine actually saw.
 *
 * Display only — the offsets a "Go" navigates by are the engine's, untouched.
 */
const excerptAt = (
  text: string,
  from: number,
  to: number,
): { readonly before: string; readonly hit: string; readonly after: string } => {
  const start = Math.max(0, from - BEFORE);
  const end = Math.min(text.length, to + AFTER);
  const flat = (part: string): string => part.replace(/\s+/g, " ");
  return {
    before: `${start > 0 ? "…" : ""}${flat(text.slice(start, from))}`,
    hit: flat(text.slice(from, to)),
    after: `${flat(text.slice(to, end))}${end < text.length ? "…" : ""}`,
  };
};

/** What the excerpt reads when the book is no longer in the open Project. */
const ABSENT = { before: "", hit: "", after: "" } as const;

/** A section that draws nothing when the engine measured nothing. */
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
  /** Books in the publication — the denominator of a glyph's book spread. */
  readonly bookCount: number;
  /** The pattern the flagged list is narrowed to, or `undefined` for all. */
  readonly pattern: number | undefined;
  readonly onPattern: (pattern: number | undefined) => void;
}

export function GlyphDetail(props: GlyphDetailProps) {
  const shell = useShell();
  const navigate = useNavigate();

  const pooled = (): boolean => props.glyph.char === "";

  /**
   * The site quoted from the book's canonical text, read straight off the
   * Project's seat — whichever Book holds it, plain or editor-backed. Nothing
   * here subscribes: `tick()` is the shell's one signal over the Books and the
   * excerpt re-reads with it, exactly as every other derived screen does.
   */
  const excerpt = (site: FlaggedSite) => {
    shell.tick();
    const text = shell.project()?.book(site.bookId)?.source().text;
    return text === undefined ? ABSENT : excerptAt(text, site.from, site.to);
  };

  const analysisOf = (bookId: string) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(bookId));

  /**
   * Book and reference, from the analysis the site was measured against.
   * `siteRef` fills the chapter and verse in only when the engine stamps
   * agree, so a book that has moved on since the publication reads as an
   * offset rather than as a verse it may no longer be.
   */
  const where = (site: FlaggedSite): string => {
    const ref = siteRef(site, analysisOf(site.bookId)?.analysis);
    if (ref === undefined)
      return t("{book} · offset {from}", { book: site.bookId, from: site.from });
    return `${ref.book} ${ref.chapter}${ref.verse === undefined ? "" : `:${ref.verse}`}`;
  };

  /** Has the book moved on since the publication measured this site? */
  const stale = (site: FlaggedSite): boolean => {
    shell.tick();
    const book = shell.project()?.book(site.bookId);
    return book === undefined || book.source().stamp.revision !== site.stamp.revision;
  };

  /**
   * Aim, then open — the order `FindingsPanel` uses, and for its reason: the
   * book route reads the aim to choose the opening clip and the editor
   * surface scrolls to it.
   */
  const go = (site: FlaggedSite): void => {
    const project = shell.project();
    if (project === undefined) return;
    shell.aim(site.bookId, site.from);
    void navigate({
      to: "/project/$id/book/$book",
      params: {
        id: encodeURIComponent(project.root),
        book: encodeURIComponent(site.bookId),
      },
    });
  };

  /**
   * The same question, handed to the panel that reads across books.
   *
   * Through the router, never an `<a href>`: a full load rebuilds the shell
   * and the open Project goes with it. `/findings` does not validate a `code`
   * today — it ignores what it does not know — so this is a link that gets
   * better when that route grows the parameter, and is harmless until then.
   */
  const openInFindings = (): void => {
    const channel = props.glyph.rows.find((row) => row.pattern === props.pattern)?.channel;
    if (channel === undefined) return;
    void navigate({ to: "/findings", search: { code: `sous.convention.${channel}` } });
  };

  const sites = (): readonly FlaggedSite[] =>
    props.pattern === undefined
      ? props.glyph.flagged
      : props.glyph.flagged.filter((site) => site.pattern === props.pattern);

  /** The "show the other sites" control every pattern row carries. */
  const sitesButton = (row: PatternRow) => (
    <Show when={row.flagged > 0} fallback={<span class="text-on-surface-tertiary">—</span>}>
      {/* A toggle, so the state is `aria-pressed` and not a second variant —
          the primitive already paints a pressed button, and swapping variants
          would say the same thing twice. */}
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
          note={t("what class of character the engine found on each side")}
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
                        {/* A ternary, not `<Show>`: `cell` is a plain value
                            the `<For>` above already tracks, and reading a
                            `<Show>` accessor from a child callback's body is
                            an untracked read Solid 2 warns about. */}
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
                    <TableCell class="font-medium">{row.label}</TableCell>
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
                    <TableCell class="font-medium">{row.label}</TableCell>
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
              icon={<ExternalLink size={12} />}
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
                // One slice per row, not three: a memo is legal here — a
                // `<For>` child is an owned scope — and it keeps the read of
                // the Book's text inside a tracking scope.
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
                    <span class="w-full min-w-0 truncate font-scripture text-small text-on-surface-secondary sm:w-auto sm:flex-1">
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
