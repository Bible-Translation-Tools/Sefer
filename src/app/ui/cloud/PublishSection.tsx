import { useNavigate } from "@tanstack/solid-router";
import { Effect } from "effect";
import { Show, createSignal, untrack } from "solid-js";

import { m } from "#app/paraglide/messages";
import { Git } from "#core/git/git";
import type { Project } from "#core/project/project";
import { Remote } from "#core/remote/remote";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { useShell, type Shell } from "../../ProjectContext";
import { syncWatch } from "../../syncWatch";
import { Button, Input, toasts } from "../primitives";
import { metadataOf } from "../workspace/project";

const suggestedName = (project: Project): string => {
  const metadata = metadataOf(project);
  const language = metadata?.language.tag ?? "";
  const resource = metadata?.id ?? "";
  const folder = project.root.slice(project.root.lastIndexOf("/") + 1);
  let named = resource !== "" ? resource : folder;
  if (language !== "" && resource !== "" && !resource.includes(language))
    named = `${language}_${resource}`;
  return named.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-");
};

const publishProject = (
  services: Shell["services"],
  project: Project,
  staticName: string,
  settled: () => void,
): void => {
  void services
    .run(
      Effect.gen(function* () {
        const git = yield* Git;
        const remote = yield* Remote;
        yield* remote.publish(yield* git.init(project.root), staticName);
      }),
    )
    .then(() => toasts.success({ title: m.cloud_published_as_name({ name: staticName }) }))
    .catch((cause: unknown) =>
      toasts.error({ title: m.cloud_could_not_publish(), message: describe(cause) }),
    )
    .finally(() => {
      settled();
      void syncWatch.refresh(services, project).catch(() => undefined);
      void collaboration.refresh(services, project);
    });
};

const NameRow = (props: {
  readonly name: string;
  readonly busy: boolean;
  readonly onName: (value: string) => void;
}) => (
  <div class="flex items-center gap-2">
    <Input
      size="sm"
      wrapperClass="min-w-0 flex-1"
      aria-label={m.cloud_name_of_the_shared_project()}
      value={props.name}
      onInput={(event) => props.onName(event.currentTarget.value)}
    />
    <Button
      size="sm"
      type="submit"
      variant="primary"
      loading={props.busy}
      disabled={props.name.trim() === ""}
    >
      {m.cloud_publish()}
    </Button>
  </div>
);

export function PublishSection(props: {
  readonly signedIn: boolean;
  readonly onLeave: () => void;
}) {
  const shell = useShell();
  const navigate = useNavigate();
  const { services } = shell;
  const opened = untrack(() => shell.project());
  const [name, setName] = createSignal(opened === undefined ? "" : suggestedName(opened), {
    name: "publishName",
  });
  const [busy, setBusy] = createSignal(false, { name: "publishBusy" });

  const publish = (event: SubmitEvent): void => {
    event.preventDefault();
    const project = shell.project();
    const staticName = name().trim();
    if (project === undefined || staticName === "" || busy()) return;
    setBusy(true);
    publishProject(services, project, staticName, () => setBusy(false));
  };

  return (
    <Show when={props.signedIn}>
      <form
        class="space-y-2 border-t border-surface-border pt-3"
        onSubmit={publish}
        data-sync-publish
      >
        <p class="text-small text-on-surface-secondary">{m.cloud_publish_it_to_work_on()}</p>
        <NameRow name={name()} busy={busy()} onName={setName} />
        <button
          type="button"
          class="text-smallest text-brand underline"
          onClick={() => {
            props.onLeave();
            void navigate({ to: "/project/$slug/settings", params: { slug: shell.slug() } });
          }}
        >
          {m.cloud_or_choose_a_shared_project()}
        </button>
      </form>
    </Show>
  );
}
