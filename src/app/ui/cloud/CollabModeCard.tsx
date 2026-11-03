import type { JSX } from "@solidjs/web";
import Lock from "lucide-solid/icons/lock";
import { Show, createSignal, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { useShell, type Shell } from "../../ProjectContext";
import { suggestTo } from "../../suggestions";
import { syncWatch } from "../../syncWatch";
import { Button, Card, cx, Input, PanelHeader, toasts } from "../primitives";
import { chooseOwnCopy, chooseShared } from "./collab";

type Project = NonNullable<ReturnType<Shell["project"]>>;

const suggestToTarget = async (
  services: Shell["services"],
  project: Project,
  target: string,
  onRelated: () => void,
): Promise<void> => {
  try {
    const done = await suggestTo(services, project, target);
    if (done.related) {
      onRelated();
      toasts.success({
        title: m.cloud_this_project_now_suggests_to({ shared: done.shared }),
        message: m.cloud_your_project_is_your_copy(),
      });
    } else
      toasts.error({
        title: m.cloud_nothing_changed(),
        message: m.cloud_shared_shares_no_history_with({ shared: done.shared }),
        autoClose: false,
      });
  } catch (cause) {
    toasts.error({ title: m.cloud_could_not_attach_that_project(), message: describe(cause) });
  } finally {
    await Promise.all([
      collaboration.refresh(services, project),
      syncWatch.refresh(services, project).catch(() => undefined),
    ]);
  }
};

const createCollabMode = () => {
  const shell = useShell();
  const { services } = shell;
  const facts = () => collaboration.facts(shell.project()?.root);
  const [busy, setBusy] = createSignal(false, { name: "collabModeBusy" });
  const [asking, setAsking] = createSignal(false, { name: "collabModeAsking" });
  const [target, setTarget] = createSignal("", { name: "collabModeTarget" });

  untrack(() => {
    const opened = shell.project();
    if (opened !== undefined && collaboration.facts(opened.root) === undefined)
      void collaboration.refresh(services, opened);
  });

  const press = (work: () => Promise<unknown>): void => {
    if (busy()) return;
    setBusy(true);
    void work().finally(() => setBusy(false));
  };

  return {
    facts,
    busy,
    asking,
    target,
    setTarget,
    copy: (): void =>
      press(async () => {
        const project = shell.project();
        if (project === undefined) return;
        setAsking((await chooseOwnCopy(services, project)) === "standalone");
      }),
    shared: (): void =>
      press(async () => {
        const project = shell.project();
        if (project !== undefined) await chooseShared(services, project);
      }),
    attachShared: (event: SubmitEvent): void => {
      event.preventDefault();
      const staticTarget = target();
      press(async () => {
        const project = shell.project();
        if (project === undefined) return;
        await suggestToTarget(services, project, staticTarget, () => {
          setAsking(false);
          setTarget("");
        });
      });
    },
    effective: (): "shared" | "copy" | undefined =>
      facts()?.canWrite === false ? "copy" : facts()?.mode,
    copyToMake: (): boolean => facts()?.canWrite === false && facts()?.mode === "shared",
  };
};

const ModeOption = (props: {
  readonly mode: "shared" | "copy";
  readonly title: string;
  readonly detail: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChoose: () => void;
  readonly blocked: string | undefined;
  readonly extra?: () => JSX.Element;
}) => (
  <label
    class={cx(
      "flex items-start gap-3 rounded-md border p-3",
      props.blocked === undefined
        ? "border-surface-border"
        : "cursor-not-allowed border-dashed border-surface-border bg-surface-secondary",
    )}
    data-collab-mode={props.mode}
    data-blocked={props.blocked === undefined ? undefined : "true"}
  >
    <input
      type="radio"
      name="collab-mode"
      class="mt-1"
      checked={props.checked}
      disabled={props.disabled || props.blocked !== undefined}
      onChange={(event) => {
        event.currentTarget.checked = false;
        props.onChoose();
      }}
    />
    <span class="space-y-0.5">
      <span class={cx("block space-y-0.5", props.blocked !== undefined && "opacity-60")}>
        <span class="block text-small font-semibold">{props.title}</span>
        <span class="block text-smallest text-on-surface-secondary">{props.detail}</span>
      </span>
      <Show when={props.blocked}>
        {(why) => (
          <span class="flex items-center gap-1.5 pt-1 text-small font-medium text-on-surface-warning">
            <Lock size={14} aria-hidden="true" />
            {why()}
          </span>
        )}
      </Show>
      {props.extra?.()}
    </span>
  </label>
);

const SuggestToForm = (props: {
  readonly target: string;
  readonly busy: boolean;
  readonly onSubmit: (event: SubmitEvent) => void;
  readonly onTarget: (value: string) => void;
}) => (
  <form class="space-y-2" onSubmit={(event) => props.onSubmit(event)} data-collab="suggest-to">
    <p class="text-small text-on-surface-secondary">{m.cloud_this_shared_project_is_yours()}</p>
    <div class="flex flex-wrap items-center gap-2">
      <Input
        size="sm"
        wrapperClass="min-w-0 flex-1"
        placeholder={m.cloud_owner_project_or_its_address()}
        value={props.target}
        onInput={(event) => props.onTarget(event.currentTarget.value)}
      />
      <Button size="sm" type="submit" loading={props.busy} disabled={props.target.trim() === ""}>
        {m.cloud_suggest_to_it()}
      </Button>
    </div>
  </form>
);

const ModeChoices = (props: { readonly mode: ReturnType<typeof createCollabMode> }) => (
  <div class="space-y-2">
    <ModeOption
      mode="shared"
      title={m.cloud_together_in_the_shared_project()}
      detail={m.cloud_your_changes_are_sent_straight()}
      checked={props.mode.effective() === "shared"}
      disabled={props.mode.busy() || props.mode.facts() === undefined}
      onChoose={props.mode.shared}
      blocked={
        props.mode.facts()?.canWrite === false ? m.cloud_you_can_suggest_changes_to() : undefined
      }
    />
    <ModeOption
      mode="copy"
      title={m.cloud_in_my_own_copy_offering()}
      detail={m.cloud_your_changes_go_to_your()}
      checked={props.mode.effective() === "copy"}
      disabled={props.mode.busy() || props.mode.facts() === undefined}
      onChoose={props.mode.copy}
      blocked={
        props.mode.facts()?.canWrite === undefined ? m.cloud_sign_in_to_choose_this() : undefined
      }
      extra={() => (
        <Show when={props.mode.copyToMake()}>
          <span class="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="primary"
              loading={props.mode.busy()}
              onClick={props.mode.copy}
            >
              {m.cloud_work_in_my_own_copy()}
            </Button>
            <span class="text-smallest text-on-surface-tertiary">
              {m.cloud_your_copy_is_made_on()}
            </span>
          </span>
        </Show>
      )}
    />
  </div>
);

export function CollabModeCard() {
  const mode = createCollabMode();
  const { facts, busy } = mode;

  return (
    <Card class="space-y-3" data-cloud-card="collab-mode">
      <PanelHeader
        level={3}
        title={m.cloud_how_you_work_on_this()}
        subtitle={m.cloud_the_shared_project_only_changes()}
      />
      <Show
        when={facts()}
        fallback={
          <p class="text-small text-on-surface-tertiary">{m.cloud_asking_the_shared_project()}</p>
        }
      >
        <ModeChoices mode={mode} />
      </Show>

      <Show when={mode.asking()}>
        <SuggestToForm
          target={mode.target()}
          busy={busy()}
          onSubmit={mode.attachShared}
          onTarget={mode.setTarget}
        />
      </Show>
    </Card>
  );
}
