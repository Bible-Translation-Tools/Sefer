/**
 * "Unsaved work from your last session": the one thing a project open owes
 * someone who crashed. `documentation/architecture/recovery.md`, "The banner",
 * has the full account.
 *
 * The check runs ONCE per open project, on mount: `pendingOnOpen` lists that
 * project's journals, reads each book file once and discards — silently —
 * every journal whose work the file already holds. What is left is work that
 * exists nowhere else, and that is what this banner offers.
 *
 * ## One question, not one per book
 *
 * Nobody knows, from a book id and an edit count, whether last Tuesday's work
 * in 3 John is worth keeping. The question a reader CAN answer is "was my last
 * session real work or not", and that is a project-level question — so this
 * is one card, with **Restore all** and **Discard all**, and the book count in
 * the sentence rather than as a list to triage.
 *
 * Restoring is deliberately the cheap, reversible answer: it puts the work
 * back in the editor, dirty, where the reader can compare every changed book
 * against disk in Review and revert whatever they do not want.
 *
 * Three rules the surface must keep:
 *
 *   * **Restore goes through the Book.** `project.instantiate(bookId)` seats
 *     the book and `recovery.restore` replays the journal through
 *     `book.apply(…, 'recovery', trusted)`, so the text arrives as ordinary
 *     applied changes and is re-judged by today's rules rather than trusted.
 *   * **The disk text becomes the baseline first.** `SaveCoordinator.adopt`
 *     is called on the freshly instantiated book, BEFORE the replay, while its
 *     revision is still 0 and its text really is the bytes on disk. Without
 *     that the restored book has no baseline at all, and Review — which
 *     compares against disk — cannot show what came back.
 *   * **Nothing is offered twice.** A journal for a book this session already
 *     has open is the live backup of what is on screen; restoring it would
 *     replay edits the editor is already showing. Those are filtered out, the
 *     same way `ReviewPanel` filters them.
 *
 * Exported for the project route to mount as well; it is mounted here because
 * the landing screen is where someone lands after the crash.
 */

import { Effect, Result } from "effect";
import History from "lucide-solid/icons/history";
import { Show, createEffect, createSignal } from "solid-js";

import type { Restorable } from "#core/recovery/recovery";
import { pendingOnOpen } from "#core/recovery/reopen";

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, PanelHeader, toasts } from "../primitives";

/** When the work was last journalled, over every offered journal. */
const lastTouched = (journals: readonly Restorable[]): string => {
  let latest: number | undefined;
  for (const journal of journals) {
    const at = journal.entries.at(-1)?.at;
    if (at !== undefined && (latest === undefined || at > latest)) latest = at;
  }
  if (latest === undefined) return "";
  return new Date(latest).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function RecoveryBanner() {
  const shell = useShell();
  const [offered, setOffered] = createSignal<readonly Restorable[]>([], { name: "recovered" });
  const [busy, setBusy] = createSignal(false, { name: "recoveryBusy" });

  // One pass per open project. Keyed on the project's id rather than on any
  // edit event, so an edit does not re-run an IO check whose answer cannot
  // have changed: journalling during this session is the ReviewPanel's
  // subject, not this one's.
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

  const books = (): number => offered().length;

  /**
   * Every journal, in order, as one action.
   *
   * A failure on one book stops nothing: the other journals are independent
   * backups and refusing them all because one replay was rejected by today's
   * rules would throw away work for no reason. The count of what came back and
   * the count of what refused are both reported.
   */
  const restoreAll = (): void => {
    const project = shell.project();
    const journals = offered();
    if (project === undefined || journals.length === 0 || busy()) return;
    setBusy(true);
    const operation = shell.services.composition.observability.operation("journal.restore", {
      "journal.books": journals.length,
    });
    const notice = toasts.progress({
      title: t("Restoring {count} book(s)…", { count: journals.length }),
    });
    void shell.services
      .run(
        Effect.forEach(
          journals,
          (journal) =>
            Effect.result(
              Effect.gen(function* () {
                // The replay needs a Book to apply onto, and a book nobody
                // opened has none — so it is instantiated first, through the
                // Project that owns its lifetime.
                const book = yield* project.instantiate(journal.bookId);
                // Its text IS the bytes on disk at this moment, and its
                // revision is still 0, so this is the one moment the disk
                // baseline can be learned for free. Review compares
                // against that baseline; without it the restored work would
                // come back invisible to the screen built to inspect it.
                yield* shell.services.save.adopt(book);
                return yield* shell.services.recovery.restore(journal.id, (bookId) =>
                  shell.services.seated(bookId),
                );
              }),
            ),
          { concurrency: 1 },
        ),
      )
      .then((results) => {
        setBusy(false);
        setOffered([]);
        const refused = results.filter(Result.isFailure);
        const restored = results.length - refused.length;
        operation.end(refused.length === 0 ? "ready" : "refused", {
          "journal.books": results.length,
          "journal.restored": restored,
          "journal.refused": refused.length,
        });
        // Only the journals that actually replayed. `results` is parallel to
        // `journals`, and a refused journal moved no text, so naming it here
        // would wake its row to tell it nothing.
        const books = results.flatMap((result, index) => {
          const journal = journals[index];
          return Result.isSuccess(result) && journal !== undefined ? [journal.bookId] : [];
        });
        shell.changed({ kind: "journal.restore", books });
        if (refused.length > 0) {
          toasts.update(notice, {
            tone: "error",
            autoClose: false,
            title: t("Restored {restored} of {total} book(s)", {
              restored,
              total: results.length,
            }),
            message: describe(refused[0]?.failure),
          });
          return;
        }
        toasts.update(notice, {
          tone: "success",
          title: t("Restored {count} book(s)", { count: restored }),
          message: t(
            "The work is in the editor, unsaved. Save & Review shows every changed book against the file on disk.",
          ),
        });
      })
      .catch(() => {
        setBusy(false);
        operation.end("failed", { "journal.books": journals.length });
        toasts.update(notice, {
          tone: "error",
          autoClose: false,
          title: t("Could not restore the unsaved work"),
        });
      });
  };

  const discardAll = (): void => {
    const journals = offered();
    if (journals.length === 0 || busy()) return;
    setBusy(true);
    const operation = shell.services.composition.observability.operation("journal.discard", {
      "journal.books": journals.length,
    });
    void shell.services
      .run(
        Effect.forEach(
          journals,
          (journal) => Effect.result(shell.services.recovery.discard(journal.id)),
          {
            concurrency: 1,
          },
        ),
      )
      .then((results) => {
        setBusy(false);
        setOffered([]);
        const refused = results.filter(Result.isFailure);
        operation.end(refused.length === 0 ? "consumed" : "refused", {
          "journal.books": results.length,
          "journal.discarded": results.length - refused.length,
          "journal.refused": refused.length,
        });
        if (refused.length > 0) {
          toasts.error({
            title: t("Could not discard every backup"),
            message: describe(refused[0]?.failure),
          });
          return;
        }
        toasts.info({
          title: t("Discarded the unsaved work from the last session"),
        });
      })
      .catch(() => {
        setBusy(false);
        operation.end("failed", { "journal.books": journals.length });
        toasts.error({ title: t("Could not discard the unsaved work") });
      });
  };

  return (
    <Show when={books() > 0}>
      <Card data-recovery={books()} class="border-on-surface-warning/40 space-y-3">
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
              {t("Unsaved work from your last session")}
            </span>
          }
          subtitle={t("{count} book(s), last backed up {when}", {
            count: books(),
            when: lastTouched(offered()),
          })}
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                loading={busy()}
                data-recovery-restore
                onClick={restoreAll}
              >
                {t("Restore all")}
              </Button>
              <Button size="sm" disabled={busy()} data-recovery-discard onClick={discardAll}>
                {t("Discard all")}
              </Button>
            </>
          }
        />
        <p class="text-small text-on-surface-secondary">
          {t(
            "These edits were never recorded. Restore all puts them back in the editor, unsaved — Save & Review then shows every changed book beside the file on disk, where you can keep or revert any of it. Discard all throws them away.",
          )}
        </p>
      </Card>
    </Show>
  );
}
