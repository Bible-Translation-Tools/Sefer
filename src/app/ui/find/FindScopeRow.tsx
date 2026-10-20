import { bookName } from "@sefer/text/location/canon";
import ChevronDownIcon from "lucide-solid/icons/chevron-down";
import ChevronUpIcon from "lucide-solid/icons/chevron-up";
import { Show } from "solid-js";

import { t } from "#app/i18n";
import type { useShell } from "#app/ProjectContext";
import { BookScope, IconButton, Switch } from "#app/ui/primitives";
import { metadataOf } from "#app/ui/workspace/project";
import type { Occurrence } from "#core/excerpts/excerpts";

import type { FindBooks } from "./createFindBooks";
import type { FindExpect } from "./createFindExpect";
import type { FindResults } from "./createFindResults";
import type { FindSources } from "./createFindSources";
import type { FindSearch, Scope } from "./helpers";

export interface FindScopeRowProps {
  readonly shell: ReturnType<typeof useShell>;
  readonly scope: () => Scope;
  readonly ask: (next: FindSearch) => void;
  readonly books: FindBooks;
  readonly sources: FindSources;
  readonly expect: FindExpect;
  readonly results: FindResults;
  readonly feedHits: () => readonly Occurrence[];
  readonly step: (delta: 1 | -1) => void;
}

export function FindScopeRow(props: FindScopeRowProps) {
  return (
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <BookScope
        value={props.books.bookScope()}
        onChange={(next) => props.ask({ scope: next })}
        books={props.books.projectBooks().map((id) => ({
          id,
          name: bookName(id, metadataOf(props.shell.project())),
        }))}
        custom={props.books.custom()}
        onCustom={props.books.setCustom}
        hasFocused={props.books.focusedBook() !== undefined}
        disabled={props.scope() === "reference" || props.scope() === "helps"}
      />
      <div class="flex items-center gap-3" data-tour="find-reference">
        <props.sources.source.Picker />
        <Switch
          label={t("Search the source text")}
          checked={props.scope() === "reference"}
          disabled={!props.sources.hasReference()}
          onChange={(on) => props.ask({ scope: on ? "reference" : "project" })}
        />
        <Show when={props.scope() === "reference"}>
          <span data-tour="find-expect-toggle">
            <Switch
              label={t("Expect…")}
              checked={props.expect.expectShown()}
              onChange={props.expect.toggleExpect}
            />
          </span>
        </Show>
        <Show when={props.sources.searchable().length > 0}>
          <span data-tour="find-helps">
            <Switch
              label={t("Search {title}", { title: props.sources.helpsTitle() })}
              checked={props.scope() === "helps"}
              onChange={(on) => props.ask({ scope: on ? "helps" : "project" })}
            />
          </span>
        </Show>
      </div>
      <div class="ms-auto flex items-center gap-1">
        <Show
          when={
            props.scope() === "helps" && props.results.helpHits().length !== props.feedHits().length
          }
        >
          <span class="text-smallest tabular-nums text-on-surface-tertiary">
            {t("{count} in {title}", {
              count: props.results.helpHits().length,
              title: props.sources.helpsTitle(),
            })}
          </span>
        </Show>
        <Show
          when={
            props.scope() === "reference" &&
            props.results.referenceHits().length !== props.feedHits().length
          }
        >
          <span class="text-smallest tabular-nums text-on-surface-tertiary">
            {t("{count} in the reference", { count: props.results.referenceHits().length })}
          </span>
        </Show>
        <span
          class="text-small tabular-nums text-on-surface-tertiary"
          data-count={props.feedHits().length}
        >
          {props.feedHits().length === 0
            ? t("0 results")
            : t("{at}/{total}", {
                at: props.results.cursor() + 1,
                total: props.feedHits().length,
              })}
        </span>
        <IconButton
          size="sm"
          label={t("Previous match")}
          icon={<ChevronUpIcon />}
          disabled={props.feedHits().length === 0}
          onClick={() => props.step(-1)}
        />
        <IconButton
          size="sm"
          label={t("Next match")}
          icon={<ChevronDownIcon />}
          disabled={props.feedHits().length === 0}
          onClick={() => props.step(1)}
        />
      </div>
    </div>
  );
}
