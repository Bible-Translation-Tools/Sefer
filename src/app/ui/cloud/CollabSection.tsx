import { useNavigate } from "@tanstack/solid-router";
import { Match, Show, Switch, createSignal } from "solid-js";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { reviewNeeded, suggestMyChanges } from "../../suggestions";
import { ago } from "../panels/format";
import { Button, toasts } from "../primitives";
import { chooseOwnCopy, chooseShared } from "./collab";
import { offerRefusalCopy } from "./copy";

type Facts = NonNullable<ReturnType<typeof collaboration.facts>>;
type Project = NonNullable<ReturnType<Shell["project"]>>;
type ReviewSearch = NonNullable<ReturnType<typeof reviewNeeded>>["search"];

const speaks = (held: Facts | undefined): Facts | undefined => {
  if (held === undefined) return undefined;
  const speaking =
    held.mode === "copy" ||
    (held.mode === "shared" && (held.canWrite === false || held.waiting > 0));
  return speaking ? held : undefined;
};

const offerChanges = async (
  services: Shell["services"],
  project: Project,
  toReview: (search: ReviewSearch) => void,
): Promise<void> => {
  try {
    await suggestMyChanges(services, project);
    toasts.success({
      title: t("Your changes are offered"),
      message: t("The project's editors will see them. Later sends add to the same suggestion."),
    });
  } catch (cause) {
    const needed = reviewNeeded(cause);
    if (needed === undefined)
      toasts.error({ title: t("Could not offer your changes"), message: describe(cause) });
    else {
      toasts.info(offerRefusalCopy(needed));
      toReview(needed.search);
    }
  } finally {
    await collaboration.refresh(services, project);
  }
};

const createCollabActions = (onLeave: () => void) => {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const facts = () => collaboration.facts(shell.project()?.root);
  const [busy, setBusy] = createSignal(false, { name: "collabBusy" });
  const [standalone, setStandalone] = createSignal(false, { name: "collabStandalone" });

  const press = (work: (project: Project) => Promise<unknown>) => {
    const project = shell.project();
    if (project === undefined || busy()) return;
    setBusy(true);
    void work(project).finally(() => setBusy(false));
  };

  const toReview = (search: ReviewSearch): void => {
    onLeave();
    void navigate({ to: "/project/$slug/review", params: { slug: shell.slug() }, search });
  };

  return {
    facts,
    busy,
    standalone,
    ownCopy: (): void =>
      press(async (project) =>
        setStandalone((await chooseOwnCopy(services, project)) === "standalone"),
      ),
    offer: (): void => press((project) => offerChanges(services, project, toReview)),
    workDirectly: (): void => press((project) => chooseShared(services, project)),
    toReview,
    toSettings: (): void => {
      onLeave();
      void navigate({ to: "/project/$slug/settings", params: { slug: shell.slug() } });
    },
    toSuggestions: (): void => {
      onLeave();
      void navigate({ to: "/project/$slug/suggestions", params: { slug: shell.slug() } });
    },
  };
};

const CannotWrite = (props: {
  readonly standalone: boolean;
  readonly busy: boolean;
  readonly onSettings: () => void;
  readonly onOwnCopy: () => void;
}) => (
  <>
    <p class="text-small font-semibold">
      {t("You can suggest changes to this project, not change it directly.")}
    </p>
    <Show
      when={!props.standalone}
      fallback={
        <p class="text-small text-on-surface-secondary">
          {t("This shared project is yours. To suggest to another one, choose it in ")}
          <button type="button" class="text-brand underline" onClick={props.onSettings}>
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
      <Button size="sm" variant="primary" loading={props.busy} onClick={props.onOwnCopy}>
        {t("Work in my own copy")}
      </Button>
    </Show>
  </>
);

const WaitingNote = (props: { readonly waiting: number; readonly onSee: () => void }) => (
  <div class="flex items-center gap-2">
    <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
      {props.waiting === 1
        ? t("1 suggestion is waiting for an editor.")
        : t("{count} suggestions are waiting for an editor.", {
            count: props.waiting,
          })}
    </p>
    <Button size="sm" variant="secondary" onClick={props.onSee}>
      {t("See them")}
    </Button>
  </div>
);

const MineNote = (props: { readonly held: Facts }) => (
  <Switch
    fallback={
      <p class="text-small text-on-surface-secondary">
        {t("Offer your changes when they are ready; an editor brings them in.")}
      </p>
    }
  >
    <Match when={props.held.mine?.kind === "waiting" ? props.held.mine : undefined}>
      {(mine) => (
        <p class="text-small text-on-surface-secondary" data-sync-suggestion="waiting">
          {t("Your suggestion is waiting for the project's editors · {when}", {
            when: ago(Date.parse(mine().suggestion.updatedAt)),
          })}
        </p>
      )}
    </Match>
    <Match when={props.held.mine?.kind === "taken"}>
      <p class="text-small text-on-surface-success" data-sync-suggestion="taken">
        {t("Your last suggestion was brought into the shared project.")}
      </p>
    </Match>
    <Match
      when={(() => {
        const mine = props.held.mine;
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
);

const CopyMode = (props: {
  readonly held: Facts;
  readonly busy: boolean;
  readonly onSee: () => void;
  readonly onOffer: () => void;
  readonly onWorkDirectly: () => void;
}) => (
  <>
    <p class="text-small font-semibold">{t("You're working in your own copy.")}</p>
    <Show when={props.held.copyAhead}>
      <div class="flex items-center gap-2" data-sync-copy="ahead">
        <p class="min-w-0 flex-1 text-small text-on-surface-secondary">
          {t("Your copy has changes this device does not: from another device, or offered before.")}
        </p>
        <Button size="sm" variant="primary" onClick={props.onSee}>
          {t("See the changes")}
        </Button>
      </div>
    </Show>
    <MineNote held={props.held} />
    <div class="flex flex-wrap items-center gap-2">
      <Show when={props.held.mine?.kind !== "waiting" && props.held.offerable}>
        <Button size="sm" variant="secondary" loading={props.busy} onClick={props.onOffer}>
          {t("Offer my changes")}
        </Button>
      </Show>
      <Show when={props.held.canWrite === true}>
        <span class="min-w-0 flex-1 text-smallest text-on-surface-tertiary">
          {t("You can now work directly in the shared project.")}
        </span>
        <Button size="sm" variant="tertiary" disabled={props.busy} onClick={props.onWorkDirectly}>
          {t("Work directly")}
        </Button>
      </Show>
    </div>
  </>
);

export function CollabSection(props: { readonly onLeave: () => void }) {
  const actions = createCollabActions(() => props.onLeave());
  const said = () => speaks(actions.facts());

  return (
    <Show when={said()}>
      {(held) => (
        <div class="space-y-2 border-t border-surface-border pt-3" data-sync-collab={held().mode}>
          <Switch>
            <Match when={held().mode === "shared" && held().canWrite === false}>
              <CannotWrite
                standalone={actions.standalone()}
                busy={actions.busy()}
                onSettings={actions.toSettings}
                onOwnCopy={actions.ownCopy}
              />
            </Match>

            <Match when={held().mode === "shared" && held().waiting > 0}>
              <WaitingNote waiting={held().waiting} onSee={actions.toSuggestions} />
            </Match>

            <Match when={held().mode === "copy"}>
              <CopyMode
                held={held()}
                busy={actions.busy()}
                onSee={() => actions.toReview({ against: "shared", copy: 1 })}
                onOffer={actions.offer}
                onWorkDirectly={actions.workDirectly}
              />
            </Match>
          </Switch>
        </div>
      )}
    </Show>
  );
}
