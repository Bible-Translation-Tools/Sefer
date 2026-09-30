/**
 * A magnifying glass that shows what a finding's sentence is comparing: every
 * place the form HERE occurs, beside every place of what else the sentence
 * names — "“'.” 4 times; the other way round, “.'”, 171 times" as lists you
 * can read.
 *
 * The queries are kitchen's (`Finding.comparison`, `core/findings/
 * compare.ts`; `sous-messages.md`, "Queries"), one column per purpose
 * present: `this` (here), `alternative` (instead), `others` (usually). The
 * dialog knows nothing about which rule wrote them. A literal goes to the
 * engine's own find (`GalleyService.findAll`, targets only), with the
 * query's case and whole-word flags; a regex runs over each book's verse-text
 * reading (`findInReading`). Both search the text with the markers out, so a
 * hit's preview reads as the reader sees it. Each hit is its place and its
 * line, wrapped rather than cut; a hit opens in the editor.
 *
 * The searches run when the dialog OPENS, and the mask maps they build die
 * when it closes, for the reason `createReadings` gives: nothing holds a
 * second copy of the project for a question nobody is asking any more.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import type {
  FindingQuery,
  FindingQueryClass,
  FindingQueryPart,
  FindingQueryPurpose,
} from "#core/galley";
import { createReadings, type Readings } from "#core/search/reading";
import * as Search from "#core/search/search";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Dialog, IconButton, Kbd, cx } from "../primitives";

/** How many hits a query lists. The count is always the whole answer. */
const SHOWN = 200;

/** Room to wrap: most verses are one line of this or less, so most show whole. */
const PREVIEW_WIDTH = 400;

const PURPOSES: readonly FindingQueryPurpose[] = ["this", "alternative", "others"];

const heading = (purpose: FindingQueryPurpose): string => {
  if (purpose === "this") return t("Here");
  if (purpose === "alternative") return t("Instead");
  return t("Usually");
};

/**
 * A mark as itself, or as its `\u{…}` escape where it would not show (a
 * space, a control, a format character).
 */
const visible = (escape: string, hex: string): string => {
  const mark = String.fromCodePoint(Number.parseInt(hex, 16));
  return /^[\p{L}\p{M}\p{N}\p{P}\p{S}]$/u.test(mark) ? mark : escape;
};

/** The query's whole text: the needle, or the regex with its escapes drawn. */
const source = (query: FindingQuery): string =>
  query.kind === "literal" ? query.needle : query.source.replace(/\\u\{([0-9a-f]+)\}/giu, visible);

/** A query as people read it: kitchen's shape, exact text and named classes. */
const partsOf = (query: FindingQuery): readonly FindingQueryPart[] =>
  query.kind === "literal" ? [{ text: query.needle }] : query.shape;

const classWord = (name: FindingQueryClass): string => {
  switch (name) {
    case "letter":
      return t("a letter");
    case "digit":
      return t("a digit");
    case "space":
      return t("a space");
    case "punctuation":
      return t("a punctuation mark");
    case "capital":
      return t("a capital");
    case "lowercase":
      return t("a lowercase letter");
  }
};

/** The shape as one line of plain text: `“?” + a capital`. */
const plain = (query: FindingQuery): string =>
  partsOf(query)
    .map((part) => ("text" in part ? `“${part.text}”` : classWord(part.class)))
    .join(" + ");

/** The shape drawn: exact text as keycaps, a class as its words. */
function Shape(props: { readonly query: FindingQuery }) {
  return (
    <span class="inline-flex flex-wrap items-baseline gap-1">
      <For each={partsOf(props.query)}>
        {(part) =>
          "text" in part ? (
            <Kbd>{part.text}</Kbd>
          ) : (
            <span class="text-small text-on-surface-secondary italic">{classWord(part.class)}</span>
          )
        }
      </For>
    </span>
  );
}

// TODO(merge): revisit with Will — queries now drive SearchDialog/comparisonOf; decide whether the dialog stays generic Query[] and whether the probe fallback can go.
export function SearchDialog(props: { readonly queries: readonly FindingQuery[] }) {
  const [open, setOpen] = createSignal(false, { name: "searchDialogOpen" });

  const columns = createMemo(
    () =>
      PURPOSES.flatMap((purpose) => {
        const queries = props.queries.filter((query) => query.purpose === purpose);
        return queries.length === 0 ? [] : [{ purpose, queries }];
      }),
    { name: "searchDialogColumns" },
  );

  const form = (): string => {
    const here = props.queries.find((query) => query.purpose === "this");
    return here === undefined ? "" : plain(here);
  };

  return (
    <>
      <IconButton
        size="sm"
        label={t("Search the project for {form}", { form: form() })}
        icon={<SearchIcon />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        title={t("{form} in the project", { form: form() })}
        class={columns().length > 1 ? "w-[min(90rem,95vw)]" : "w-[min(56rem,92vw)]"}
      >
        <Show when={open()}>
          <Results columns={columns()} onGo={() => setOpen(false)} />
        </Show>
      </Dialog>
    </>
  );
}

interface ColumnOf {
  readonly purpose: FindingQueryPurpose;
  readonly queries: readonly FindingQuery[];
}

function Results(props: { readonly columns: readonly ColumnOf[]; readonly onGo: () => void }) {
  const shell = useShell();
  const readings = createReadings(shell.services.galley);

  return (
    <div
      class={cx(
        "grid gap-4 md:divide-x md:divide-surface-border",
        props.columns.length === 2 && "md:grid-cols-2",
        props.columns.length >= 3 && "md:grid-cols-3",
      )}
    >
      <For each={props.columns}>
        {(column) => (
          <section
            class="flex min-w-0 flex-col gap-4 md:not-first:ps-4"
            data-search-column={column.purpose}
          >
            <h3 class="text-smallest font-medium tracking-wide text-on-surface-tertiary uppercase">
              {heading(column.purpose)}
            </h3>
            <For each={column.queries}>
              {(query) => (
                <Hits
                  query={query}
                  share={column.queries.length}
                  readings={readings}
                  onGo={props.onGo}
                />
              )}
            </For>
          </section>
        )}
      </For>
    </div>
  );
}

function Hits(props: {
  readonly query: FindingQuery;
  /** How many queries share the column's height. */
  readonly share: number;
  readonly readings: Readings;
  readonly onGo: () => void;
}) {
  const shell = useShell();
  const navigate = useNavigate();

  const analysisOf = (id: string) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(id))?.analysis;

  const hits = createMemo(
    (): readonly Search.Hit[] => {
      const project = shell.project();
      if (project === undefined) return [];
      const options = { analysisOf, previewWidth: PREVIEW_WIDTH };
      const query = props.query;
      if (query.kind === "literal") {
        const found = shell.services.galley.findAll(
          { text: query.needle, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord },
          "targets",
        );
        return Search.fromEngine(props.readings, project.books, found, options);
      }
      const held = Search.findInReading(
        props.readings,
        project.books,
        { text: query.source, regex: true, unicode: query.flags === "u", caseSensitive: true },
        options,
      );
      return Result.isSuccess(held) ? held.success : [];
    },
    { name: "searchDialogHits" },
  );

  const place = (hit: Search.Hit): string =>
    hit.address === undefined ? hit.bookId : shell.location.label(hit.address);

  /** Aim, then open — the order every "go to this place" here uses. */
  const go = (hit: Search.Hit): void => {
    shell.aim(hit.bookId, hit.from, hit.to);
    props.onGo();
    void navigate({
      to: "/project/$slug/book/$book",
      params: { slug: shell.slug(), book: encodeURIComponent(hit.bookId) },
    });
  };

  return (
    <div class="flex min-w-0 flex-col gap-2">
      <p class="flex items-baseline gap-2">
        <span class="min-w-0 break-all" title={source(props.query)}>
          <Shape query={props.query} />
        </span>
        <Show when={props.query.kind === "literal" && props.query.wholeWord}>
          <span class="text-smallest text-on-surface-tertiary">{t("whole word")}</span>
        </Show>
        <span class="ms-auto tabular-nums text-on-surface-secondary">
          {hits().length.toLocaleString()}
        </span>
      </p>
      <Show
        when={hits().length > 0}
        fallback={<p class="text-small text-on-surface-tertiary">{t("None found.")}</p>}
      >
        <ul
          class="scrollbar-subtle -mx-2 flex flex-col overflow-y-auto"
          style={{ "max-height": `calc(62vh / ${props.share})` }}
        >
          <For each={hits().slice(0, SHOWN)}>
            {(hit) => (
              <li>
                <button
                  type="button"
                  class="grid w-full cursor-pointer grid-cols-[7rem_1fr] gap-3 rounded-md px-2 py-1.5 text-start hover:bg-surface-secondary"
                  onClick={() => go(hit)}
                >
                  <span class="text-smallest font-medium text-on-surface-secondary">
                    {place(hit)}
                  </span>
                  <span class="min-w-0 text-small break-words">
                    {hit.preview.slice(0, hit.previewMatch.from)}
                    <mark class="rounded-xs bg-surface-highlight px-0.5 text-on-surface-highlight">
                      {hit.preview.slice(hit.previewMatch.from, hit.previewMatch.to)}
                    </mark>
                    {hit.preview.slice(hit.previewMatch.to)}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
        <Show when={hits().length > SHOWN}>
          <p class="text-smallest text-on-surface-tertiary">
            {t("The first {shown} of {count}.", {
              shown: SHOWN,
              count: hits().length.toLocaleString(),
            })}
          </p>
        </Show>
      </Show>
    </div>
  );
}
