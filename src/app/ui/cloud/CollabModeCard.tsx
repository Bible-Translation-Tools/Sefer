import type { JSX } from "@solidjs/web";
import Lock from "lucide-solid/icons/lock";
import { Show, createSignal, untrack } from "solid-js";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
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
        value={props.target}
        onInput={(event) => props.onTarget(event.currentTarget.value)}
      />
      <Button size="sm" type="submit" loading={props.busy} disabled={props.target.trim() === ""}>
        {t("Suggest to it")}
      </Button>
    </div>
  </form>
);

const ModeChoices = (props: { readonly mode: ReturnType<typeof createCollabMode> }) => (
  <div class="space-y-2">
    <ModeOption
      mode="shared"
      title={t("Together in the shared project")}
      detail={t("Your changes are sent straight to the shared project everyone works in.")}
      checked={props.mode.effective() === "shared"}
      disabled={props.mode.busy() || props.mode.facts() === undefined}
      onChoose={props.mode.shared}
      blocked={
        props.mode.facts()?.canWrite === false
          ? t("You can suggest changes to this project, not change it directly.")
          : undefined
      }
    />
    <ModeOption
      mode="copy"
      title={t("In my own copy, offering changes when ready")}
      detail={t(
        "Your changes go to your own copy. Offer them when they are ready, and an editor of the shared project brings them in.",
      )}
      checked={props.mode.effective() === "copy"}
      disabled={props.mode.busy() || props.mode.facts() === undefined}
      onChoose={props.mode.copy}
      blocked={
        props.mode.facts()?.canWrite === undefined ? t("Sign in to choose this.") : undefined
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
              {t("Work in my own copy")}
            </Button>
            <span class="text-smallest text-on-surface-tertiary">
              {t("Your copy is made on the shared project's server.")}
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
