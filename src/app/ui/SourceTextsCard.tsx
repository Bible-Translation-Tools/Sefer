/**
 * Settings: the source texts this device holds in its Library, and the one
 * thing to do with one that is not reading it — "Edit as your own project".
 *
 * Tucked here rather than on the reference pane (Will, 2026-10-08): it is an
 * internal's move, made rarely, and a pencil on every pane read as the way to
 * work on a text. It is a full move — the copy leaves the Library for the
 * projects folder (`adoptAsProject`) — so it asks first, inline, and says what
 * it changes for the projects that read it.
 */

import { Effect, Result } from "effect";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Resource } from "#core/resources/library";

import { adoptAsProject, libraryRevision } from "../arrival";
import { t } from "../i18n";
import { roleFor } from "../kinds/table";
import { useShell } from "../ProjectContext";
import { Button, Card, PanelHeader, toasts } from "./primitives";

interface SourceTextRowProps {
  readonly resource: Resource;
  readonly asking: boolean;
  readonly busy: boolean;
  readonly onAsk: () => void;
  readonly onCancel: () => void;
  readonly onAdopt: () => void;
}

function SourceTextRow(props: SourceTextRowProps) {
  return (
    <li class="flex flex-wrap items-center gap-3 py-2" data-source-text={props.resource.id}>
      <span class="min-w-0 flex-1 truncate text-small">
        <span class="font-medium">{props.resource.title}</span>
        <span class="text-on-surface-tertiary">
          {[props.resource.language, props.resource.version]
            .filter((part) => part !== undefined && part !== "")
            .map((part) => ` · ${part}`)
            .join("")}
        </span>
      </span>
      <Show
        when={props.asking}
        fallback={
          <Button
            size="sm"
            variant="tertiary"
            data-testid={`adopt-${props.resource.id}`}
            onClick={() => props.onAsk()}
          >
            {t("Edit as your own project…")}
          </Button>
        }
      >
        <span class="flex items-center gap-2">
          <Button size="sm" variant="tertiary" onClick={() => props.onCancel()}>
            {t("Cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={props.busy}
            disabled={props.busy}
            onClick={() => props.onAdopt()}
          >
            {t("Move to my projects")}
          </Button>
        </span>
      </Show>
    </li>
  );
}

export function SourceTextsCard() {
  const { services } = useShell();
  const [copies, setCopies] = createSignal<readonly Resource[]>([], { name: "settingsCopies" });
  const [asking, setAsking] = createSignal<string | undefined>(undefined, {
    name: "settingsAdoptAsking",
  });
  const [busy, setBusy] = createSignal(false, { name: "settingsAdoptBusy" });

  createEffect(
    () => libraryRevision(),
    () => {
      void services
        .run(services.library.resources())
        .then((held) =>
          setCopies(
            held.filter(
              (resource) =>
                resource.root.startsWith(`${services.libraryRoot}/`) &&
                roleFor(resource) === "source",
            ),
          ),
        );
    },
  );

  const adopt = (resource: Resource): void => {
    setBusy(true);
    void services.run(Effect.result(adoptAsProject(services, resource))).then((outcome) => {
      setBusy(false);
      setAsking(undefined);
      if (Result.isFailure(outcome)) {
        toasts.error({ title: t("Could not move {title}", { title: resource.title }) });
        return;
      }
      toasts.success({
        title: t("{title} is now one of your projects", { title: resource.title }),
      });
    });
  };

  return (
    <Show when={copies().length > 0}>
      <Card class="space-y-2" data-settings-group="source-texts">
        <PanelHeader
          level={3}
          title={t("Source texts on this device")}
          subtitle={t(
            "Downloaded to read beside your projects. Editing one makes it your own project: it leaves this list, and projects that read it download the official text again.",
          )}
        />
        <ul class="divide-y divide-surface-border">
          <For each={copies()}>
            {(resource) => (
              <SourceTextRow
                resource={resource}
                asking={asking() === resource.id}
                busy={busy()}
                onAsk={() => setAsking(resource.id)}
                onCancel={() => setAsking(undefined)}
                onAdopt={() => adopt(resource)}
              />
            )}
          </For>
        </ul>
      </Card>
    </Show>
  );
}
