/**
 * The two sync settings that reach the network, as what they do.
 *
 * `checkForChanges` runs when a project opens (and after a send the server
 * refused): the cheapest question first — the server's refs, one round trip —
 * and a fetch only when its tip is not the one this device already holds. It
 * never moves a file. With "Skip review of incoming changes" on, a receive
 * follows, and the receive itself refuses whenever a book needs a person, so
 * nothing arrives unreviewed that the policy would have shown.
 *
 * `sendAfterSave` runs after a version is recorded, and only sends: the
 * server's fast-forward rule is the check, and a refusal starts the check at
 * once so `/cloud` reads `behind` or `diverged` rather than a bare error.
 *
 * Neither runs offline; `syncStatus` says so first. Both hold the repository's
 * lane through the ports, so a check and a send cannot race.
 */
import { Effect, Option } from "effect";

import { Git, type Author } from "#core/git/git";
import type { Verdict } from "#core/observability";
import type { Project } from "#core/project/project";
import { Remote, remoteVerdict } from "#core/remote/remote";
import { combine, receive, trackingRef } from "#core/sync";

import { remoteReasonOf } from "./describe";
import { recordVersion, type RecordOutcome } from "./recordVersion";
import type { Services } from "./services";
import { syncPreferences } from "./syncSettings";
import { syncStatus } from "./syncStatus";

type CheckResult = "up-to-date" | "fetched" | "detached" | "no-branch" | "no-repository";

const ask = (root: string): Effect.Effect<CheckResult, unknown, Git | Remote> =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const opened = yield* Effect.result(git.open(root));
    if (opened._tag === "Failure") return "no-repository";
    const repo = opened.success;
    const url = Option.getOrUndefined(yield* remote.origin(repo));
    if (url === undefined) return "detached";
    const branch = Option.getOrUndefined(yield* git.branch(repo));
    if (branch === undefined) return "no-branch";
    // One round trip for the refs. When the server's tip is the one this
    // device fetched last, there is nothing to transfer.
    const probe = yield* remote.probe(url);
    const tracking = Option.getOrUndefined(yield* git.resolve(repo, trackingRef(branch)));
    if (Option.getOrUndefined(probe.head) === tracking) return "up-to-date";
    yield* remote.fetch(repo);
    return "fetched";
  });

export const checkForChanges = async (services: Services, project: Project): Promise<void> => {
  const root = project.root;
  const operation = services.composition.observability.operation("sync.check");
  if (!syncStatus.online()) {
    operation.end("declined", { "sync.check.result": "offline" });
    return;
  }
  syncStatus.setChecking(root, true);
  let result: CheckResult | undefined;
  let verdict: Verdict = "passed";
  let reason: string | undefined;
  try {
    result = await services.run(ask(root));
    syncStatus.noteSuccess();
  } catch (cause) {
    const failure = remoteReasonOf(cause);
    if (failure !== undefined) syncStatus.noteFailure(failure);
    verdict = remoteVerdict(failure);
    reason = failure ?? "unknown";
  } finally {
    syncStatus.setChecking(root, false);
  }
  operation.end(verdict, {
    "sync.check.result": result ?? "unreachable",
    ...(reason === undefined ? {} : { "sync.reason": reason }),
  });
  if (result !== "fetched" || !syncPreferences(services.settings, root).skipReviewIncoming) return;
  // Received without Review only when the policy lets every book through; a
  // book that needs a person makes the receive refuse, and /cloud shows it.
  const received = await services.run(Effect.result(receive({ project })));
  services.composition.observability.note(
    "sync.receive",
    received._tag === "Success" ? "rewrote" : "declined",
    received._tag === "Success" ? undefined : received.failure.refusal,
    { "sync.auto": true },
  );
};

/** After a version is recorded: send it, when this project sends on save. */
export const sendAfterSave = async (services: Services, project: Project): Promise<void> => {
  const root = project.root;
  if (!syncPreferences(services.settings, root).sendOnSave) return;
  if (!syncStatus.online()) {
    syncStatus.noteSend({ refused: "Network" });
    return;
  }
  const operation = services.composition.observability.operation("sync.transfer", {
    "sync.action": "push",
    "sync.cause": "save",
  });
  try {
    const sent = await services.run(
      Effect.gen(function* () {
        const git = yield* Git;
        const remote = yield* Remote;
        const repo = yield* git.open(root);
        // A project attached to nothing has nowhere to send to; that is not a
        // refusal, and the Save dialog did not promise a send.
        if (Option.isNone(yield* remote.origin(repo))) return false;
        yield* remote.push(repo);
        return true;
      }),
    );
    if (sent) syncStatus.noteSend({ sent: true });
    operation.end("passed", { "sync.sent": sent });
  } catch (cause) {
    const reason = remoteReasonOf(cause) ?? "Rejected";
    syncStatus.noteSend({ refused: reason });
    operation.end(remoteVerdict(reason), { "sync.reason": reason });
    // Refused because the shared project moved: ask it what changed, so the
    // screen can say "behind" or "diverged" with the facts.
    if (reason === "Rejected") await checkForChanges(services, project);
  }
};

export type SettleOutcome =
  | { readonly kind: "received"; readonly recorded: RecordOutcome }
  | { readonly kind: "combined"; readonly commit: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * After a review against the shared project, keep what the person decided and
 * take everything else the other side changed — as a fast-forward and one new
 * version when this device has no versions of its own, or as one decision
 * commit that joins both histories when it has.
 */
export const settleWithShared = async (
  services: Services,
  project: Project,
  author: Author,
  message: string,
): Promise<SettleOutcome> => {
  const received = await services.run(Effect.result(receive({ project, reviewed: true })));
  if (received._tag === "Success") {
    const dirty = project.books.filter((book) => services.save.dirty(book));
    const recorded = await recordVersion(services, project, dirty, message, author);
    if (recorded.kind === "recorded") void sendAfterSave(services, project);
    return { kind: "received", recorded };
  }
  if (received.failure.refusal !== "diverged")
    return { kind: "refused", why: received.failure.description };
  const combined = await services.run(Effect.result(combine({ project, author, reviewed: true })));
  return combined._tag === "Success"
    ? { kind: "combined", commit: combined.success.commit }
    : { kind: "refused", why: combined.failure.description };
};
