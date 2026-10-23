import { useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { Match, Switch, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { announceSourceTexts, cloneArrival } from "#app/arrival";
import { describe } from "#app/describe";
import { contentHostFor } from "#app/endpoints";
import { t } from "#app/i18n";
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
        title: t("Your copy is newer than this link"),
        message: t(
          "The link was made at version {version}; you are seeing later work on top of it.",
          { version },
        ),
      };
    case "behind":
      return {
        title: t("This link is newer than your copy"),
        message: t(
          "It was made at version {version}. Get the changes from the shared project to see what it shows.",
          { version },
        ),
      };
    case "unknown":
      return {
        title: t("This link may show a different version"),
        message: t(
          "It was made at version {version}. Your copy holds only its newest history, so Sefer cannot tell whether that version is older; History can bring in the rest.",
          { version },
        ),
      };
    case "same":
    case "other":
      return {
        title: t("This link was made at a version your copy does not have"),
        message: t(
          "Version {version}. Check for changes; if that does not bring it, the sender may not have sent it yet.",
          { version },
        ),
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
            why: t("{host} has no project {project} that this device can see.", {
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
    .run(
      Effect.result(
        cloneArrival(shell.services, "project", sourceUrl(named), { freeFolder: true }),
      ),
    )
    .then(async (arrived) => {
      if (Result.isSuccess(arrived)) {
        await announceSourceTexts(shell.services, arrived.success.root, named.base);
        return openAt(context, arrived.success.root, target);
      }
      toasts.error({
        title: t("Could not download the project"),
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
          why: t("No cloud is set up on this device to look for it on."),
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
    title={t("{owner}/{repo} is not on this device yet", {
      owner: props.owner,
      repo: props.repo,
    })}
    description={t("Download it to open the link. It is added to your projects.")}
    action={
      <div class="flex gap-2">
        <Button
          data-tour="open-by-link-download"
          onClick={props.onDownload}
          disabled={props.downloading}
        >
          {props.downloading ? t("Downloading…") : t("Download")}
        </Button>
        <Button variant="secondary" onClick={props.onProjects}>
          {t("Go to projects")}
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
            title={t("This link cannot be opened here")}
            description={opening.why()}
            action={
              <Button variant="secondary" onClick={opening.toProjects}>
                {t("Go to projects")}
              </Button>
            }
          />
        </Match>
      </Switch>
    </main>
  );
}
