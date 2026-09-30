/**
 * A magnifying glass that shows what a finding's sentence is comparing: every
 * place the form HERE occurs, beside every place the project writes the form
 * it USUALLY writes instead — "“',” 4 times; the other way round, “,'”, 171
 * times" as two lists you can read.
 *
 * Find is a core module (`src/core/search`), not a screen, so this asks it
 * directly instead of navigating to `/find` and losing its place. The two
 * queries come from the finding (`Finding.comparison`, `core/findings/
 * compare.ts`), case-sensitive always. WHAT is searched is the reader's global
 * mode, the same one the editor shows: the reading in Regular
 * (`findInReading`), the markup in USFM (`find`). Each hit is its place and
 * its line, wrapped rather than cut; a hit opens in the editor.
 *
 * The searches run when the dialog OPENS, and the mask maps they build die
 * when it closes, for the reason `createReadings` gives: nothing holds a
 * second copy of the project for a question nobody is asking any more.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Option, Result } from "effect";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { Comparison, Probe, Touch } from "#core/findings/compare";
import { createReadings, type Readings } from "#core/search/reading";
import * as Search from "#core/search/search";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Dialog, IconButton, cx } from "../primitives";

/** How many hits a column lists. The count is always the whole answer. */
const SHOWN = 200;

/** Room to wrap: most verses are one line of this or less, so most show whole. */
const PREVIEW_WIDTH = 400;

const touchName = (touch: Touch): string => {
  if (touch === "letter") return t("a letter");
  if (touch === "space") return t("a space");
  if (touch === "digit") return t("a digit");
  return t("a punctuation mark");
};

/** A probe as a reader recognises it: “,'”, or “,” before a letter. */
const named = (probe: Probe): string => {
  const shown = probe.shown;
  if (shown.kind === "text") return `“${shown.text}”`;
  return shown.side === "before"
    ? t("“{glyph}” before {touch}", { glyph: shown.glyph, touch: touchName(shown.touch) })
    : t("“{glyph}” after {touch}", { glyph: shown.glyph, touch: touchName(shown.touch) });
};

export function SearchDialog(props: { readonly comparison: Comparison }) {
  const [open, setOpen] = createSignal(false, { name: "searchDialogOpen" });

  return (
    <>
      <IconButton
        size="sm"
        label={t("Search the project for {form}", { form: named(props.comparison.here) })}
        icon={<SearchIcon />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      />
      <Dialog
        open={open()}
        onOpenChange={setOpen}
        title={
          props.comparison.usual === undefined
            ? t("{form} in the project", { form: named(props.comparison.here) })
            : t("{here} and {usual} in the project", {
                here: named(props.comparison.here),
                usual: named(props.comparison.usual),
              })
        }
        class={props.comparison.usual === undefined ? "w-[min(56rem,92vw)]" : "w-[min(90rem,95vw)]"}
      >
        <Show when={open()}>
          <Results comparison={props.comparison} onGo={() => setOpen(false)} />
        </Show>
      </Dialog>
    </>
  );
}

function Results(props: { readonly comparison: Comparison; readonly onGo: () => void }) {
  const shell = useShell();
  const readings = createReadings(shell.services.galley);
  const usfm = (): boolean => shell.mode() === "usfm";

  return (
    <div class="flex flex-col gap-3">
      <p class="text-smallest text-on-surface-tertiary">
        {usfm() ? t("Searching the USFM.") : t("Searching the text.")}
      </p>
      <div
        class={cx(
          "grid gap-4",
          props.comparison.usual !== undefined &&
            "md:grid-cols-2 md:divide-x md:divide-surface-border",
        )}
      >
        <Column
          heading={t("Here")}
          probe={props.comparison.here}
          readings={readings}
          usfm={usfm()}
          onGo={props.onGo}
        />
        <Show when={props.comparison.usual}>
          {(usual) => (
            <div class="md:ps-4">
              <Column
                heading={t("Usually")}
                probe={usual()}
                readings={readings}
                usfm={usfm()}
                onGo={props.onGo}
              />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

function Column(props: {
  readonly heading: string;
  readonly probe: Probe;
  readonly readings: Readings;
  readonly usfm: boolean;
  readonly onGo: () => void;
}) {
  const shell = useShell();
  const navigate = useNavigate();

  const analysisOf = (id: string) =>
    Option.getOrUndefined(shell.services.projectAnalysis.analysis(id))?.analysis;

  const found = createMemo(
    () => {
      const project = shell.project();
      if (project === undefined) return Result.succeed([]);
      const query: Search.Query = {
        text: props.probe.text,
        caseSensitive: true,
        regex: props.probe.regex === true,
        unicode: props.probe.regex === true,
        wholeWord: props.probe.wholeWord === true,
      };
      const options = { analysisOf, previewWidth: PREVIEW_WIDTH };
      return props.usfm
        ? Search.find(project.books, query, options)
        : Search.findInReading(props.readings, project.books, query, options);
    },
    { name: "searchDialogHits" },
  );

  const hits = (): readonly Search.Hit[] => {
    const held = found();
    return Result.isSuccess(held) ? held.success : [];
  };

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
    <section class="flex min-w-0 flex-col gap-2" data-search-column={props.heading}>
      <h3 class="flex items-baseline gap-2">
        <span class="text-smallest font-medium tracking-wide text-on-surface-tertiary uppercase">
          {props.heading}
        </span>
        <span class="font-medium">{named(props.probe)}</span>
        <span class="ms-auto tabular-nums text-on-surface-secondary">
          {hits().length.toLocaleString()}
        </span>
      </h3>
      <Show
        when={hits().length > 0}
        fallback={<p class="text-small text-on-surface-tertiary">{t("None found.")}</p>}
      >
        <ul class="scrollbar-subtle -mx-2 flex max-h-[62vh] flex-col overflow-y-auto">
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
                  <span class={cx("min-w-0 text-small break-words", props.usfm && "font-mono")}>
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
    </section>
  );
}
