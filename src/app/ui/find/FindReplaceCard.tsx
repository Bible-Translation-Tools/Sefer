import { Show } from "solid-js";

import { t } from "#app/i18n";
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
    if (props.scope() === "book") return t("this book");
    return props.scope() === "project" ? t("the project") : t("the chosen books");
  };

  return (
    <Card>
      <div class="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t("Replace with")}
          placeholder={t("Replace with (literal text)")}
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
          {t("Preview Replace all")}
        </Button>
      </div>
      <Show when={props.results.preview()} keyed>
        {(held) => (
          <div class="mt-3 space-y-2 text-small">
            <p>
              {t("Replace {count} match(es) in {books} book(s) within {scope}.", {
                count: held.hits.length,
                books: new Set(held.hits.map((hit) => hit.bookId)).size,
                scope: scopeLabel(),
              })}
            </p>
            <p class="text-on-surface-secondary">
              {t("Replacement is literal text: {replacement}", {
                replacement: held.insert === "" ? t("(delete matches)") : held.insert,
              })}
            </p>
            <div class="flex gap-2">
              <Button variant="primary" size="sm" onClick={props.replace.applyReplace}>
                {t("Apply Replace all")}
              </Button>
              <Button size="sm" onClick={() => props.results.setPreview(undefined)}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        )}
      </Show>
    </Card>
  );
}
