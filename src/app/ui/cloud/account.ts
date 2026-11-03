import { Effect, Option } from "effect";
import { createEffect, createRoot, createSignal, type Accessor } from "solid-js";

import { Gitea, type Profile, type Session } from "#core/remote/gitea";

import { collaboration } from "../../collaboration";
import { describe, reasonOf } from "../../describe";
import { contentHostFor } from "../../endpoints";
import { m } from "../../paraglide/messages";
import type { Shell } from "../../ProjectContext";

const reask = (shell: Shell): void => {
  const project = shell.project();
  if (project !== undefined) void collaboration.refresh(shell.services, project);
};

type Services = Shell["services"];

const restoreSession = (
  services: Services,
  host: string | null,
  setSession: (held: Session | undefined) => void,
): void => {
  createEffect(
    () => host,
    (base) => {
      if (base === null) return;
      void services
        .run(Effect.flatMap(Gitea, (gitea) => gitea.session(base)))
        .then((held) => setSession(Option.getOrUndefined(held)))
        .catch(() => undefined);
    },
  );
};

export interface Account {
  readonly host: string | null;
  readonly session: Accessor<Session | undefined>;
  /** Name, email and picture, read from WACS after signing in; undefined until it answers. */
  readonly profile: Accessor<Profile | undefined>;
  readonly busy: Accessor<boolean>;
  readonly problem: Accessor<string>;
  readonly otpWanted: Accessor<boolean>;
  readonly signIn: (fields: {
    readonly username: string;
    readonly password: string;
    readonly otp: string;
  }) => void;
  readonly signOut: () => void;
  readonly attempt: (work: () => Promise<void>) => void;
  /** Whether the app bar's Account popover is open; the sync popover opens it to sign in. */
  readonly panelOpen: Accessor<boolean>;
  readonly setPanelOpen: (open: boolean) => void;
}

const login = (
  services: Services,
  base: string,
  fields: Parameters<Account["signIn"]>[0],
): Promise<Session> =>
  services.run(
    Effect.flatMap(Gitea, (gitea) =>
      gitea.login({
        host: base,
        username: fields.username,
        password: fields.password,
        otp: fields.otp === "" ? undefined : fields.otp,
      }),
    ),
  );

const makeAccount = (shell: Shell): Account => {
  const { services } = shell;
  const host = contentHostFor(services.settings);

  const [session, setSession] = createSignal<Session | undefined>(undefined, { name: "session" });
  const [busy, setBusy] = createSignal(false, { name: "cloudBusy" });
  const [problem, setProblem] = createSignal("", { name: "cloudProblem" });
  const [otpWanted, setOtpWanted] = createSignal(false, { name: "cloudOtpWanted" });
  const [profile, setProfile] = createSignal<Profile | undefined>(undefined, {
    name: "accountProfile",
  });
  createEffect(
    () => session()?.username,
    (user) => {
      setProfile(undefined);
      if (user === undefined || host === null) return;
      void services
        .run(Effect.flatMap(Gitea, (gitea) => gitea.profile(host)))
        .then(setProfile)
        .catch(() => undefined);
    },
  );
  const [panelOpen, setPanelOpen] = createSignal(false, { name: "accountPanelOpen" });

  const attempt = (work: () => Promise<void>): void => {
    setProblem("");
    setBusy(true);
    void work()
      .catch((cause: unknown) => {
        if (reasonOf(cause) === "Unauthorized") {
          setProblem(m.sign_in_incorrect());
          return;
        }
        const message = describe(cause);
        setProblem(message);
        if (/OtpRequired/u.test(message)) setOtpWanted(true);
      })
      .finally(() => setBusy(false));
  };

  restoreSession(services, host, setSession);

  return {
    host,
    session,
    profile,
    busy,
    problem,
    otpWanted,
    attempt,
    panelOpen,
    setPanelOpen,
    signIn: (fields) => {
      const base = host;
      if (base === null) return;
      attempt(async () => {
        const held = await login(services, base, fields);
        setSession(held);
        setOtpWanted(false);
        reask(shell);
        shell.report(m.cloud_signed_in_to_host_as({ host: base, user: held.username }));
      });
    },
    signOut: () => {
      const base = host;
      if (base === null) return;
      attempt(async () => {
        await services.run(Effect.flatMap(Gitea, (gitea) => gitea.logout(base)));
        setSession(undefined);
        reask(shell);
      });
    },
  };
};

const accounts = new WeakMap<Services, Account>();

/**
 * The one account for this composition. The app bar's Account button, the
 * sync popover and Settings' Cloud cards all read it, so signing in at one
 * shows everywhere. It lives as long as the app, under its own root.
 */
export const createAccount = (shell: Shell): Account => {
  const held = accounts.get(shell.services);
  if (held !== undefined) return held;
  const made = createRoot(() => makeAccount(shell));
  accounts.set(shell.services, made);
  return made;
};
