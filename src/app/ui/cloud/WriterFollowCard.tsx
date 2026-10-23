/**
 * Settings' Cloud section, for a project whose books follow their Writer
 * projects: how many do, and the one way to stop.
 *
 * While a project follows them, checking Writer is part of every check for
 * changes, with no switch of its own to forget (Will, 2026-10-06). Stopping is
 * a version — `.upstreams.json` emptied — so a teammate who receives it stops
 * too; the Writer projects themselves are not touched.
 */

import { Effect } from "effect";
import { Show, createEffect, createSignal } from "solid-js";

import { projectUpstreams } from "#core/migrate/writerWork";

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell, type Shell } from "../../ProjectContext";
import { stopFollowingWriter } from "../../writerWatch";
import { Button, Card, PanelHeader, toasts } from "../primitives";

const createFollowedCount = (services: Shell["services"], root: () => string) => {
  const [followed, setFollowed] = createSignal(0, { name: "writerFollowed" });
  createEffect(root, (at) => {
    void services
      .run(projectUpstreams(services.fileSystem, at))
      .then((upstreams) => setFollowed(new Set(upstreams.flatMap((each) => each.books)).size));
  });
  return [followed, setFollowed] as const;
};

const StopConfirm = (props: {
  readonly followed: number;
  readonly busy: boolean;
  readonly onStop: () => void;
  readonly onCancel: () => void;
}) => (
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-small">
      {t("Stop following all {count}? This is recorded as a version.", {
        count: props.followed,
      })}
    </span>
    <Button
      variant="danger"
      size="sm"
      data-testid="writer-stop"
      loading={props.busy}
      disabled={props.busy}
      onClick={props.onStop}
    >
      {t("Stop following")}
    </Button>
    <Button variant="tertiary" size="sm" onClick={props.onCancel}>
      {t("Cancel")}
    </Button>
  </div>
);

export function WriterFollowCard(props: { readonly root: string }) {
  const { services } = useShell();
  const [followed, setFollowed] = createFollowedCount(services, () => props.root);
  const [asking, setAsking] = createSignal(false, { name: "writerStopAsking" });
  const [busy, setBusy] = createSignal(false, { name: "writerStopBusy" });

  const stop = (): void => {
    const root = props.root;
    setBusy(true);
    void (async () => {
      try {
        await services.run(Effect.asVoid(stopFollowingWriter(services, root)));
        setFollowed(0);
        toasts.success({ title: t("Stopped following the Writer projects") });
      } catch (cause) {
        toasts.error({ title: t("Could not stop following"), message: describe(cause) });
      } finally {
        setBusy(false);
        setAsking(false);
      }
    })();
  };

  return (
    <Show when={followed() > 0}>
      <Card class="space-y-3" data-cloud-card="writer">
        <PanelHeader level={3} title={t("Writer projects")} />
        <p class="text-small text-on-surface-secondary">
          {t(
            "{count} books follow the BTT Writer projects they came from. Every check for changes asks them for new work, after the shared project.",
            { count: followed() },
          )}
        </p>
        <Show
          when={asking()}
          fallback={
            <Button variant="secondary" size="sm" onClick={() => setAsking(true)}>
              {t("Stop following Writer projects…")}
            </Button>
          }
        >
          <StopConfirm
            followed={followed()}
            busy={busy()}
            onStop={stop}
            onCancel={() => setAsking(false)}
          />
        </Show>
      </Card>
    </Show>
  );
}
