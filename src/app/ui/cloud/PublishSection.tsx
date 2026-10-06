/**
 * The cloud popover for a project that is only on this device: publish it as
 * a new shared project, under a name worked out from the project — WACS's
 * `<language>_<resource>`, `en_ulb` — that the person can change. Choosing an
 * existing shared project instead is Settings' Shared project card.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect } from "effect";
import { Show, createSignal } from "solid-js";

import { Git } from "#core/git/git";
import type { Project } from "#core/project/project";
import { Remote } from "#core/remote/remote";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { Button, Input, toasts } from "../primitives";
import { metadataOf } from "../workspace/project";

/** WACS's own naming, `<language>_<resource>`, else the folder's name. */
const suggestedName = (project: Project): string => {
  const metadata = metadataOf(project);
  const language = metadata?.language.tag ?? "";
  const resource = metadata?.id ?? "";
  const named =
    language !== "" && resource !== "" && !resource.includes(language)
      ? `${language}_${resource}`
      : resource !== ""
        ? resource
        : project.root.slice(project.root.lastIndexOf("/") + 1);
  return named.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-");
};

export function PublishSection(props: {
  readonly signedIn: boolean;
  readonly onLeave: () => void;
}) {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const opened = shell.project();
  const [name, setName] = createSignal(opened === undefined ? "" : suggestedName(opened), {
    name: "publishName",
  });
  const [busy, setBusy] = createSignal(false, { name: "publishBusy" });

  const publish = (event: SubmitEvent): void => {
    event.preventDefault();
    const project = shell.project();
    // Read at the moment of the press, not when the handler was made.
    const staticName = name().trim();
    if (project === undefined || staticName === "" || busy()) return;
    setBusy(true);
    void services
      .run(
        Effect.gen(function* () {
          const git = yield* Git;
          const remote = yield* Remote;
          yield* remote.publish(yield* git.init(project.root), staticName);
        }),
      )
      .then(() => toasts.success({ title: t("Published as {name}", { name: staticName }) }))
      .catch((cause: unknown) =>
        toasts.error({ title: t("Could not publish"), message: describe(cause) }),
      )
      .finally(() => {
        setBusy(false);
        void syncWatch.refresh(services, project).catch(() => undefined);
        void collaboration.refresh(services, project);
      });
  };

  return (
    <Show when={props.signedIn}>
      <form
        class="space-y-2 border-t border-surface-border pt-3"
        onSubmit={publish}
        data-sync-publish
      >
        <p class="text-small text-on-surface-secondary">
          {t("Publish it to work on it with others, or to keep a copy safe online.")}
        </p>
        <div class="flex items-center gap-2">
          <Input
            size="sm"
            wrapperClass="min-w-0 flex-1"
            aria-label={t("Name of the shared project")}
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
          />
          <Button
            size="sm"
            type="submit"
            variant="primary"
            loading={busy()}
            disabled={name().trim() === ""}
          >
            {t("Publish")}
          </Button>
        </div>
        <button
          type="button"
          class="text-smallest text-brand underline"
          onClick={() => {
            props.onLeave();
            void navigate({ to: "/settings" });
          }}
        >
          {t("Or choose a shared project that already exists")}
        </button>
      </form>
    </Show>
  );
}
