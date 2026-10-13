import { useNavigate } from "@tanstack/solid-router";
import { Effect, Result } from "effect";
import { Match, Switch, createEffect, createSignal, onCleanup, untrack } from "solid-js";

import { announceSourceTexts, cloneArrival } from "#app/arrival";
import { describe } from "#app/describe";
import { contentHostFor } from "#app/endpoints";
import { t } from "#app/i18n";
import { useShell } from "#app/ProjectContext";
import { projectsFrom, standingOf } from "#app/shareLinks";
import { placeOf, sourceUrl, type Source, type VersionStanding } from "#core/project/shareLink";
import { Remote } from "#core/remote/remote";

import { Button, DelayedSpinner, EmptyState, toasts } from "../primitives";

/**
 * `/r/<owner>/<repo>/…` — a share link arriving (`core/project/shareLink.ts`).
 *
 * The one question it asks is whether this device holds a project that came
 * from that shared project. Held: open it at the same place, under this
 * device's own slug, and say so when the copy is not at the version the link
 * was made at. Not held: offer to download it when the host has it, and say
 * the link cannot be followed when it does not.
 *
 * It never checks out the link's version. The copy may hold work of its own,
 * and "show me what they saw" is a question the toast answers with words; the
 * sync popover is where the copy is brought up to date.
 */

type Phase =
  | { readonly kind: "looking" }
  | { readonly kind: "offer" }
  | { readonly kind: "downloading" }
  | { readonly kind: "unknown"; readonly why: string };

/** The place a link names: its path after the project, and its query. */
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

export function OpenByLink(props: {
  readonly owner: string;
  readonly repo: string;
  /** Everything after `/r/<owner>/<repo>`, starting with `/`, or empty. */
  readonly rest: string;
  /**
   * The query string as the router serialises it. The router reads each value
   * as JSON first, so a commit id made only of digits would come back as a
   * number; a real commit id has letters in it, and comes through as written.
   */
  readonly searchStr: string;
}) {
  const shell = useShell();
  const navigate = useNavigate();
  const [phase, setPhase] = createSignal<Phase>({ kind: "looking" });
  // The lookups and the download answer after a wait; once the person has
  // left this screen they must not navigate away from wherever they went.
  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  const query = (): URLSearchParams => new URLSearchParams(props.searchStr);

  const source = (): Source | undefined => {
    // `host=` is a bare host or a whole base (scheme and path prefix); with
    // none, the configured cloud, whose own scheme and prefix are kept.
    const named = query().get("host") ?? contentHostFor(shell.services.settings);
    const at = named === null ? undefined : placeOf(named);
    return at === undefined
      ? undefined
      : { ...at, owner: props.owner.toLowerCase(), repo: props.repo.toLowerCase() };
  };

  /** Opens `root` at the link's place, and says how its version stands. */
  const place = (): Place => ({ rest: props.rest, query: query() });

  const openAt = async (root: string, at: Place): Promise<void> => {
    if (!alive) return;
    const kept = new URLSearchParams(at.query);
    const version = kept.get("at") ?? undefined;
    kept.delete("at");
    kept.delete("host");
    const tail = kept.size === 0 ? "" : `?${kept.toString()}`;
    void navigate({ href: `/project/${shell.slugFor(root)}${at.rest}${tail}`, replace: true });
    if (version === undefined) return;
    const standing = await shell.services.run(standingOf(root, version));
    if (standing !== "same") toasts.info({ ...standingCopy(standing, version), autoClose: false });
  };

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
      const target = untrack(place);
      const recent = Object.fromEntries(
        untrack(shell.recentProjects).map((row) => [row.root, row.at]),
      );
      void shell.services.run(projectsFrom(shell.services, named, recent)).then(async (roots) => {
        if (!alive) return;
        const [root] = roots;
        if (root !== undefined) return openAt(root, target);
        const probed = await shell.services.run(
          Effect.result(
            Effect.gen(function* () {
              const remote = yield* Remote;
              return yield* remote.probe(sourceUrl(named));
            }),
          ),
        );
        if (!alive) return;
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
    },
  );

  const download = (): void => {
    const named = source();
    if (named === undefined) return;
    const target = place();
    setPhase({ kind: "downloading" });
    void shell.services
      .run(
        Effect.result(
          cloneArrival(shell.services, "project", sourceUrl(named), { freeFolder: true }),
        ),
      )
      .then(async (arrived) => {
        // The source texts the project declares come with it, as from every
        // other import, and BEFORE the place opens: a link into a screen
        // that reads beside the source (Find's reference scope) needs them
        // registered when it mounts.
        if (Result.isSuccess(arrived)) {
          await announceSourceTexts(shell.services, arrived.success.root, named.base);
          return openAt(arrived.success.root, target);
        }
        toasts.error({
          title: t("Could not download the project"),
          message: describe(arrived.failure),
        });
        if (alive) setPhase({ kind: "offer" });
      });
  };

  const why = (): string => {
    const held = phase();
    return held.kind === "unknown" ? held.why : "";
  };

  const toProjects = (): void => {
    void navigate({ to: "/projects", replace: true });
  };

  return (
    <main class="flex h-full items-center justify-center p-6" data-testid="open-by-link">
      <Switch>
        <Match when={phase().kind === "looking"}>
          <DelayedSpinner />
        </Match>
        <Match when={phase().kind === "offer" || phase().kind === "downloading"}>
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
                  onClick={download}
                  disabled={phase().kind === "downloading"}
                >
                  {phase().kind === "downloading" ? t("Downloading…") : t("Download")}
                </Button>
                <Button variant="secondary" onClick={toProjects}>
                  {t("Go to projects")}
                </Button>
              </div>
            }
          />
        </Match>
        <Match when={phase().kind === "unknown"}>
          <EmptyState
            title={t("This link cannot be opened here")}
            description={why()}
            action={
              <Button variant="secondary" onClick={toProjects}>
                {t("Go to projects")}
              </Button>
            }
          />
        </Match>
      </Switch>
    </main>
  );
}
