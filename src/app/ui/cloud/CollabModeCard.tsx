/**
 * "How you work on this project", in Settings' Cloud section: the two modes,
 * each with what it means in a sentence, and the one that cannot be chosen
 * greyed with why.
 *
 * Choosing the copy makes it (or finds the one already made) at once, because
 * a mode with nowhere to send is not a mode. A shared project that is the
 * person's own, and copies nothing, has nothing to suggest to: the card then
 * asks which project it should suggest to.
 */

import type { JSX } from "@solidjs/web";
import Lock from "lucide-solid/icons/lock";
import { Show, createSignal } from "solid-js";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { suggestTo } from "../../suggestions";
import { syncWatch } from "../../syncWatch";
import { Button, Card, cx, Input, PanelHeader, toasts } from "../primitives";
import { chooseOwnCopy, chooseShared } from "./collab";

export function CollabModeCard() {
  const shell = useShell();
  const { services } = shell;
  const facts = () => collaboration.facts(shell.project()?.root);
  const [busy, setBusy] = createSignal(false, { name: "collabModeBusy" });
  const [asking, setAsking] = createSignal(false, { name: "collabModeAsking" });
  const [target, setTarget] = createSignal("", { name: "collabModeTarget" });

  // Settings is somewhere a person comes to decide this: ask, if nothing has.
  const opened = shell.project();
  if (opened !== undefined && collaboration.facts(opened.root) === undefined)
    void collaboration.refresh(services, opened);

  const press = (work: () => Promise<unknown>): void => {
    if (busy()) return;
    setBusy(true);
    void work().finally(() => setBusy(false));
  };

  const copy = (): void =>
    press(async () => {
      const project = shell.project();
      if (project === undefined) return;
      setAsking((await chooseOwnCopy(services, project)) === "standalone");
    });

  const shared = (): void =>
    press(async () => {
      const project = shell.project();
      if (project !== undefined) await chooseShared(services, project);
    });

  const attachShared = (event: SubmitEvent): void => {
    event.preventDefault();
    // Read at the moment of the press, not when the handler was made.
    const staticTarget = target();
    press(async () => {
      const project = shell.project();
      if (project === undefined) return;
      try {
        const done = await suggestTo(services, project, staticTarget);
        if (done.related) {
          setAsking(false);
          setTarget("");
          toasts.success({
            title: t("This project now suggests to {shared}", { shared: done.shared }),
            message: t("Your project is your copy; offer your changes when ready."),
          });
        } else
          toasts.error({
            title: t("Nothing changed"),
            message: t(
              "{shared} shares no history with this project, so suggesting to it would offer the whole project.",
              { shared: done.shared },
            ),
            autoClose: false,
          });
      } catch (cause) {
        toasts.error({ title: t("Could not attach that project"), message: describe(cause) });
      } finally {
        await Promise.all([
          collaboration.refresh(services, project),
          syncWatch.refresh(services, project).catch(() => undefined),
        ]);
      }
    });
  };

  /**
   * The way this person CAN work. Someone who cannot write to the shared
   * project works in their own copy whatever was stored, so that option shows
   * as theirs — with the button that makes the copy, until it exists — rather
   * than the stored "shared" showing as chosen beside why it cannot be.
   */
  const effective = (): "shared" | "copy" | undefined =>
    facts()?.canWrite === false ? "copy" : facts()?.mode;
  /** Their way of working is the copy, and the copy is not made yet. */
  const copyToMake = (): boolean => facts()?.canWrite === false && facts()?.mode === "shared";

  const option = (
    mode: "shared" | "copy",
    title: string,
    detail: string,
    onChoose: () => void,
    blocked: string | undefined,
    extra?: () => JSX.Element,
  ) => (
    <label
      class={cx(
        "flex items-start gap-3 rounded-md border p-3",
        blocked === undefined
          ? "border-surface-border"
          : "cursor-not-allowed border-dashed border-surface-border bg-surface-secondary",
      )}
      data-collab-mode={mode}
      data-blocked={blocked === undefined ? undefined : "true"}
    >
      <input
        type="radio"
        name="collab-mode"
        class="mt-1"
        checked={effective() === mode}
        disabled={busy() || blocked !== undefined || facts() === undefined}
        onChange={(event) => {
          // The mode changes when the move has happened, not when clicked: the
          // radio follows the facts, which the move refreshes.
          event.currentTarget.checked = false;
          onChoose();
        }}
      />
      <span class="space-y-0.5">
        {/* A way of working this person cannot choose reads as unavailable at a
            glance — dimmed, dashed, and the reason beside a lock — not as the
            same card with one grey line at the bottom. */}
        <span class={cx("block space-y-0.5", blocked !== undefined && "opacity-60")}>
          <span class="block text-small font-semibold">{title}</span>
          <span class="block text-smallest text-on-surface-secondary">{detail}</span>
        </span>
        <Show when={blocked}>
          {(why) => (
            <span class="flex items-center gap-1.5 pt-1 text-small font-medium text-on-surface-warning">
              <Lock size={14} aria-hidden="true" />
              {why()}
            </span>
          )}
        </Show>
        {extra?.()}
      </span>
    </label>
  );

  return (
    <Card class="space-y-3" data-cloud-card="collab-mode">
      <PanelHeader
        level={3}
        title={t("How you work on this project")}
        subtitle={t(
          "The shared project only changes when someone who can edit it sends or accepts.",
        )}
      />
      <Show
        when={facts()}
        fallback={
          <p class="text-small text-on-surface-tertiary">{t("Asking the shared project…")}</p>
        }
      >
        <div class="space-y-2">
          {option(
            "shared",
            t("Together in the shared project"),
            t("Your changes are sent straight to the shared project everyone works in."),
            shared,
            facts()?.canWrite === false
              ? t("You can suggest changes to this project, not change it directly.")
              : undefined,
          )}
          {option(
            "copy",
            t("In my own copy, offering changes when ready"),
            t(
              "Your changes go to your own copy. Offer them when they are ready, and an editor of the shared project brings them in.",
            ),
            copy,
            // Not known means nobody is signed in: a copy is made by an account.
            facts()?.canWrite === undefined ? t("Sign in to choose this.") : undefined,
            () => (
              <Show when={copyToMake()}>
                <span class="flex items-center gap-2 pt-2">
                  <Button size="sm" variant="primary" loading={busy()} onClick={copy}>
                    {t("Work in my own copy")}
                  </Button>
                  <span class="text-smallest text-on-surface-tertiary">
                    {t("Your copy is made on the shared project's server.")}
                  </span>
                </span>
              </Show>
            ),
          )}
        </div>
      </Show>

      <Show when={asking()}>
        <form class="space-y-2" onSubmit={attachShared} data-collab="suggest-to">
          <p class="text-small text-on-surface-secondary">
            {t(
              "This shared project is yours. To work on it as your copy of another project, name the project it should suggest to.",
            )}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <Input
              size="sm"
              wrapperClass="min-w-0 flex-1"
              placeholder={t("owner/project, or its address")}
              value={target()}
              onInput={(event) => setTarget(event.currentTarget.value)}
            />
            <Button size="sm" type="submit" loading={busy()} disabled={target().trim() === ""}>
              {t("Suggest to it")}
            </Button>
          </div>
        </form>
      </Show>
    </Card>
  );
}
