import { Show } from "solid-js";

import { t } from "#app/i18n";
import { Card, Input, SegmentedControl } from "#app/ui/primitives";

import type { FindExpect } from "./createFindExpect";
import type { Expected, FindSearch } from "./helpers";

export interface FindExpectCardProps {
  readonly params: () => FindSearch;
  readonly ask: (next: FindSearch) => void;
  readonly expect: FindExpect;
}

export function FindExpectCard(props: FindExpectCardProps) {
  return (
    <Card data-tour="find-expect">
      <div class="flex flex-wrap items-center gap-3">
        <Input
          aria-label={t("Expected in your text")}
          wrapperClass="w-64"
          placeholder={t("Expected in your text, e.g. Yesu")}
          value={props.params().expect ?? ""}
          onChange={(event) => props.ask({ expect: event.currentTarget.value.trim() || undefined })}
          onKeyDown={(event) => {
            if (event.key === "Enter")
              props.ask({ expect: event.currentTarget.value.trim() || undefined });
          }}
        />
        <Show
          when={props.expect.expectation()}
          fallback={
            <span class="text-small text-on-surface-tertiary">
              {t(
                "Where the source matched, what should your text say? Sefer shows the verses that do not say it.",
              )}
            </span>
          }
        >
          {(split) => (
            <div data-tour="find-expect-split">
              <SegmentedControl<Expected>
                label={t("Which verses to show")}
                items={[
                  {
                    value: "without",
                    label: t("Without it ({count})", { count: split().missing.length }),
                  },
                  {
                    value: "with",
                    label: t("With it ({count})", { count: split().has.length }),
                  },
                  { value: "all", label: t("All") },
                ]}
                value={props.expect.showing()}
                onChange={(show) => props.ask({ show })}
              />
            </div>
          )}
        </Show>
      </div>
    </Card>
  );
}
