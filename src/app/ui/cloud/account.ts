/**
 * The account half of cloud sync, as state rather than as a component.
 *
 * Two surfaces show the same session — `/cloud`'s account Card and the Cloud
 * panel in a project's page — and neither of them OWNS it. The session lives
 * in `Credentials` behind `Gitea`; this is the small amount of screen state
 * around asking for it: the form fields, whether the account wants its second
 * factor, and the one failure line.
 *
 * Extracted so the two surfaces cannot disagree about what "signed in" means,
 * and so `CloudPanel` stops carrying a copy of the login flow.
 */

import { Effect, Option } from "effect";
import { createEffect, createSignal, type Accessor } from "solid-js";

import { Gitea, type Session } from "../../../core/remote/gitea";
import { wacsUrlFor } from "../../endpoints";
import { t } from "../../i18n";
import type { Shell } from "../../ProjectContext";

export interface Account {
  /** The Gitea host this build talks to; `null` when none is configured. */
  readonly host: string | null;
  readonly session: Accessor<Session | undefined>;
  readonly busy: Accessor<boolean>;
  readonly problem: Accessor<string>;
  /** Did the last attempt say the account has two-factor turned on? */
  readonly otpWanted: Accessor<boolean>;
  readonly signIn: (fields: {
    readonly username: string;
    readonly password: string;
    readonly otp: string;
  }) => void;
  readonly signOut: () => void;
  /** Run anything else through the same busy/failure reporting. */
  readonly attempt: (work: () => Promise<void>) => void;
}

/**
 * Every failure this surface shows, as one line.
 *
 * `services.run` rejects with the fiber's failure ITSELF — the tagged error
 * object, not a rendering of it — and `Data.TaggedError`'s own `toString` is
 * just the tag. So `String(cause)` alone says "RemoteError" and nothing else,
 * which is neither a sentence nor enough to tell a network failure from a
 * refusal. The two fields every error on this surface carries are read
 * structurally, and anything else still falls back to the string.
 */
export const describe = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null) {
    // SAFETY: the guard above proves this is an object; both fields are read
    // as `unknown` and each is narrowed to a string before it is used, so the
    // assertion claims nothing about what the object actually is.
    const held = cause as { readonly reason?: unknown; readonly description?: unknown };
    const parts = [held.reason, held.description].filter(
      (part): part is string => typeof part === "string" && part !== "",
    );
    if (parts.length > 0) return parts.join(": ");
  }
  return String(cause);
};

export const createAccount = (shell: Shell): Account => {
  const { services } = shell;
  // Read once, at the composition's endpoint: an override typed into Settings
  // reaches the screens immediately but the transfer Layers only after a
  // reload, and signing in against one endpoint while transferring to another
  // is precisely the confusion this screen exists to avoid.
  const host = wacsUrlFor(services.settings, services.hostInfo.kind());

  const [session, setSession] = createSignal<Session | undefined>(undefined, { name: "session" });
  const [busy, setBusy] = createSignal(false, { name: "cloudBusy" });
  const [problem, setProblem] = createSignal("", { name: "cloudProblem" });
  const [otpWanted, setOtpWanted] = createSignal(false, { name: "cloudOtpWanted" });

  const attempt = (work: () => Promise<void>): void => {
    setProblem("");
    setBusy(true);
    void work()
      .catch((cause: unknown) => {
        const message = describe(cause);
        setProblem(message);
        // The one failure that is not really a failure: the password was fine
        // and the account wants its second factor.
        if (/OtpRequired/u.test(message)) setOtpWanted(true);
      })
      .finally(() => setBusy(false));
  };

  // Whether we are already signed in is not a component's to remember: ask
  // Gitea (which asks Credentials) on mount, so a surface remounted by
  // navigation shows the session the application actually holds.
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

  return {
    host,
    session,
    busy,
    problem,
    otpWanted,
    attempt,
    signIn: (fields) => {
      const base = host;
      if (base === null) return;
      attempt(async () => {
        const held = await services.run(
          Effect.flatMap(Gitea, (gitea) =>
            gitea.login({
              host: base,
              username: fields.username,
              password: fields.password,
              otp: fields.otp === "" ? undefined : fields.otp,
            }),
          ),
        );
        setSession(held);
        setOtpWanted(false);
        shell.report(t("signed in to {host} as {user}", { host: base, user: held.username }));
      });
    },
    signOut: () => {
      const base = host;
      if (base === null) return;
      attempt(async () => {
        await services.run(Effect.flatMap(Gitea, (gitea) => gitea.logout(base)));
        setSession(undefined);
      });
    },
  };
};
