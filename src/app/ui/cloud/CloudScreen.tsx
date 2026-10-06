/**
 * `/cloud` — what is left of the sync screen once sync moved to the app bar.
 *
 * Doing sync is the cloud popover's: the state, the clocks, what would
 * arrive, the one right move, signing in and out. Every receive goes through
 * Review, which settles a contested or diverged project as well. Settings'
 * Cloud section holds the account, the shared project and the per-project
 * switches. What this screen still shows is where the project stands in full,
 * the incoming plan, suggested changes, and — when the next step is to attach
 * or publish — the shared-project card.
 *
 * The screen holds no domain state. The session lives in `Credentials`
 * (through `Gitea`), the attachment lives in the repository's own `origin`,
 * and the state is derived fresh from a reading by the pure machine in
 * `src/core/sync` — so a reload, a second window, or the fixture below all
 * show the same truth rather than a copy of it.
 */

import CloudIcon from "lucide-solid/icons/cloud";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";

import { emptyPlan, sync, wantsPlan, type IncomingPlan } from "#core/sync";

import { describe } from "../../describe";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { syncStatus } from "../../syncStatus";
import { syncWatch } from "../../syncWatch";
import { Card, EmptyState, PanelHeader } from "../primitives";
import { createAccount } from "./account";
import { DevStateSwitcher } from "./DevStateSwitcher";
import { fixtureFacts, fixtureStateRequested } from "./fixture";
import { IncomingPlanCard } from "./IncomingPlanCard";
import { ProjectCard } from "./ProjectCard";
import type { ReadSyncOptions, SyncFacts } from "./reading";
import { SharedProjectCard } from "./SharedProjectCard";
import { SuggestionsCard } from "./SuggestionsCard";

/** A project's folder name, which is what a person calls it. */
const projectName = (root: string): string => root.slice(root.lastIndexOf("/") + 1);

export function CloudScreen() {
  const shell = useShell();
  const { services } = shell;
  const account = createAccount(shell);
  const network = syncStatus;

  // The reading is the application's (`syncWatch`), not this screen's: the
  // app bar and Review show the same one, and a check or a send anywhere
  // updates all of them.
  const facts = (): SyncFacts | undefined => syncWatch.facts(shell.project()?.root);
  const fetchedAt = (): number | undefined => {
    const root = shell.project()?.root;
    return root === undefined ? undefined : syncWatch.fetchedAt(root);
  };
  const [problem, setProblem] = createSignal("", { name: "syncProblem" });

  /**
   * DEV only: `?syncState=diverged` renders the fixture's facts instead of the
   * repository's, through the same derivation and the same cards. Production
   * never evaluates this — `import.meta.env.DEV` is a constant Vite folds away
   * — and the application's composition is untouched either way.
   */
  const [fixtureState, setFixtureState] = createSignal(fixtureStateRequested(), {
    name: "syncFixture",
  });
  // The param is read at mount; a later `history.pushState` to a different
  // `?syncState=` (which is how an agent drives this screen) has to be heard
  // too, or the URL and the screen disagree. Dev only, like everything else
  // about the fixture.
  if (import.meta.env.DEV && typeof window === "object") {
    const follow = (): void => {
      setFixtureState(fixtureStateRequested());
    };
    window.addEventListener("popstate", follow);
    onCleanup(() => window.removeEventListener("popstate", follow));
  }

  const fixtured = (): SyncFacts | undefined => {
    if (!import.meta.env.DEV) return undefined;
    const asked = fixtureState();
    return asked === undefined ? undefined : fixtureFacts(asked);
  };

  const shown = (): SyncFacts | undefined => fixtured() ?? facts();
  const current = () => {
    const held = shown();
    if (held === undefined) return undefined;
    return sync(held.reading, held.plan.contested.length > 0);
  };
  const plan = (): IncomingPlan => shown()?.plan ?? emptyPlan;

  /**
   * What to call the project on screen, and whether there is one at all.
   *
   * A fixture stands in for an open project deliberately: every state has to
   * be reachable in a dev build without importing a repository first, and the
   * cards below are the ones a real project renders — only the facts differ.
   */
  const named = (): string | undefined => {
    const project = shell.project();
    if (project !== undefined) return projectName(project.root);
    return fixtured() === undefined ? undefined : t("Mark project (fixture)");
  };

  /**
   * Everything one reading depends on, gathered by READING THE SIGNALS.
   *
   * It is a function rather than five arguments because it is called from two
   * places with opposite tracking rules: inside the effect's compute (where
   * reading a signal is what subscribes to it) and from the shared-project
   * card's `onChanged` (a deliberate one-shot snapshot). Solid 2 runs an
   * effect's CALLBACK untracked, so gathering there would both fail to
   * subscribe and trip `STRICT_READ_UNTRACKED`.
   */
  const ask = (): ReadSyncOptions | undefined => {
    const project = shell.project();
    // Reading the session subscribes this to signing in and out, which changes
    // the answer even though the value is not passed through.
    account.session();
    if (project === undefined || fixtureState() !== undefined) return undefined;
    return {
      root: project.root,
      project,
      host: account.host,
      online: network.online(),
      lastFailure: network.lastFailure(),
      checking: network.checking(project.root),
      sendRefused: network.sendRefused(),
      fetchedAt: fetchedAt(),
    };
  };

  /** One pass over the repository, published for every surface (`syncWatch.survey`). */
  const load = (options: ReadSyncOptions | undefined): void => {
    if (options === undefined) return;
    syncWatch.survey(services, options).catch((cause: unknown) => setProblem(describe(cause)));
  };

  // Solid 2 has no `onMount`; an effect whose compute gathers the reading's
  // inputs runs once at mount and again whenever one of them moves — which is
  // the same thing, plus the reason to re-run.
  createEffect(ask, load);

  return (
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6" data-screen="cloud">
      <PanelHeader level={2} title={t("Sync")} subtitle={t("Where your work is.")} />

      <Show when={import.meta.env.DEV}>
        <DevStateSwitcher value={fixtureState()} onChange={setFixtureState} />
      </Show>

      <Show
        when={named()}
        fallback={
          <Card data-cloud-card="no-project">
            <EmptyState
              icon={<CloudIcon aria-hidden="true" />}
              title={t("No project is open")}
              description={t("Open a project to see where its work stands with the cloud.")}
            />
          </Card>
        }
      >
        {(name) => (
          <Show when={current()} fallback={<Card>{t("Reading this project…")}</Card>}>
            {(held) => (
              <>
                <ProjectCard sync={held()} plan={plan()} projectName={name()} />

                <Show when={wantsPlan(held().state) && plan().books.length > 0}>
                  <IncomingPlanCard plan={plan()} />
                </Show>

                <Show when={problem() !== ""}>
                  <p class="text-small break-words text-on-surface-error">{problem()}</p>
                </Show>

                {/* Suggested changes: one topology among several, one card. */}
                <Show when={shell.project()}>
                  {(project) => (
                    <SuggestionsCard project={project()} signedIn={held().reading.signedIn} />
                  )}
                </Show>

                <Show when={held().primary === "attach" || held().primary === "publish"}>
                  <SharedProjectCard
                    account={account}
                    root={shell.project()?.root}
                    onChanged={() => load(ask())}
                  />
                </Show>
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
