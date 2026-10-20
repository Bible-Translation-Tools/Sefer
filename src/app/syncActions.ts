import type { BookId } from "@sefer/text/book";
import { Effect, Option } from "effect";

import { Git, type Author } from "#core/git/git";
import type { Verdict } from "#core/observability";
import type { Project } from "#core/project/project";
import { Remote, remoteVerdict, type RemoteFailureReason } from "#core/remote/remote";
import {
  combine,
  receive,
  trackingRef,
  type CombineRefusal,
  type CombineState,
  type ReceiveRefusal,
} from "#core/sync";

import { collaboration } from "./collaboration";
import { describe, remoteReasonOf } from "./describe";
import { recordVersion, type RecordOutcome } from "./recordVersion";
import type { Services } from "./services";
import { copyStanding, fetchCopy, modeOf, sendingTo } from "./suggestions";
import { syncPreferences } from "./syncSettings";
import { syncStatus } from "./syncStatus";
import { syncWatch } from "./syncWatch";
import { checkWriter } from "./writerWatch";

const destination = (services: Services, project: Project): Promise<string> =>
  sendingTo(services, project);

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
    const probe = yield* remote.probe(url);
    const tracking = Option.getOrUndefined(yield* git.resolve(repo, trackingRef(branch)));
    if (Option.getOrUndefined(probe.head) === tracking) return "up-to-date";
    yield* remote.fetch(repo);
    return "fetched";
  });

export const checkForChanges = async (services: Services, project: Project): Promise<void> => {
  const operation = services.composition.observability.operation("sync.check");
  if (!syncStatus.interfaceUp()) {
    operation.end("declined", { "sync.check.result": "offline" });
    return;
  }
  await checkShared(services, project, operation);
  await checkWriter(services, project);
};

const checkShared = async (
  services: Services,
  project: Project,
  operation: ReturnType<Services["composition"]["observability"]["operation"]>,
): Promise<void> => {
  const root = project.root;
  syncStatus.setChecking(root, true);
  let result: CheckResult | undefined;
  let verdict: Verdict = "passed";
  let reason: string | undefined;
  try {
    result = await services.run(ask(root));
    syncStatus.noteSuccess();
    syncWatch.noteFetched(root);
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
  await syncWatch.refresh(services, project).catch(() => undefined);
  if (verdict === "passed") {
    if ((await modeOf(services, project)) === "copy") await fetchCopy(services, project);
    void collaboration.refresh(services, project);
  }
  if (result !== "fetched" || !syncPreferences(services.settings, root).skipReviewIncoming) return;
  const received = await services.run(Effect.result(receive({ project })));
  services.composition.observability.note(
    "sync.receive",
    received._tag === "Success" ? "rewrote" : "declined",
    received._tag === "Success" ? undefined : received.failure.refusal,
    { "sync.auto": true },
  );
  await syncWatch.refresh(services, project).catch(() => undefined);
};

export type SendOutcome =
  | { readonly kind: "sent"; readonly toCopy?: true }
  | { readonly kind: "detached" }
  | { readonly kind: "held" }
  | {
      readonly kind: "refused";
      readonly reason: RemoteFailureReason;
      readonly toCopy?: true;
      readonly description?: string;
    };

export const sendNow = async (
  services: Services,
  project: Project,
  cause: "save" | "press" = "press",
  to?: string,
): Promise<SendOutcome> => {
  const outcome = await attemptSend(services, project, cause, to);
  if (outcome.kind === "refused" && outcome.reason === "Rejected")
    await checkForChanges(services, project);
  else await syncWatch.refresh(services, project).catch(() => undefined);
  if (outcome.kind === "refused" && outcome.toCopy === true)
    await collaboration.refresh(services, project);
  if (outcome.kind === "refused" && outcome.reason === "Unauthorized")
    await collaboration.refresh(services, project);
  return outcome;
};

const attemptSend = async (
  services: Services,
  project: Project,
  cause: "save" | "press",
  explicit: string | undefined,
): Promise<SendOutcome> => {
  const root = project.root;
  if (!syncStatus.interfaceUp()) {
    syncStatus.noteSend({ refused: "Network" });
    return { kind: "refused", reason: "Network" };
  }
  const operation = services.composition.observability.operation("sync.transfer", {
    "sync.action": "push",
    "sync.cause": cause,
  });
  let to: string | undefined;
  try {
    to = explicit ?? (await destination(services, project));
    const target = to;
    const sent = await services.run(
      Effect.gen(function* () {
        const git = yield* Git;
        const remote = yield* Remote;
        const repo = yield* git.open(root);
        if (Option.isNone(yield* remote.origin(repo))) return false;
        yield* remote.push(repo, target);
        return true;
      }),
    );
    if (sent) syncStatus.noteSend({ sent: true });
    if (sent && target === "copy") await fetchCopy(services, project);
    operation.end("passed", { "sync.sent": sent });
    if (!sent) return { kind: "detached" };
    return target === "copy" ? { kind: "sent", toCopy: true } : { kind: "sent" };
  } catch (cause) {
    const reason = remoteReasonOf(cause) ?? "Rejected";
    const standing =
      to === "copy" && reason === "Rejected"
        ? await fetchCopy(services, project).then(() => copyStanding(services, project))
        : undefined;
    syncStatus.noteSend({ refused: reason });
    operation.end(remoteVerdict(reason), {
      "sync.reason": reason,
      ...(to === undefined ? {} : { "sync.to": to }),
      ...(standing === undefined ? {} : { "sync.copy": standing }),
    });
    if (standing === "own" || standing === "behind")
      return { kind: "refused", reason, toCopy: true };
    if (standing === "none") return { kind: "refused", reason, description: describe(cause) };
    return { kind: "refused", reason };
  }
};

export const sendAfterSave = async (services: Services, project: Project): Promise<SendOutcome> => {
  if (!syncPreferences(services.settings, project.root).sendOnSave) {
    await syncWatch.refresh(services, project).catch(() => undefined);
    return { kind: "held" };
  }
  return sendNow(services, project, "save");
};

const optionalTheirs = (theirs: string | undefined) => (theirs === undefined ? {} : { theirs });

export type SettleOutcome =
  | {
      readonly kind: "received";
      readonly recorded: RecordOutcome;
      readonly sending: Promise<SendOutcome> | undefined;
    }
  | {
      readonly kind: "combined";
      readonly commit: string | undefined;
      readonly sent: boolean;
      readonly to: string;
    }
  | {
      readonly kind: "refused";
      readonly receive?: ReceiveRefusal | undefined;
      readonly combine?: CombineRefusal | undefined;
      readonly books?: readonly string[] | undefined;
      readonly state?: CombineState | undefined;
      readonly description: string;
    };

const sendAfterRecording = (
  services: Services,
  project: Project,
  recorded: Awaited<ReturnType<typeof recordVersion>>,
  sendTo: string | undefined,
): Promise<SendOutcome> | undefined => {
  if (sendTo !== undefined) {
    if (recorded.kind === "recorded" || recorded.kind === "nothing")
      return sendNow(services, project, "save", sendTo);
    return undefined;
  }
  if (recorded.kind === "recorded") return sendAfterSave(services, project);
  return undefined;
};

export const settleWithShared = async (
  services: Services,
  project: Project,
  author: Author,
  message: string,
  settled: ReadonlySet<BookId>,
  with_: { readonly theirs?: string; readonly sendTo?: string } = {},
): Promise<SettleOutcome> => {
  const received = await services.run(
    Effect.result(receive({ project, settled, ...optionalTheirs(with_.theirs) })),
  );
  if (received._tag === "Success") {
    const dirty = project.books.filter((book) => services.save.dirty(book));
    const recorded = await recordVersion(services, project, dirty, message, author);
    const sending = sendAfterRecording(services, project, recorded, with_.sendTo);
    if (sending === undefined) void syncWatch.refresh(services, project).catch(() => undefined);
    return { kind: "received", recorded, sending };
  }
  if (received.failure.refusal !== "diverged")
    return {
      kind: "refused",
      receive: received.failure.refusal,
      books: received.failure.books,
      description: received.failure.description,
    };
  const sendTo = with_.sendTo ?? (await destination(services, project));
  const combined = await services.run(
    Effect.result(
      combine({
        project,
        author,
        settled,
        sendTo,
        message,
        ...optionalTheirs(with_.theirs),
      }),
    ),
  );
  void syncWatch.refresh(services, project).catch(() => undefined);
  if (combined._tag === "Success")
    return { kind: "combined", commit: combined.success.commit, sent: true, to: sendTo };
  if (combined.failure.state === "recorded")
    return { kind: "combined", commit: undefined, sent: false, to: sendTo };
  return {
    kind: "refused",
    combine: combined.failure.refusal,
    state: combined.failure.state,
    description: combined.failure.description,
  };
};
