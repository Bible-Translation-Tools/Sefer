import { useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { Match, Switch, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { AlreadyHeld, announceSourceTexts, cloneArrival } from "#app/arrival";
import { describe } from "#app/describe";
import { contentHostFor } from "#app/endpoints";
import { m } from "#app/paraglide/messages";
import { useShell, type Shell } from "#app/ProjectContext";
import { projectsFrom, standingOf } from "#app/shareLinks";
import { placeOf, sourceUrl, type Source, type VersionStanding } from "#core/project/shareLink";
import { Remote } from "#core/remote/remote";

import { Button, DelayedSpinner, EmptyState, toasts } from "../primitives";

type Phase =
  | { readonly kind: "looking" }
  | { readonly kind: "offer" }
  | { readonly kind: "downloading" }
  | { readonly kind: "unknown"; readonly why: string };

interface Place {
  readonly rest: string;
  readonly query: URLSearchParams;
}

const standingCopy = (
  standing: VersionStanding,
  at: string,
): { title: string; message: string } => {
  const version = at.slice(0, 7);
  switch (standing) {
    case "ahead":
      return {
        title: m.landing_your_copy_is_newer_than(),
        message: m.landing_the_link_was_made_at({ version }),
      };
    case "behind":
      return {
        title: m.landing_this_link_is_newer_than(),
        message: m.landing_it_was_made_at_version({ version }),
      };
    case "unknown":
      return {
        title: m.landing_this_link_may_show_a(),
        message: m.landing_it_was_made_at_version_version({ version }),
      };
    case "same":
    case "other":
      return {
        title: m.landing_this_link_was_made_at(),
        message: m.landing_version_version_check_for_changes({ version }),
      };
  }
};

interface LinkContext {
  readonly shell: Shell;
  readonly navigate: ReturnType<typeof useNavigate>;
  readonly isAlive: () => boolean;
  readonly setPhase: (phase: Phase) => void;
}

const openAt = async (context: LinkContext, root: string, at: Place): Promise<void> => {
  const { shell } = context;
  if (!context.isAlive()) return;
  const kept = new URLSearchParams(at.query);
  const version = kept.get("at") ?? undefined;
  kept.delete("at");
  kept.delete("host");
  const tail = kept.size === 0 ? "" : `?${kept.toString()}`;
  void context.navigate({
    href: `/project/${shell.slugFor(root)}${at.rest}${tail}`,
    replace: true,
  });
  if (version === undefined) return;
  const standing = await shell.services.run(standingOf(root, version));
  if (standing !== "same") toasts.info({ ...standingCopy(standing, version), autoClose: false });
};

const lookFor = (context: LinkContext, named: Source, target: Place, project: string): void => {
  const { shell, setPhase } = context;
  const recent = Object.fromEntries(untrack(shell.recentProjects).map((row) => [row.root, row.at]));
  void shell.services.run(projectsFrom(shell.services, named, recent)).then(async (roots) => {
    if (!context.isAlive()) return;
    const [root] = roots;
    if (root !== undefined) return openAt(context, root, target);
    const probed = await shell.services.run(
      Effect.result(
        Effect.gen(function* () {
          const remote = yield* Remote;
          return yield* remote.probe(sourceUrl(named));
        }),
      ),
    );
    if (!context.isAlive()) return;
    setPhase(
      Result.isSuccess(probed) && !probed.success.empty
        ? { kind: "offer" }
        : {
            kind: "unknown",
            why: m.landing_host_has_no_project_project({
              host: named.host,
              project,
            }),
          },
    );
  });
};

const downloadFrom = (context: LinkContext, named: Source, target: Place): void => {
  const { shell, setPhase } = context;
  setPhase({ kind: "downloading" });
  void shell.services
    .run(Effect.result(cloneArrival(shell.services, "project", sourceUrl(named))))
    .then(async (arrived) => {
      if (Result.isSuccess(arrived)) {
        await announceSourceTexts(shell.services, arrived.success.root, named.base);
        return openAt(context, arrived.success.root, target);
      }
      if (arrived.failure instanceof AlreadyHeld)
        return openAt(context, arrived.failure.root, target);
      toasts.error({
        title: m.landing_could_not_download_the_project(),
        message: describe(arrived.failure),
      });
      if (context.isAlive()) setPhase({ kind: "offer" });
    });
};

type LinkProps = {
  readonly owner: string;
  readonly repo: string;
  readonly rest: string;
  readonly searchStr: string;
};

const createLinkOpening = (props: LinkProps) => {
  const shell = useShell();
  const navigate = useNavigate();
  const [phase, setPhase] = createSignal<Phase>({ kind: "looking" });
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const context: LinkContext = { shell, navigate, isAlive: () => alive, setPhase };

  const query = (): URLSearchParams => new URLSearchParams(props.searchStr);

  const source = (): Source | undefined => {
    const named = query().get("host") ?? contentHostFor(shell.services.settings);
    const at = named === null ? undefined : placeOf(named);
    return at === undefined
      ? undefined
      : { ...at, owner: props.owner.toLowerCase(), repo: props.repo.toLowerCase() };
  };

  const place = (): Place => ({ rest: props.rest, query: query() });

  createEffect(
    () => `${props.owner}/${props.repo}`,
    (project) => {
      const named = untrack(source);
      if (named === undefined) {
        setPhase({
          kind: "unknown",
          why: m.landing_no_cloud_is_set_up(),
        });
        return;
      }
      setPhase({ kind: "looking" });
      lookFor(context, named, untrack(place), project);
    },
  );

  return {
    phase,
    download: (): void => {
      const named = source();
      if (named === undefined) return;
      downloadFrom(context, named, place());
    },
    why: (): string => {
      const held = phase();
      return held.kind === "unknown" ? held.why : "";
    },
    toProjects: (): void => {
      void navigate({ to: "/projects", replace: true });
    },
  };
};

const OfferState = (props: {
  readonly owner: string;
  readonly repo: string;
  readonly downloading: boolean;
  readonly onDownload: () => void;
  readonly onProjects: () => void;
}) => (
  <EmptyState
    title={m.landing_owner_repo_is_not_on({
      owner: props.owner,
      repo: props.repo,
    })}
    description={m.landing_download_it_to_open_the()}
    action={
      <div class="flex gap-2">
        <Button
          data-tour="open-by-link-download"
          onClick={props.onDownload}
          disabled={props.downloading}
        >
          {props.downloading ? m.landing_downloading() : m.common_download()}
        </Button>
        <Button variant="secondary" onClick={props.onProjects}>
          {m.landing_go_to_projects()}
        </Button>
      </div>
    }
  />
);

export function OpenByLink(props: LinkProps) {
  const opening = createLinkOpening(props);
  const { phase } = opening;

  return (
    <main class="flex h-full items-center justify-center p-6" data-testid="open-by-link">
      <Switch>
        <Match when={phase().kind === "looking"}>
          <DelayedSpinner />
        </Match>
        <Match when={phase().kind === "offer" || phase().kind === "downloading"}>
          <OfferState
            owner={props.owner}
            repo={props.repo}
            downloading={phase().kind === "downloading"}
            onDownload={opening.download}
            onProjects={opening.toProjects}
          />
        </Match>
        <Match when={phase().kind === "unknown"}>
          <EmptyState
            title={m.landing_this_link_cannot_be_opened()}
            description={opening.why()}
            action={
              <Button variant="secondary" onClick={opening.toProjects}>
                {m.landing_go_to_projects()}
              </Button>
            }
          />
        </Match>
      </Switch>
    </main>
  );
}
