import { Link } from "@tanstack/solid-router";
import Type from "lucide-solid/icons/case-sensitive";
import Search from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal, onCleanup, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { codePointLabel, type Glyph } from "#core/findings/inventory";
import { POOLS, type Pool } from "#core/galley";

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

const LENSES = [
  { value: "all", label: m.inventory_all },
  { value: "flagged", label: m.inventory_flagged },
  { value: "quiet", label: m.inventory_quiet },
] as const;

type Lens = (typeof LENSES)[number]["value"];

const asCodePoint = (query: string): number | undefined => {
  const match = /^(?:u\+)?([0-9a-f]{2,6})$/i.exec(query.trim());
  if (match === null) return undefined;
  const value = Number.parseInt(match[1], 16);
  return Number.isSafeInteger(value) && value <= 0x10ffff ? value : undefined;
};

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

  const held = createMemo(() => shell.inventory(), { name: "inventory" });

  {
    const opening = shell.services.composition.observability.operation("inventory.load");
    const snapshot = untrack(held);
    const facts = {
      "inventory.glyphs": snapshot.glyphs.length,
      "inventory.flagged": snapshot.glyphs.filter((glyph) => glyph.flagged.length > 0).length,
      "inventory.flagged_sites": snapshot.flaggedSites,
      "inventory.patterns": snapshot.patternCount,
      "inventory.word_patterns": snapshot.wordPatterns.length,
      "inventory.books": snapshot.bookCount,
    };
    let after: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      after = setTimeout(() => opening.end("passed", facts), 0);
    });
    onCleanup(() => {
      cancelAnimationFrame(frame);
      if (after !== undefined) clearTimeout(after);
      opening.end("declined", { ...facts, "inventory.painted": false });
    });
  }

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
      <TableCell class="text-end font-mono text-smallest tabular-nums">
        {glyph.population}
      </TableCell>
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
        title={m.common_character_inventory()}
        subtitle={m.inventory_how_this_translation_uses_its()}
        actions={
          <span class="text-small text-on-surface-tertiary" data-inventory-count={shown().length}>
            {m.inventory_characters_characters_flagged_flagged_sites({
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
            title={m.inventory_no_project_is_open()}
            description={m.inventory_the_inventory_is_a_reading()}
            action={
              <Link to="/" class="text-small text-brand hover:underline">
                {m.inventory_open_a_project()}
              </Link>
            }
          />
        }
      >
        <Show
          when={held().bookCount > 0}
          fallback={
            <EmptyState
              title={m.inventory_analyzing()}
              description={m.inventory_the_corpus_has_not_been()}
            />
          }
        >
          <Show
            when={held().glyphs.length > 0}
            fallback={
              <EmptyState
                title={m.inventory_the_publication_measured_no_characters()}
                description={m.inventory_sous_publishes_a_pattern_row({
                  words: held().wordPatterns.length,
                  rows: held().patternCount,
                })}
              />
            }
          >
            <Card class="flex flex-wrap items-center gap-3">
              <Input
                size="sm"
                wrapperClass="w-56"
                icon={<Search />}
                placeholder={m.inventory_a_character_a_name_or()}
                aria-label={m.inventory_filter_characters()}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
              <SegmentedControl<Lens>
                label={m.inventory_show_which_characters()}
                items={LENSES.map((item) => ({ value: item.value, label: item.label() }))}
                value={lens()}
                onChange={(value) => setLens(value)}
              />
              <Select
                size="sm"
                wrapperClass="w-40"
                aria-label={m.inventory_filter_by_pool()}
                value={pool()}
                // SAFETY: the option list below is exactly `POOLS` plus the empty "every pool" value, so a native select can only ever report one of those strings back.
                onChange={(event) => setPool(event.currentTarget.value as Pool | "")}
              >
                <option value="">{m.inventory_every_pool()}</option>
                <For each={POOLS}>{(name) => <option value={name}>{name}</option>}</For>
              </Select>
              <span class="ms-auto text-smallest text-on-surface-tertiary">
                {m.inventory_shown_of_total_shown({
                  shown: shown().length,
                  total: held().glyphs.length,
                })}
              </span>

              <p class="w-full text-smallest text-on-surface-tertiary">
                {m.inventory_these_are_the_characters_the()}
              </p>
            </Card>

            <div class="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
              <Card padded={false} class="overflow-hidden xl:sticky xl:top-6">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeader>{m.inventory_character()}</TableHeader>
                      <TableHeader
                        class="text-end"
                        title={m.inventory_the_largest_population_any_of()}
                      >
                        {m.inventory_sites()}
                      </TableHeader>
                      <TableHeader class="text-end">{m.common_books()}</TableHeader>
                      <TableHeader class="text-end">{m.inventory_flagged()}</TableHeader>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <For each={shown()}>{row}</For>
                  </TableBody>
                </Table>
                <Show when={shown().length === 0}>
                  <p class="px-4 py-8 text-center text-small text-on-surface-tertiary">
                    {m.inventory_no_character_matches_this_filter()}
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
                  {m.inventory_not_shown_here_count_word({
                    count: held().wordPatterns.length,
                  })}
                </strong>
                <p class="text-smallest text-on-surface-tertiary">
                  {m.inventory_casing_word_length_and_doubled()}
                </p>
              </Card>
            </Show>
          </Show>
        </Show>
      </Show>
    </main>
  );
}
