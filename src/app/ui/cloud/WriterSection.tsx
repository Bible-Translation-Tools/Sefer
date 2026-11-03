import { useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import { useShell } from "../../ProjectContext";
import { writerWatch } from "../../writerWatch";
import { ago, dated } from "../panels/format";
import { Button } from "../primitives";
import { bookName } from "../workspace/books";
import { metadataOf } from "../workspace/project";

export function WriterSection(props: { readonly onLeave: () => void }) {
  const shell = useShell();
  const navigate = useNavigate();
  const facts = () => writerWatch.facts(shell.project()?.root);
  const quietNote = (): string => {
    const held = facts();
    if (held.checking) return m.cloud_checking_the_writer_projects_count({ count: held.followed });
    if (held.checkedAt === undefined)
      return m.cloud_count_books_follow_their_writer({ count: held.followed });
    return m.cloud_nothing_new_in_the_writer({
      count: held.followed,
      when: ago(held.checkedAt ?? 0),
    });
  };

  return (
    <Show when={facts().followed > 0}>
      <div class="space-y-2 border-t border-surface-border pt-3" data-sync-writer>
        <p class="text-smallest font-medium text-on-surface-tertiary">
          {m.cloud_writer_projects()}
        </p>
        <Show
          when={facts().work.length > 0}
          fallback={<p class="text-small text-on-surface-secondary">{quietNote()}</p>}
        >
          <ul class="space-y-1 text-small">
            <For each={facts().work}>
              {(work) => (
                <li data-writer-book={work.book}>
                  {m.cloud_owner_is_still_working_on({
                    owner: work.latest.name,
                    book: bookName(work.book, metadataOf(shell.project())),
                    when: dated(work.latest.at),
                  })}
                </li>
              )}
            </For>
          </ul>
          <Button
            size="sm"
            variant="primary"
            data-testid="writer-review"
            onClick={() => {
              props.onLeave();
              void navigate({
                to: "/project/$slug/review",
                params: { slug: shell.slug() },
                search: { against: "writer" },
              });
            }}
          >
            {m.cloud_review_their_changes()}
          </Button>
        </Show>
      </div>
    </Show>
  );
}
