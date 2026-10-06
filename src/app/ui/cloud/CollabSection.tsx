/**
 * The cloud popover's word on working with other people: one line, and at
 * most one button, for whichever of the two modes the project is in.
 *
 * - In the shared project, for someone who cannot write to it: the sentence
 *   that explains the refused send, and "Work in my own copy".
 * - In the shared project, for an editor: how many suggestions wait.
 * - In their own copy: how their suggestion stands — waiting, brought in, or
 *   closed with the editor's note — and "Offer my changes" when none is open;
 *   for someone who has since been given write access, the way back.
 *
 * Nothing here moves on its own. A gained permission is said, never acted on.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Match, Show, Switch, createSignal } from "solid-js";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { suggestMyChanges } from "../../suggestions";
import { ago } from "../panels/format";
import { Button, toasts } from "../primitives";
import { chooseOwnCopy, chooseShared } from "./collab";

export function CollabSection(props: { readonly onLeave: () => void }) {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const facts = () => collaboration.facts(shell.project()?.root);
  const [busy, setBusy] = createSignal(false, { name: "collabBusy" });
  const [standalone, setStandalone] = createSignal(false, { name: "collabStandalone" });

  /** One press at a time; the project is read when pressed. */
  const press = (
    work: (project: NonNullable<ReturnType<typeof shell.project>>) => Promise<unknown>,
  ) => {
    const project = shell.project();
    if (project === undefined || busy()) return;
    setBusy(true);
    void work(project).finally(() => setBusy(false));
  };

  const ownCopy = (): void =>
    press(async (project) =>
      setStandalone((await chooseOwnCopy(services, project)) === "standalone"),
    );

  const offer = (): void =>
    press(async (project) => {
      try {
        await suggestMyChanges(services, project);
        toasts.success({
          title: t("Your changes are offered"),
          message: t(
            "The project's editors will see them. Later sends add to the same suggestion.",
          ),
        });
      } catch (cause) {
        toasts.error({ title: t("Could not offer your changes"), message: describe(cause) });
      } finally {
        await collaboration.refresh(services, project);
      }
    });

  const toSettings = (): void => {
    props.onLeave();
    void navigate({ to: "/settings" });
  };

  /** Something to say: the frame is not drawn around nothing. */
  const said = () => {
    const held = facts();
    if (held === undefined) return undefined;
    const speaks =
      held.mode === "copy" ||
      (held.mode === "shared" && (held.canWrite === false || held.waiting > 0));
    return speaks ? held : undefined;
  };

  return (
    <Show when={said()}>
      {(held) => (
        <div class="space-y-2 border-t border-surface-border pt-3" data-sync-collab={held().mode}>
          <Switch>
            <Match when={held().mode === "shared" && held().canWrite === false}>
              <p class="text-small font-semibold">
                {t("You can suggest changes to this project, not change it directly.")}
              </p>
              <Show
                when={!standalone()}
                fallback={
                  <p class="text-small text-on-surface-secondary">
                    {t("This shared project is yours. To suggest to another one, choose it in ")}
                    <button type="button" class="text-brand underline" onClick={toSettings}>
                      {t("Settings")}
                    </button>
                    .
                  </p>
                }
              >
                <p class="text-small text-on-surface-secondary">
                  {t(
                    "Work in your own copy: your changes are sent there, and an editor of the shared project brings them in when you offer them.",
                  )}
                </p>
                <Button size="sm" variant="primary" loading={busy()} onClick={ownCopy}>
                  {t("Work in my own copy")}
                </Button>
              </Show>
            </Match>

            <Match when={held().mode === "shared" && held().waiting > 0}>
              <div class="flex items-center gap-2">
                <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
                  {held().waiting === 1
                    ? t("1 suggestion is waiting for an editor.")
                    : t("{count} suggestions are waiting for an editor.", {
                        count: held().waiting,
                      })}
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    props.onLeave();
                    void navigate({
                      to: "/project/$slug/suggestions",
                      params: { slug: shell.slug() },
                    });
                  }}
                >
                  {t("See them")}
                </Button>
              </div>
            </Match>

            <Match when={held().mode === "copy"}>
              <p class="text-small font-semibold">{t("You're working in your own copy.")}</p>
              <Show when={held().copyAhead}>
                <div class="flex items-center gap-2" data-sync-copy="ahead">
                  <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
                    {t("Your copy has work from another of your devices.")}
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      props.onLeave();
                      void navigate({
                        to: "/project/$slug/review",
                        params: { slug: shell.slug() },
                        search: { against: "shared", copy: 1 },
                      });
                    }}
                  >
                    {t("See the changes")}
                  </Button>
                </div>
              </Show>
              <Switch
                fallback={
                  <p class="text-small text-on-surface-secondary">
                    {t("Offer your changes when they are ready; an editor brings them in.")}
                  </p>
                }
              >
                <Match when={held().mine?.kind === "waiting" ? held().mine : undefined}>
                  {(mine) => (
                    <p class="text-small text-on-surface-secondary" data-sync-suggestion="waiting">
                      {t("Your suggestion is waiting for the project's editors · {when}", {
                        when: ago(Date.parse(mine().suggestion.updatedAt)),
                      })}
                    </p>
                  )}
                </Match>
                <Match when={held().mine?.kind === "taken"}>
                  <p class="text-small text-on-surface-success" data-sync-suggestion="taken">
                    {t("Your last suggestion was brought into the shared project.")}
                  </p>
                </Match>
                <Match
                  when={(() => {
                    const mine = held().mine;
                    return mine?.kind === "declined" ? mine : undefined;
                  })()}
                >
                  {(mine) => (
                    <div class="space-y-1" data-sync-suggestion="declined">
                      <p class="text-small text-on-surface-secondary">
                        {t("Your last suggestion was closed without being brought in.")}
                      </p>
                      <Show when={mine().note}>
                        {(note) => (
                          <blockquote class="border-s-2 border-surface-border ps-3 text-small break-words text-on-surface-secondary">
                            {note()}
                          </blockquote>
                        )}
                      </Show>
                    </div>
                  )}
                </Match>
              </Switch>
              <div class="flex flex-wrap items-center gap-2">
                <Show when={held().mine?.kind !== "waiting" && held().offerable}>
                  <Button size="sm" variant="secondary" loading={busy()} onClick={offer}>
                    {t("Offer my changes")}
                  </Button>
                </Show>
                <Show when={held().canWrite === true}>
                  <span class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
                    {t("You can now work directly in the shared project.")}
                  </span>
                  <Button
                    size="sm"
                    variant="tertiary"
                    disabled={busy()}
                    onClick={() => press((project) => chooseShared(services, project))}
                  >
                    {t("Work directly")}
                  </Button>
                </Show>
              </div>
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  );
}
