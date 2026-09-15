/**
 * "Recovered work": the one thing a project open owes someone who crashed.
 *
 * The check runs ONCE per open project, on mount, and it is the only place in
 * the shell that asks Recovery anything at open time: `pendingOnOpen` lists
 * that project's journals, reads each book file once and discards — silently —
 * every journal whose work the file already holds. What is left is work that
 * exists nowhere else, and that is what this banner offers.
 *
 * Two rules the surface must keep:
 *
 *   * **Keep restores through the Book.** `project.instantiate(bookId)` seats
 *     the book and `recovery.restore` replays the journal through
 *     `book.apply(…, 'recovery', trusted)`. That is the funnel: the text
 *     arrives as ordinary applied changes, so it is in the undo history, the
 *     editor sees it, Save sees it dirty, and a journal written under an older
 *     rule set is re-judged by today's rules rather than trusted.
 *   * **Nothing is offered twice.** A journal for a book this session already
 *     has open is the live backup of what is on screen; restoring it would
 *     replay edits the editor is already showing. Those are filtered out, the
 *     same way `SavePanel` filters them.
 *
 * Keep and Discard both leave the banner — an answered question stops being a
 * question — and the card disappears when the last one is answered.
 *
 * Exported for the project route to mount as well; it is mounted here because
 * the landing screen is where someone lands after the crash.
 */

import { Effect, Result } from "effect";
import History from "lucide-solid/icons/history";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Restorable } from "../../../core/recovery/recovery";
import { pendingOnOpen } from "../../../core/recovery/reopen";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, PanelHeader, toasts } from "../primitives";

/** When the work was last journalled, in the reader's own locale. */
const lastTouched = (journal: Restorable): string => {
  const at = journal.entries.at(-1)?.at;
  if (at === undefined) return "";
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function RecoveryBanner() {
  const shell = useShell();
  const [offered, setOffered] = createSignal<readonly Restorable[]>([], { name: "recovered" });
  const [busy, setBusy] = createSignal("", { name: "recoveryBusy" });

  const forget = (journal: Restorable): void => {
    setOffered((held) => held.filter((other) => other.id !== journal.id));
  };

  // One pass per open project. Keyed on the project's id rather than on `tick`
  // so an edit does not re-run an IO check whose answer cannot have changed:
  // journalling during this session is the SavePanel's subject, not this one's.
  createEffect(
    () => shell.project()?.id,
    (id) => {
      if (id === undefined) {
        setOffered([]);
        return;
      }
      void shell.services
        .run(pendingOnOpen(shell.services.recovery, id))
        .then((found) =>
          setOffered(
            found.filter((journal) => shell.services.seated(journal.bookId) === undefined),
          ),
        );
    },
  );

  const keep = (journal: Restorable): void => {
    const project = shell.project();
    if (project === undefined) return;
    setBusy(journal.id);
    void shell.services
      .run(
        Effect.result(
          Effect.gen(function* () {
            // The replay needs a Book to apply onto, and a book nobody opened
            // has none — so it is instantiated first, through the Project that
            // owns its lifetime.
            yield* project.instantiate(journal.bookId);
            return yield* shell.services.recovery.restore(journal.id, (bookId) =>
              shell.services.seated(bookId),
            );
          }),
        ),
      )
      .then((done) => {
        setBusy("");
        if (Result.isFailure(done)) {
          toasts.error({
            title: t("Could not restore {book}", { book: journal.bookId }),
            message: done.failure.description,
          });
          return;
        }
        forget(journal);
        toasts.success({
          title: t("Restored {book}", { book: journal.bookId }),
          message: t("The work is in the editor, unsaved — undo still reaches behind it."),
        });
        shell.bump();
      });
  };

  const discard = (journal: Restorable): void => {
    setBusy(journal.id);
    void shell.services
      .run(Effect.result(shell.services.recovery.discard(journal.id)))
      .then((done) => {
        setBusy("");
        if (Result.isFailure(done)) {
          toasts.error({ title: t("Could not discard"), message: done.failure.description });
          return;
        }
        forget(journal);
        toasts.info({
          title: t("Discarded the recovered work for {book}", { book: journal.bookId }),
        });
      });
  };

  return (
    <Show when={offered().length > 0}>
      <Card data-recovery={offered().length} class="border-on-surface-warning/40 space-y-3">
        <PanelHeader
          level={3}
          title={
            <span class="flex items-center gap-2">
              <span
                class="flex size-7 items-center justify-center rounded-md bg-surface-warning text-on-surface-warning"
                aria-hidden="true"
              >
                <History size={16} />
              </span>
              {t("Recovered work")}
            </span>
          }
          subtitle={t(
            "Edits from an earlier session that never reached disk. Keep puts them back in the book; Discard throws them away.",
          )}
        />
        <ul class="space-y-2">
          <For each={offered()}>
            {(journal) => (
              <li
                class="flex flex-wrap items-center gap-3 rounded-md border border-surface-border px-3 py-2"
                data-recovered-book={journal.bookId}
              >
                <div class="min-w-0">
                  <strong class="text-small font-medium text-on-surface-primary">
                    {journal.bookId}
                  </strong>
                  <p class="text-smallest text-on-surface-tertiary">
                    {t("{count} change(s), last at {when}", {
                      count: journal.entries.length,
                      when: lastTouched(journal),
                    })}
                  </p>
                </div>
                <div class="ms-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy() !== ""}
                    onClick={() => keep(journal)}
                  >
                    {t("Keep")}
                  </Button>
                  <Button size="sm" disabled={busy() !== ""} onClick={() => discard(journal)}>
                    {t("Discard")}
                  </Button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Card>
    </Show>
  );
}
