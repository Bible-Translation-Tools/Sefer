import { Effect, Result } from "effect";
import History from "lucide-solid/icons/history";
import { Show, createSignal } from "solid-js";

import type { Restorable } from "#core/recovery/recovery";

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, PanelHeader, toasts } from "../primitives";

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
  const offered = (): readonly Restorable[] => shell.recoveryOffer() ?? [];
  const setOffered = (
    next: readonly Restorable[] | ((was: readonly Restorable[]) => readonly Restorable[]),
  ): void => shell.setRecoveryOffer(typeof next === "function" ? next(offered()) : next);
  const [busy, setBusy] = createSignal(false, { name: "recoveryBusy" });

  const books = (): number => offered().length;

  const restoreAll = (): void => {
    const project = shell.project();
    const journals = offered().filter((journal) => journal.stale !== true);
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
                const book = yield* project.instantiate(journal.bookId);
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
        setOffered((was) => was.filter((journal) => journal.stale === true));
        const refused = results.filter(Result.isFailure);
        const restored = results.length - refused.length;
        operation.end(refused.length === 0 ? "ready" : "refused", {
          "journal.books": results.length,
          "journal.restored": restored,
          "journal.refused": refused.length,
        });
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
        <Show when={offered().filter((journal) => journal.stale === true).length}>
          {(count) => (
            <p class="text-small text-on-surface-warning" data-recovery-stale={count()}>
              {t(
                "{count} of them no longer match their file — it changed after this work was backed up — so they cannot be put back, only discarded.",
                { count: count() },
              )}
            </p>
          )}
        </Show>
      </Card>
    </Show>
  );
}
