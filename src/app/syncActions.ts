import type { BookId } from "@wycliffeassociates/sefer-text/book";
import { Effect, Option } from "effect";

import { m } from "#app/paraglide/messages";
import { Git, type Author } from "#core/git/git";
import type { Verdict } from "#core/observability";
import type { Project } from "#core/project/project";
import { COPY_REMOTE, Remote, remoteVerdict, type RemoteFailureReason } from "#core/remote/remote";
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
import {
  canWriteShared,
  copyStanding,
  fetchCopy,
  modeOf,
  sendingTo,
  workInOwnCopy,
} from "./suggestions";
import { syncPhase } from "./syncPhase";
import { syncPreferences } from "./syncSettings";
import { syncStatus } from "./syncStatus";
import { syncWatch } from "./syncWatch";
import { checkWriter } from "./writerWatch";

const destination = (services: Services, project: Project): Promise<string> =>
  sendingTo(services, project);

type CheckResult = "up-to-date" | "fetched" | "detached" | "no-branch" | "no-repository";

const fetchFromShared = (root: string): Effect.Effect<CheckResult, unknown, Git | Remote> =>
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

/**
 * Every sync entry point below sends its events to the project's one machine
 * (`src/core/sync/lifecycle.ts`). A check starts only from idle: over a send or a settle it
 * is declined, since each of those ends by reading the shared project anyway.
 */
export const checkForChanges = async (services: Services, project: Project): Promise<void> => {
  const operation = services.composition.observability.operation("sync.check");
  if (!syncStatus.interfaceUp()) {
    operation.end("declined", { "sync.check.result": "offline" });
    return;
  }
  if (syncPhase.now(project.root).kind !== "idle") {
    operation.end("declined", { "sync.check.result": "busy" });
    return;
  }
  syncPhase.send(project.root, { kind: "check" });
  await checkShared(services, project, operation);
  await checkWriter(services, project);
};

/** A send that waits for the check in flight, and the sends in flight, one per project. */
const waiting = new Map<
  string,
  { readonly outcome: Promise<SendOutcome>; readonly start: () => void }
>();
const sending = new Map<string, Promise<SendOutcome>>();

/** The check or receive ended: if a send waited for it, the machine is in `routing` and it starts. */
const startWaiting = (root: string): void => {
  const next = waiting.get(root);
  if (next === undefined || syncPhase.now(root).kind !== "routing") return;
  waiting.delete(root);
  next.start();
};

const checkShared = async (
  services: Services,
  project: Project,
  operation: ReturnType<Services["composition"]["observability"]["operation"]>,
): Promise<void> => {
  const root = project.root;
  let result: CheckResult | undefined;
  let verdict: Verdict = "passed";
  let reason: string | undefined;
  try {
    result = await services.run(fetchFromShared(root));
    syncStatus.noteSuccess();
    syncWatch.noteFetched(root);
  } catch (cause) {
    const failure = remoteReasonOf(cause);
    if (failure !== undefined) syncStatus.noteFailure(failure);
    verdict = remoteVerdict(failure);
    reason = failure ?? "unknown";
  }
  const receives =
    result === "fetched" && syncPreferences(services.settings, root).skipReviewIncoming;
  syncPhase.send(root, { kind: receives ? "fetched" : "checked" });
  operation.end(verdict, {
    "sync.check.result": result ?? "unreachable",
    ...(reason === undefined ? {} : { "sync.reason": reason }),
  });
  try {
    await syncWatch.refresh(services, project).catch(() => undefined);
    if (verdict === "passed") {
      if ((await modeOf(services, project)) === "copy") await fetchCopy(services, project);
      void collaboration.refresh(services, project);
    }
    if (!receives) return;
    const received = await services.run(Effect.result(receive({ project })));
    syncPhase.send(root, { kind: "received" });
    services.composition.observability.note(
      "sync.receive",
      received._tag === "Success" ? "rewrote" : "declined",
      received._tag === "Success" ? undefined : received.failure.refusal,
      { "sync.auto": true },
    );
    await syncWatch.refresh(services, project).catch(() => undefined);
  } finally {
    // However the tail ended, the machine leaves `receiving` and a waiting send starts.
    syncPhase.send(root, { kind: "received" });
    startWaiting(root);
  }
};

export type SendOutcome =
  | { readonly kind: "sent"; readonly toCopy?: true; readonly ownCopy?: string }
  | { readonly kind: "detached" }
  | { readonly kind: "held" }
  | {
      readonly kind: "refused";
      readonly reason: RemoteFailureReason;
      readonly toCopy?: true;
      /** This account may not write to the shared project: not a conflict, so nothing to compare. */
      readonly noWrite?: true;
      readonly description?: string;
    };

/**
 * Send this project's versions. During a check the send waits for it; while a send is already
 * in flight this is that send; during a settle it is held, since the settle sends by itself.
 */
export const sendNow = (
  services: Services,
  project: Project,
  cause: "save" | "press" = "press",
  to?: string,
): Promise<SendOutcome> => {
  const root = project.root;
  const run = (): Promise<SendOutcome> => {
    const outcome = runSend(services, project, cause, to).finally(() => sending.delete(root));
    sending.set(root, outcome);
    return outcome;
  };
  const phase = syncPhase.now(root);
  if (phase.kind === "idle") {
    syncPhase.send(root, { kind: "send" });
    return run();
  }
  if (phase.kind === "checking" || phase.kind === "receiving") {
    const already = waiting.get(root);
    if (already !== undefined) return already.outcome;
    syncPhase.send(root, { kind: "send" });
    const { promise, resolve, reject } = Promise.withResolvers<SendOutcome>();
    waiting.set(root, { outcome: promise, start: () => void run().then(resolve, reject) });
    return promise;
  }
  return sending.get(root) ?? Promise.resolve({ kind: "held" });
};

const runSend = async (
  services: Services,
  project: Project,
  cause: "save" | "press",
  to: string | undefined,
): Promise<SendOutcome> => {
  const root = project.root;
  let outcome: SendOutcome;
  try {
    outcome = await attemptSend(services, project, cause, to);
  } catch (thrown) {
    syncPhase.send(root, { kind: "refused", reason: undefined });
    throw thrown;
  }
  if (outcome.kind === "refused" && outcome.reason === "Rejected") {
    syncPhase.send(root, { kind: "rejected" });
    await checkShared(
      services,
      project,
      services.composition.observability.operation("sync.check"),
    );
    await checkWriter(services, project);
  } else {
    if (outcome.kind === "sent") syncPhase.send(root, { kind: "sent" });
    else if (outcome.kind === "refused")
      syncPhase.send(root, {
        kind: "refused",
        reason: outcome.noWrite === true ? undefined : outcome.reason,
      });
    else syncPhase.send(root, { kind: "detached" });
    await syncWatch.refresh(services, project).catch(() => undefined);
  }
  if (outcome.kind === "refused" && outcome.toCopy === true)
    await collaboration.refresh(services, project);
  if (outcome.kind === "refused" && outcome.reason === "Unauthorized")
    await collaboration.refresh(services, project);
  if (outcome.kind === "sent" && outcome.ownCopy !== undefined)
    await collaboration.refresh(services, project);
  return outcome;
};

type Route = { readonly to: string; readonly ownCopy?: string } | { readonly noWrite: string };

/**
 * Where a send goes. Someone who may not write to the shared project and has no copy yet
 * sends to their own copy: the one they already hold on the server, or a new one. Sending is
 * already on (send on save, or Send pressed), so making the copy is part of the send.
 */
const routeOf = async (
  services: Services,
  project: Project,
  explicit: string | undefined,
): Promise<Route> => {
  const to = explicit ?? (await destination(services, project));
  if (explicit !== undefined || to === COPY_REMOTE) return { to };
  if ((await canWriteShared(services, project)) !== false) return { to };
  try {
    const made = await workInOwnCopy(services, project);
    if (made.kind === "copy") return { to: COPY_REMOTE, ownCopy: made.copy };
    if (made.kind === "rerooted") return { to: COPY_REMOTE };
    return { noWrite: m.sync_no_write_shared() };
  } catch (cause) {
    return { noWrite: describe(cause) };
  }
};

const attemptSend = async (
  services: Services,
  project: Project,
  cause: "save" | "press",
  explicit: string | undefined,
): Promise<SendOutcome> => {
  const root = project.root;
  if (!syncStatus.interfaceUp()) {
    syncStatus.noteFailure("Network");
    return { kind: "refused", reason: "Network" };
  }
  const operation = services.composition.observability.operation("sync.transfer", {
    "sync.action": "push",
    "sync.cause": cause,
  });
  let to: string | undefined;
  let ownCopy: string | undefined;
  try {
    const route = await routeOf(services, project, explicit);
    if ("noWrite" in route) {
      operation.end("refused", { "sync.reason": "NoWrite" });
      return { kind: "refused", reason: "Unauthorized", noWrite: true, description: route.noWrite };
    }
    to = route.to;
    ownCopy = route.ownCopy;
    syncPhase.send(root, { kind: "routed" });
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
    if (sent) syncStatus.noteSuccess();
    if (sent && target === "copy") await fetchCopy(services, project);
    operation.end("passed", { "sync.sent": sent });
    if (!sent) return { kind: "detached" };
    if (target !== COPY_REMOTE) return { kind: "sent" };
    return ownCopy === undefined
      ? { kind: "sent", toCopy: true }
      : { kind: "sent", toCopy: true, ownCopy };
  } catch (cause) {
    const reason = remoteReasonOf(cause) ?? "Rejected";
    if (
      to === "origin" &&
      reason !== "Network" &&
      reason !== "Unavailable" &&
      (await canWriteShared(services, project)) === false
    ) {
      operation.end("refused", { "sync.reason": "NoWrite", "sync.to": to });
      return { kind: "refused", reason: "Unauthorized", noWrite: true };
    }
    const standing =
      to === "copy" && reason === "Rejected"
        ? await fetchCopy(services, project).then(() => copyStanding(services, project))
        : undefined;
    syncStatus.noteFailure(reason);
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
  overrides: { readonly theirs?: string; readonly sendTo?: string } = {},
): Promise<SettleOutcome> => {
  const root = project.root;
  // A settle follows whatever is running: it is the person's Save, so it is never dropped.
  while (syncPhase.now(root).kind !== "idle") await syncPhase.whenIdle(root);
  syncPhase.send(root, { kind: "settle" });
  try {
    return await settle(services, project, author, message, settled, overrides);
  } finally {
    // Idle if the settle threw; otherwise it already said `settled` before its own send.
    syncPhase.send(root, { kind: "settled" });
  }
};

const settle = async (
  services: Services,
  project: Project,
  author: Author,
  message: string,
  settled: ReadonlySet<BookId>,
  overrides: { readonly theirs?: string; readonly sendTo?: string },
): Promise<SettleOutcome> => {
  // An upload was refused because the shared project had moved, and this review is what it
  // was waiting for: it goes once the review is saved, whatever send-on-save says.
  const uploadWaits = syncPhase.now(project.root).refused === "Rejected";
  const received = await services.run(
    Effect.result(receive({ project, settled, ...optionalTheirs(overrides.theirs) })),
  );
  if (received._tag === "Success") {
    const dirty = project.books.filter((book) => services.save.dirty(book));
    const recorded = await recordVersion(services, project, dirty, message, author);
    syncPhase.send(project.root, { kind: "settled" });
    const sending = sendAfterRecording(
      services,
      project,
      recorded,
      overrides.sendTo ?? (uploadWaits ? await destination(services, project) : undefined),
    );
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
  const sendTo = overrides.sendTo ?? (await destination(services, project));
  const combined = await services.run(
    Effect.result(
      combine({
        project,
        author,
        settled,
        sendTo,
        message,
        ...optionalTheirs(overrides.theirs),
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
