import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import { Button, Card, Input } from "#app/ui/primitives";

import type { FindReplace } from "./createFindReplace";
import type { FindResults } from "./createFindResults";
import type { Scope } from "./helpers";

export interface FindReplaceCardProps {
  readonly scope: () => Scope;
  readonly results: FindResults;
  readonly replace: FindReplace;
}

export function FindReplaceCard(props: FindReplaceCardProps) {
  const scopeLabel = (): string => {
    if (props.scope() === "book") return m.find_this_book();
    return props.scope() === "project" ? m.find_the_project() : m.find_the_chosen_books();
  };

  return (
    <Card>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          aria-label={m.find_replace_with()}
          placeholder={m.find_replace_with_literal_text()}
          value={props.replace.replacement()}
          onInput={(event) => {
            props.replace.setReplacement(event.currentTarget.value);
            props.results.setPreview(undefined);
          }}
        />
        <Button
          size="sm"
          disabled={props.results.hits().length === 0}
          onClick={props.replace.previewReplace}
        >
          {m.find_preview_replace_all()}
        </Button>
      </div>
      <Show when={props.results.preview()} keyed>
        {(held) => (
          <div class="mt-3 space-y-2 text-small">
            <p>
              {m.find_replace_count_matches_in({
                count: held.hits.length,
                books: new Set(held.hits.map((hit) => hit.bookId)).size,
                scope: scopeLabel(),
              })}
            </p>
            <p class="text-on-surface-secondary">
              {m.find_replacement_is_literal_text_replacement({
                replacement: held.insert === "" ? m.find_delete_matches() : held.insert,
              })}
            </p>
            <div class="flex gap-2">
              <Button variant="primary" size="sm" onClick={props.replace.applyReplace}>
                {m.find_apply_replace_all()}
              </Button>
              <Button size="sm" onClick={() => props.results.setPreview(undefined)}>
                {m.common_cancel()}
              </Button>
            </div>
          </div>
        )}
      </Show>
    </Card>
  );
}
