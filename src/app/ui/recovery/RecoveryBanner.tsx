import { Effect, Result } from "effect";
import History from "lucide-solid/icons/history";
import { Show, createSignal } from "solid-js";

import { m } from "#app/paraglide/messages";
import type { Restorable } from "#core/recovery/recovery";

import { describe } from "../../describe";
import { uiLocale } from "../../locale";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { Button, Card, PanelHeader, Switch, toasts } from "../primitives";

const lastTouched = (journals: readonly Restorable[]): string => {
  let latest: number | undefined;
  for (const journal of journals) {
    const at = journal.entries.at(-1)?.at;
    if (at !== undefined && (latest === undefined || at > latest)) latest = at;
  }
  if (latest === undefined) return "";
  return new Date(latest).toLocaleString(uiLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

type Shell = ReturnType<typeof useShell>;

const restoreProgram = (
  shell: Shell,
  project: NonNullable<ReturnType<Shell["project"]>>,
  journals: readonly Restorable[],
) =>
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
  );

const reportRestore = (
  notice: ReturnType<typeof toasts.progress>,
  results: readonly Result.Result<unknown, unknown>[],
): void => {
  const refused = results.filter(Result.isFailure);
  const restored = results.length - refused.length;
  if (refused.length > 0) {
    toasts.update(notice, {
      tone: "error",
      autoClose: false,
      title: m.recovery_restored_of_total_books({
        restored,
        total: results.length,
      }),
      message: describe(refused[0]?.failure),
    });
    return;
  }
  toasts.update(notice, {
    tone: "success",
    title: m.recovery_restored_count_books({ count: restored }),
    message: m.recovery_the_work_is_in_the(),
  });
};

function createRecoveryActions(shell: Shell) {
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
      title: m.recovery_restoring_count_books({ count: journals.length }),
    });
    void shell.services
      .run(restoreProgram(shell, project, journals))
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
        reportRestore(notice, results);
      })
      .catch(() => {
        setBusy(false);
        operation.end("failed", { "journal.books": journals.length });
        toasts.update(notice, {
          tone: "error",
          autoClose: false,
          title: m.recovery_could_not_restore_the_unsaved(),
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
            title: m.recovery_could_not_discard_every_backup(),
            message: describe(refused[0]?.failure),
          });
          return;
        }
        toasts.info({
          title: m.recovery_discarded_the_unsaved_work_from(),
        });
      })
      .catch(() => {
        setBusy(false);
        operation.end("failed", { "journal.books": journals.length });
        toasts.error({ title: m.recovery_could_not_discard_the_unsaved() });
      });
  };
  return { offered, busy, books, restoreAll, discardAll };
}

export function RecoveryBanner() {
  const shell = useShell();
  const { offered, busy, books, restoreAll, discardAll } = createRecoveryActions(shell);
  // "Don't remind me again" is "Offer unsaved work on open" (Settings ›
  // Advanced), turned off: one setting. The banner stays up for this session;
  // the switch only decides whether the next opens ask.
  const offerKey = shellKeys(shell.services.settings).offerRecovery;
  const [quiet, setQuiet] = createSignal(!shell.services.settings.get(offerKey), {
    name: "recoveryQuiet",
  });
  const remind = (off: boolean): void => {
    setQuiet(off);
    void shell.services.run(shell.services.settings.set(offerKey, !off));
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
              {m.recovery_unsaved_work_from_your_last()}
            </span>
          }
          subtitle={m.recovery_count_books_last_backed_up({
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
                {m.recovery_restore_all()}
              </Button>
              <Button size="sm" disabled={busy()} data-recovery-discard onClick={discardAll}>
                {m.recovery_discard_all()}
              </Button>
            </>
          }
        />
        <p class="text-small text-on-surface-secondary">
          {m.recovery_these_edits_were_never_recorded()}
        </p>
        {/* A shortcut to the setting while developing; a release turns it off
            only in Settings › Advanced (Will, 2026-11-02). */}
        <Show when={__SEFER_DESIGN__}>
          <Switch
            label={m.recovery_quiet()}
            data-recovery-quiet
            checked={quiet()}
            onChange={remind}
          />
        </Show>
        <Show when={offered().filter((journal) => journal.stale === true).length}>
          {(count) => (
            <p class="text-small text-on-surface-warning" data-recovery-stale={count()}>
              {m.recovery_count_of_them_no_longer({ count: count() })}
            </p>
          )}
        </Show>
      </Card>
    </Show>
  );
}
