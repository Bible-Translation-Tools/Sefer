/**
 * The cloud popover's Writer section: for a project whose books still follow
 * their Writer projects, whether someone is still working there.
 *
 * Shown only while the project follows any (`.upstreams.json`); quiet when
 * nothing is new. The copy names the person and the book, never the remote:
 * "mary_chishimba is still working on 1 John in Writer". "Review their
 * changes" opens Review against "From Writer", where every passage is the
 * person's to decide and recording marks the work taken.
 */

import { useNavigate } from "@tanstack/solid-router";
import { For, Show } from "solid-js";

import { t } from "../../i18n";
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

  return (
    <Show when={facts().followed > 0}>
      <div class="space-y-2 border-t border-surface-border pt-3" data-sync-writer>
        <p class="text-smallest font-medium text-on-surface-tertiary">{t("Writer projects")}</p>
        <Show
          when={facts().work.length > 0}
          fallback={
            <p class="text-small text-on-surface-secondary">
              {facts().checking
                ? t("Checking the Writer projects {count} books follow…", {
                    count: facts().followed,
                  })
                : facts().checkedAt === undefined
                  ? t("{count} books follow their Writer projects.", { count: facts().followed })
                  : t("Nothing new in the Writer projects {count} books follow (checked {when}).", {
                      count: facts().followed,
                      when: ago(facts().checkedAt ?? 0),
                    })}
            </p>
          }
        >
          <ul class="space-y-1 text-small">
            <For each={facts().work}>
              {(work) => (
                <li data-writer-book={work.book}>
                  {t("{owner} is still working on {book} in Writer: saved {when}.", {
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
            {t("Review their changes")}
          </Button>
        </Show>
      </div>
    </Show>
  );
}
