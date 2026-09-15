/**
 * `/cloud` — cloud sync as a translator meets it.
 *
 * Four cards, in the order someone actually asks the questions: who am I,
 * which shared project is this and where do the two clocks stand, what would
 * arrive if I received it, and what is the one right thing to press now.
 *
 * The screen holds no domain state. The session lives in `Credentials`
 * (through `Gitea`), the attachment lives in the repository's own `origin`,
 * and the state is derived fresh from a reading by the pure machine in
 * `src/core/sync` — so a reload, a second window, or the fixture below all
 * show the same truth rather than a copy of it.
 *
 * Nothing transfers on its own. Every state on this page is reached by
 * looking, and every transfer is a button someone pressed. Two of them take
 * two presses: a pull, where the plan card says what would arrive and the
 * confirmation is the second, and a combine, where the first press works out
 * which books keep this device's version and a dialog names them.
 */

import { Effect, Fiber, type FileSystem, Stream } from "effect";
import CloudIcon from "lucide-solid/icons/cloud";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Git } from "../../../core/git/git";
import { Remote, type RemoteFailureReason } from "../../../core/remote/remote";
import {
  combine,
  CombineError,
  emptyPlan,
  previewCombine,
  sync,
  wantsPlan,
  type CombineReplay,
  type IncomingPlan,
  type SyncActionId,
} from "../../../core/sync";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, Dialog, EmptyState, PanelHeader } from "../primitives";
import { createAccount, describe } from "./account";
import { AccountCard } from "./AccountCard";
import { ActionCard } from "./ActionCard";
import { bookFromPath, combineRefusal, combineTrouble, narrate } from "./copy";
import { DevStateSwitcher } from "./DevStateSwitcher";
import { fixtureFacts, fixtureReplay, fixtureStateRequested } from "./fixture";
import { IncomingPlanCard } from "./IncomingPlanCard";
import { createNetworkStatus } from "./network";
import { ProjectCard } from "./ProjectCard";
import { readSync, type ReadSyncOptions, type SyncFacts } from "./reading";

/** A project's folder name, which is what a person calls it. */
const projectName = (root: string): string => root.slice(root.lastIndexOf("/") + 1);

/**
 * Who the combined version is by.
 *
 * Sefer, not the translator: the one version a combine records is bookkeeping
 * over versions they already authored, the same identity `src/app/commands.ts`
 * commits a save under and the Web host writes a merge under.
 */
const COMBINE_AUTHOR = { name: "Sefer", email: "sefer@localhost" } as const;

/**
 * A combine's failure, as the sentence a translator reads.
 *
 * A refusal names the rule; anything else names where the work is now, which
 * is the only question worth answering when a transfer stopped part-way.
 */
const explainCombine = (cause: unknown): string | undefined => {
  if (!(cause instanceof CombineError)) return undefined;
  return cause.refusal === undefined ? combineTrouble(cause.state) : combineRefusal(cause.refusal);
};

/**
 * A `RemoteError`'s reason, read out of the line `describe` makes of it. The
 * promise's type does not carry the tagged error's shape, and the reason is
 * the first word of that line — which is enough to tell "the network did not
 * answer" from "the far side said no", and that distinction is the whole
 * difference between `offline` and a refusal worth reading.
 */
const reasonOf = (cause: unknown): RemoteFailureReason | undefined => {
  const message = describe(cause);
  if (/Unauthorized/u.test(message)) return "Unauthorized";
  if (/Network/u.test(message)) return "Network";
  if (/Unavailable/u.test(message)) return "Unavailable";
  if (/Rejected/u.test(message)) return "Rejected";
  return undefined;
};

export function CloudScreen() {
  const shell = useShell();
  const { services } = shell;
  const account = createAccount(shell);
  const network = createNetworkStatus();

  const [facts, setFacts] = createSignal<SyncFacts | undefined>(undefined, { name: "syncFacts" });
  const [fetchedAt, setFetchedAt] = createSignal<number | undefined>(undefined, {
    name: "lastFetchedAt",
  });
  const [busy, setBusy] = createSignal(false, { name: "syncBusy" });
  const [phase, setPhase] = createSignal("", { name: "syncPhase" });
  const [problem, setProblem] = createSignal("", { name: "syncProblem" });
  /** A pull is confirmed against the plan the person actually read. */
  const [confirming, setConfirming] = createSignal(false, { name: "syncConfirming" });
  /**
   * The combine a person is being asked about, or `undefined` when none is.
   *
   * It holds the REPLAY rather than a boolean because the question is "these
   * books keep your version — go ahead?", and a dialog that could not name
   * them would be asking somebody to agree to something unstated.
   */
  const [combining, setCombining] = createSignal<CombineReplay | undefined>(undefined, {
    name: "syncCombining",
  });

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
   * reading a signal is what subscribes to it) and inside a transfer's
   * continuation (where it is a deliberate one-shot snapshot). Solid 2 runs an
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
      host: account.host,
      online: network.online(),
      lastFailure: network.lastFailure(),
      fetchedAt: fetchedAt(),
    };
  };

  /** One pass over the repository. */
  const load = (options: ReadSyncOptions | undefined): void => {
    if (options === undefined) return;
    void services
      .run(readSync(options))
      .then(setFacts)
      .catch((cause: unknown) => setProblem(describe(cause)));
  };

  // Solid 2 has no `onMount`; an effect whose compute gathers the reading's
  // inputs runs once at mount and again whenever one of them moves — which is
  // the same thing, plus the reason to re-run.
  createEffect(ask, load);

  // The progress line. A forked fiber rather than an awaited effect, because
  // the stream never completes; it is interrupted when the screen unmounts.
  // The interrupt is registered in the COMPONENT body: Solid 2 runs an effect
  // callback unowned, so an `onCleanup` in there is never honoured.
  let progressFiber: Fiber.Fiber<void, unknown> | undefined;
  onCleanup(() => {
    if (progressFiber !== undefined) Effect.runFork(Fiber.interrupt(progressFiber));
  });
  // The component body IS the mount in Solid 2, so the fork happens here.
  progressFiber = services.runtime.runFork(
    Effect.flatMap(Remote, (remote) =>
      Stream.runForEach(remote.progress(), (progress) =>
        Effect.sync(() =>
          setPhase(
            progress.total === undefined
              ? t("{phase} {loaded}", { phase: progress.phase, loaded: progress.loaded })
              : t("{phase} {loaded}/{total}", {
                  phase: progress.phase,
                  loaded: progress.loaded,
                  total: progress.total,
                }),
          ),
        ),
      ),
    ),
  );

  /**
   * Every transfer, through one place: report the failure by reason (so the
   * network status learns about it), clear the phase line, and re-read.
   *
   * `explain` is how a press with its own vocabulary — Combine — turns its
   * typed failure into the sentence a translator reads. Returning `undefined`
   * falls back to the ordinary description.
   */
  const transfer = (
    work: (root: string) => Effect.Effect<unknown, unknown, Git | Remote | FileSystem.FileSystem>,
    explain?: (cause: unknown) => string | undefined,
  ): void => {
    const project = shell.project();
    if (project === undefined) return;
    setProblem("");
    setBusy(true);
    void services
      .run(work(project.root))
      .then(() => {
        network.noteSuccess();
        setFetchedAt(Date.now());
      })
      .catch((cause: unknown) => {
        const reason = reasonOf(cause);
        if (reason !== undefined) network.noteFailure(reason);
        setProblem(explain?.(cause) ?? describe(cause));
      })
      // A press's continuation, not a tracked scope: `refresh` reads signals
      // deliberately, once, when the transfer has finished. The reactivity
      // rule's warning here is the intended shape — re-running this on a
      // signal change would re-read the repository on every keystroke.
      .finally(() => {
        setBusy(false);
        setPhase("");
        load(ask());
      });
  };

  const fetchOnly = (root: string) =>
    Effect.gen(function* () {
      const git = yield* Git;
      const remote = yield* Remote;
      // A bare fetch touches no file in the work tree, which is what makes it
      // the safe thing to run on a "check for changes".
      return yield* remote.fetch(yield* git.open(root));
    });

  const pull = (root: string) =>
    Effect.gen(function* () {
      const git = yield* Git;
      const remote = yield* Remote;
      return yield* remote.pull(yield* git.open(root));
    });

  const push = (root: string) =>
    Effect.gen(function* () {
      const git = yield* Git;
      const remote = yield* Remote;
      return yield* remote.push(yield* git.open(root));
    });

  /**
   * Resolve: throw away the merge a transfer left half-finished, so the work
   * tree is HEAD again and the next press is an ordinary one.
   *
   * `abortMerge` refuses when nothing is in progress — it is a hard reset
   * underneath — so pressing this on a healthy project says so rather than
   * discarding a morning's writing.
   */
  const abortMerge = (root: string) =>
    Effect.gen(function* () {
      const git = yield* Git;
      const remote = yield* Remote;
      return yield* remote.abortMerge(yield* git.open(root));
    });

  /**
   * The first of Combine's two presses: work out what WOULD be replayed, and
   * put that to the person.
   *
   * The preview is local and asks the shared project nothing — it reads the
   * object database the last check left behind. `combine` fetches and decides
   * again for real, so a shared project that moved between this dialog opening
   * and the second press is caught there rather than trusted from here.
   */
  const askToCombine = (): void => {
    // DEV: a fixture has no repository to preview, and the dialog has to be
    // reachable without one, like every other card on this screen.
    const asked = fixtureState();
    if (import.meta.env.DEV && asked !== undefined) {
      setCombining(fixtureReplay(asked));
      return;
    }
    const project = shell.project();
    if (project === undefined) return;
    setProblem("");
    setBusy(true);
    void services
      .run(previewCombine(project.root))
      .then((decision) => {
        if (decision.ok) setCombining(decision.replay);
        else setProblem(combineRefusal(decision.refusal));
      })
      .catch((cause: unknown) => setProblem(explainCombine(cause) ?? describe(cause)))
      .finally(() => setBusy(false));
  };

  /**
   * The primary button, dispatched by the action the state machine chose.
   *
   * `attach` and `publish` are not run from here: choosing a repository needs
   * a list and a name, which is the Cloud panel's form on the project page.
   * This screen sends the person there rather than growing a second copy of
   * it — the sentence under the button says so.
   */
  const run = (action: SyncActionId): void => {
    switch (action) {
      case "retry":
        transfer(fetchOnly);
        return;
      case "push":
        transfer(push);
        return;
      case "pull":
        // Two presses, always: the first opens the confirmation over the plan
        // the person just read, the second applies it.
        if (!confirming()) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        transfer(pull);
        return;
      case "combine":
        // Two presses, like a pull, and for a stronger reason: this one
        // rewrites the work tree. The first press names the books that keep
        // this device's version; the second runs the replay in `src/core/sync`
        // — see documentation/architecture/sync.md, "Combine".
        if (combining() === undefined) {
          askToCombine();
          return;
        }
        setCombining(undefined);
        transfer((root) => combine({ root, author: COMBINE_AUTHOR }), explainCombine);
        return;
      case "resolve":
        transfer(abortMerge);
        return;
      case "sign-in":
      case "attach":
      case "publish":
      case "compare":
        // Handled by another card or another screen; the narrative says which.
        return;
    }
  };

  return (
    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6" data-screen="cloud">
      <PanelHeader
        level={2}
        title={t("Sync")}
        subtitle={t("Where your work is, and what happens next.")}
      />

      <Show when={import.meta.env.DEV}>
        <DevStateSwitcher value={fixtureState()} onChange={setFixtureState} />
      </Show>

      <AccountCard account={account} />

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
                <ProjectCard sync={held()} projectName={name()} />

                <Show when={wantsPlan(held().state) && plan().books.length > 0}>
                  <IncomingPlanCard plan={plan()} />
                </Show>

                <ActionCard
                  sync={held()}
                  plan={plan()}
                  host={account.host ?? t("the cloud")}
                  busy={busy()}
                  phase={phase()}
                  problem={problem()}
                  onRun={() => run(held().primary)}
                />

                <Show when={combining()}>
                  {(replay) => (
                    <Dialog
                      open
                      onOpenChange={(open) => {
                        if (!open) setCombining(undefined);
                      }}
                      title={t("Combine your work?")}
                      description={narrate(
                        "combine",
                        {
                          ahead: held().clocks.local.unshared,
                          behind: held().clocks.shared.unshared,
                          contested: plan().contested.length,
                        },
                        account.host ?? t("the cloud"),
                      )}
                      footer={
                        <>
                          <Button onClick={() => setCombining(undefined)}>{t("Not now")}</Button>
                          <Button
                            variant="primary"
                            onClick={() => run("combine")}
                            data-cloud-confirm="combine"
                          >
                            {t("Yes, combine them")}
                          </Button>
                        </>
                      }
                    >
                      <div class="space-y-3" data-cloud-dialog="combine">
                        <p>{t("These books keep the version on this device:")}</p>
                        <ul class="list-disc space-y-1 pl-5" data-cloud="combine-books">
                          <For each={replay().paths}>
                            {(path) => <li data-cloud-book={path}>{bookFromPath(path)}</li>}
                          </For>
                        </ul>
                        <p class="text-on-surface-secondary">
                          {t(
                            "Everything else becomes the shared project's. No scripture text is merged line by line, and if anything goes wrong on the way this device is put back exactly as it is now.",
                          )}
                        </p>
                      </div>
                    </Dialog>
                  )}
                </Show>

                <Show when={confirming()}>
                  <Card class="space-y-3" data-cloud-card="confirm">
                    <PanelHeader level={3} title={t("Receive these updates?")} />
                    <p class="text-small text-on-surface-secondary">
                      {t(
                        "The versions listed above will be applied to this device. Nothing you have written is discarded — anything you both changed was left out and is waiting in Compare.",
                      )}
                    </p>
                    <div class="flex gap-2">
                      <Button
                        variant="primary"
                        onClick={() => run("pull")}
                        data-cloud-confirm="pull"
                      >
                        {t("Yes, receive them")}
                      </Button>
                      <Button onClick={() => setConfirming(false)}>{t("Not now")}</Button>
                    </div>
                  </Card>
                </Show>
              </>
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
