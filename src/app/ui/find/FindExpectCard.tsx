import { Show } from "solid-js";

import { m } from "#app/paraglide/messages";
import { Card, Input, SegmentedControl } from "#app/ui/primitives";

import type { FindExpect } from "./createFindExpect";
import type { Expected, FindSearch } from "./helpers";

export interface FindExpectCardProps {
  readonly params: () => FindSearch;
  readonly updateSearch: (next: FindSearch) => void;
  readonly expect: FindExpect;
}

export function FindExpectCard(props: FindExpectCardProps) {
  return (
    <Card data-tour="find-expect">
      <div class="flex flex-wrap items-center gap-3">
        <Input
          aria-label={m.find_expected_in_your_text()}
          wrapperClass="w-64"
          placeholder={m.find_expected_in_your_text_e()}
          value={props.params().expect ?? ""}
          onChange={(event) =>
            props.updateSearch({ expect: event.currentTarget.value.trim() || undefined })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter")
              props.updateSearch({ expect: event.currentTarget.value.trim() || undefined });
          }}
        />
        <Show
          when={props.expect.expectation()}
          fallback={
            <span class="text-small text-on-surface-tertiary">
              {m.find_where_the_source_matched_what()}
            </span>
          }
        >
          {(split) => (
            <div data-tour="find-expect-split">
              <SegmentedControl<Expected>
                label={m.find_which_verses_to_show()}
                items={[
                  {
                    value: "without",
                    label: m.find_without_it_count({ count: split().missing.length }),
                  },
                  {
                    value: "with",
                    label: m.find_with_it_count({ count: split().has.length }),
                  },
                  { value: "all", label: m.find_all() },
                ]}
                value={props.expect.showing()}
                onChange={(show) => props.updateSearch({ show })}
              />
            </div>
          )}
        </Show>
      </div>
    </Card>
  );
}
