/**
 * The one answer to "may this reach the network?". Every caller that leaves
 * the device names what it is doing and asks; "Work offline" answers no to
 * all of them. A new network feature adds its action here to compile.
 */
import { Effect } from "effect";

import { UpdaterError, type UpdaterService } from "../host/updater";
import { RemoteError, type RemoteService } from "../remote/remote";

export type NetworkAction =
  /** Ask the shared project what changed, and bring its history down. */
  | "check"
  /** Send versions, or put a project online. */
  | "send"
  /** Download a project. */
  | "clone"
  /** Fetch older history for History. */
  | "deepen"
  /** Browse and search what can be downloaded. */
  | "catalogue"
  /** Sign in, the account, suggestions and everything else on the WACS API. */
  | "account"
  /** Look for, list or install an application update. */
  | "update"
  /** Export traces to a collector. */
  | "telemetry";

export interface NetworkGate {
  readonly may: (action: NetworkAction) => boolean;
}

/** What a gated request rejects with. A `TypeError`, as a browser's own failed fetch is. */
const networkOff = (action: NetworkAction): TypeError =>
  new TypeError(`network access is off (work offline): ${action}`);

/** `fetch`, refusing before the request is made while the gate is closed. */
export const gatedFetch =
  <Args extends readonly unknown[], Answer>(
    gate: NetworkGate,
    action: NetworkAction,
    fetch: (...args: Args) => Promise<Answer>,
  ): ((...args: Args) => Promise<Answer>) =>
  (...args) =>
    gate.may(action) ? fetch(...args) : Promise.reject(networkOff(action));

const refused = (action: NetworkAction): Effect.Effect<never, RemoteError> =>
  Effect.fail(new RemoteError({ reason: "Network", description: networkOff(action).message }));

/** The Remote port with its network calls behind the gate; the local ones (origin, attach) pass. */
export const gatedRemote = (gate: NetworkGate, remote: RemoteService): RemoteService => {
  const behind =
    <Args extends readonly unknown[], A>(
      action: NetworkAction,
      run: (...args: Args) => Effect.Effect<A, RemoteError>,
    ) =>
    (...args: Args): Effect.Effect<A, RemoteError> =>
      Effect.suspend(() => (gate.may(action) ? run(...args) : refused(action)));
  return {
    ...remote,
    clone: behind("clone", remote.clone),
    probe: behind("check", remote.probe),
    fetch: behind("check", remote.fetch),
    fetchRef: behind("check", remote.fetchRef),
    deepen: behind("deepen", remote.deepen),
    push: behind("send", remote.push),
    publish: behind("send", remote.publish),
  };
};

/** The Updater port behind the gate: no update is looked for, listed or installed while it is closed. */
export const gatedUpdater = (gate: NetworkGate, updater: UpdaterService): UpdaterService => {
  const off = (): Effect.Effect<never, UpdaterError> =>
    Effect.fail(new UpdaterError({ reason: "Network", description: networkOff("update").message }));
  return {
    ...updater,
    check: () =>
      Effect.suspend(() =>
        gate.may("update")
          ? updater.check()
          : Effect.succeed({ _tag: "Unavailable", reason: networkOff("update").message } as const),
      ),
    listVersions: () =>
      Effect.suspend(() => (gate.may("update") ? updater.listVersions() : Effect.succeed([]))),
    installAndRelaunch: () =>
      Effect.suspend(() => (gate.may("update") ? updater.installAndRelaunch() : off())),
    installVersion: (version) =>
      Effect.suspend(() => (gate.may("update") ? updater.installVersion(version) : off())),
  };
};
