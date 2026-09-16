/**
 * The character inventory: how this translation actually uses its punctuation,
 * its digits and its symbols, and what stands out.
 *
 * Everything on the page is a read of one value — `ProjectAnalysis.inventory()`,
 * which pivots the last publication's pattern table per code point (see
 * `src/core/findings/inventory.ts`). The page adds a filter, a selection and a
 * layout, and nothing else: no counting, no scoring, no second measurement.
 *
 * Two honesties the layout has to carry.
 *
 * The table is NOT a census of the project's characters. Sous emits a pattern
 * row when a channel had a claim to make, so a character nothing was measured
 * about is simply absent — and on a small corpus that can mean the inventory
 * is only the convicted characters. The subtitle says so rather than letting a
 * short table read as a tidy project.
 *
 * "Occurrences" is a proxy drawn from the largest population any of a glyph's
 * channels judged against. The column header says `sites`, the detail card
 * shows the fraction every number came out of, and a tooltip on the header
 * says the rest.
 */

import { Link } from "@tanstack/solid-router";
import Type from "lucide-solid/icons/case-sensitive";
import Search from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import { codePointLabel, type Glyph } from "../../../core/findings/inventory";
import { POOLS, type Pool } from "../../../core/galley";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import {
  Badge,
  Card,
  EmptyState,
  Input,
  PanelHeader,
  SegmentedControl,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../primitives";
import { GlyphDetail } from "./GlyphDetail";
import { GlyphTile } from "./GlyphTile";

/** The three ways of looking, over one list. Subtractive, like every filter. */
const LENSES = [
  { value: "all", label: "All" },
  { value: "flagged", label: "Flagged" },
  { value: "quiet", label: "Quiet" },
] as const;

type Lens = (typeof LENSES)[number]["value"];

/** `u+201c`, `U+201C`, `201c` — the three ways someone types a code point. */
const asCodePoint = (query: string): number | undefined => {
  const match = /^(?:u\+)?([0-9a-f]{2,6})$/i.exec(query.trim());
  if (match === null) return undefined;
  const value = Number.parseInt(match[1], 16);
  return Number.isSafeInteger(value) && value <= 0x10ffff ? value : undefined;
};

/**
 * Does this glyph answer the query? A typed character matches itself, a `U+`
 * code matches the code point, and anything else matches the name — so both
 * "what does my project do with «" and "what is U+00AB" reach the same row.
 */
const matches = (glyph: Glyph, query: string): boolean => {
  const needle = query.trim();
  if (needle === "") return true;
  if (glyph.char !== "" && needle.includes(glyph.char)) return true;
  const point = asCodePoint(needle);
  if (point !== undefined && point === glyph.codePoint) return true;
  const lower = needle.toLowerCase();
  return (
    glyph.name.toLowerCase().includes(lower) ||
    codePointLabel(glyph.codePoint).toLowerCase().includes(lower)
  );
};

export function InventoryPanel() {
  const shell = useShell();

  const [query, setQuery] = createSignal("", { name: "inventoryQuery" });
  const [lens, setLens] = createSignal<Lens>("all", { name: "inventoryLens" });
  const [pool, setPool] = createSignal<Pool | "">("", { name: "inventoryPool" });
  const [chosen, setChosen] = createSignal<number | undefined>(undefined, {
    name: "inventoryGlyph",
  });
  const [pattern, setPattern] = createSignal<number | undefined>(undefined, {
    name: "inventoryPattern",
  });

  /**
   * The inventory of the last Publication, which is the only time it can
   * differ — it is measured FROM a Publication, so a keystroke cannot change
   * it and `tick` was waking this screen for every one of them.
   */
  const held = createMemo(() => shell.inventory(), { name: "inventory" });

  const shown = createMemo(
    () =>
      held().glyphs.filter(
        (glyph) =>
          matches(glyph, query()) &&
          (pool() === "" || glyph.pool === pool()) &&
          (lens() === "all" ||
            (lens() === "flagged" ? glyph.flagged.length > 0 : glyph.flagged.length === 0)),
      ),
    { name: "inventoryShown" },
  );

  /** The chosen row, or the first one the filter left standing. */
  const selected = (): Glyph | undefined => {
    const rows = shown();
    return rows.find((glyph) => glyph.codePoint === chosen()) ?? rows[0];
  };

  const choose = (glyph: Glyph): void => {
    setChosen(glyph.codePoint);
    setPattern(undefined);
  };

  const row = (glyph: Glyph) => (
    <TableRow
      aria-current={selected()?.codePoint === glyph.codePoint ? "true" : undefined}
      class="cursor-pointer"
      data-glyph-row={glyph.codePoint}
      onClick={() => choose(glyph)}
    >
      <TableCell>
        <span class="flex items-center gap-2.5">
          <GlyphTile char={glyph.char} pooled={glyph.char === ""} />
          <span class="min-w-0">
            <span class="block truncate text-small font-medium">{glyph.name}</span>
            <code class="font-mono text-smallest text-on-surface-tertiary">
              {codePointLabel(glyph.codePoint)}
            </code>
          </span>
        </span>
      </TableCell>
      <TableCell class="text-end font-mono text-smallest tabular-nums">{glyph.sites}</TableCell>
      <TableCell class="text-end font-mono text-smallest whitespace-nowrap tabular-nums text-on-surface-tertiary">
        {glyph.books} / {held().bookCount}
      </TableCell>
      <TableCell class="text-end">
        <Show
          when={glyph.flagged.length > 0}
          fallback={<span class="text-smallest text-on-surface-tertiary">—</span>}
        >
          <Badge tone="warning">{glyph.flagged.length}</Badge>
        </Show>
      </TableCell>
    </TableRow>
  );

  return (
    <main class="min-w-0 space-y-4 p-6">
      <PanelHeader
        title={t("Character inventory")}
        subtitle={t(
          "How this translation uses its punctuation, digits and symbols — and what stands out.",
        )}
        actions={
          <span class="text-small text-on-surface-tertiary" data-inventory-count={shown().length}>
            {t("{characters} characters · {flagged} flagged sites", {
              characters: held().glyphs.length,
              flagged: held().flaggedSites,
            })}
          </span>
        }
      />

      <Show
        when={shell.project() !== undefined}
        fallback={
          <EmptyState
            icon={<Type size={22} />}
            title={t("No project is open.")}
            description={t("The inventory is a reading of one project's whole corpus.")}
            action={
              <Link to="/projects" search={true} class="text-small text-brand hover:underline">
                {t("Open a project")}
              </Link>
            }
          />
        }
      >
        <Show
          when={held().bookCount > 0}
          fallback={
            <EmptyState
              title={t("Analyzing…")}
              description={t(
                "The corpus has not been published yet. The inventory appears with the first whole-corpus publication, a moment after the project opens.",
              )}
            />
          }
        >
          <Show
            when={held().glyphs.length > 0}
            fallback={
              <EmptyState
                title={t("The publication measured no characters.")}
                description={t(
                  "Sous publishes a pattern row only when a channel has a claim to make about a glyph. This corpus produced none — {words} word patterns, {rows} rows in all.",
                  { words: held().wordPatterns.length, rows: held().patternCount },
                )}
              />
            }
          >
            <Card class="flex flex-wrap items-center gap-3">
              <Input
                size="sm"
                wrapperClass="w-56"
                icon={<Search size={13} />}
                placeholder={t("A character, a name, or U+201C")}
                aria-label={t("Filter characters")}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
              <SegmentedControl<Lens>
                size="sm"
                label={t("Show which characters")}
                items={LENSES.map((item) => ({ value: item.value, label: t(item.label) }))}
                value={lens()}
                onChange={(value) => setLens(value)}
              />
              <Select
                size="sm"
                wrapperClass="w-40"
                aria-label={t("Filter by pool")}
                value={pool()}
                // SAFETY: the option list below is exactly `POOLS` plus the
                // empty "every pool" value, so a native select can only ever
                // report one of those strings back.
                onChange={(event) => setPool(event.currentTarget.value as Pool | "")}
              >
                <option value="">{t("Every pool")}</option>
                <For each={POOLS}>{(name) => <option value={name}>{name}</option>}</For>
              </Select>
              <span class="ms-auto text-smallest text-on-surface-tertiary">
                {t("{shown} of {total} shown", {
                  shown: shown().length,
                  total: held().glyphs.length,
                })}
              </span>
              {/* The one sentence the page cannot do without: a short table is
                  not a clean project. Sous emits a pattern row per claim, not
                  per character, so the inventory is what was measured. */}
              <p class="w-full text-smallest text-on-surface-tertiary">
                {t(
                  "These are the characters the engine measured — it publishes a row when a channel has something to say about a glyph, not one per character in the text. “Sites” is the largest population any of a character's channels was judged against, not a count of the text.",
                )}
              </p>
            </Card>

            <div class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <Card padded={false} class="overflow-hidden xl:sticky xl:top-6">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader>{t("Character")}</TableHeader>
                      <TableHeader
                        class="text-end"
                        title={t(
                          "The largest population any of its channels was judged against — a proxy, not a count of the text.",
                        )}
                      >
                        {t("Sites")}
                      </TableHeader>
                      <TableHeader class="text-end">{t("Books")}</TableHeader>
                      <TableHeader class="text-end">{t("Flagged")}</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <For each={shown()}>{row}</For>
                  </TableBody>
                </Table>
                <Show when={shown().length === 0}>
                  <p class="px-4 py-8 text-center text-small text-on-surface-tertiary">
                    {t("No character matches this filter.")}
                  </p>
                </Show>
              </Card>

              <Show when={selected()}>
                {(glyph) => (
                  <GlyphDetail
                    glyph={glyph()}
                    bookCount={held().bookCount}
                    pattern={pattern()}
                    onPattern={(next) => setPattern(next)}
                  />
                )}
              </Show>
            </div>

            <Show when={held().wordPatterns.length > 0}>
              <Card class="space-y-1 text-small text-on-surface-secondary">
                <strong class="font-semibold text-on-surface-primary">
                  {t("Not shown here: {count} word patterns", {
                    count: held().wordPatterns.length,
                  })}
                </strong>
                <p class="text-smallest text-on-surface-tertiary">
                  {t(
                    "Casing, word length and doubled words are judgements about words, not about characters. The engine carries them in the same table; this page keeps them out of it rather than filing them under a character they do not describe.",
                  )}
                </p>
              </Card>
            </Show>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
