import { Effect, Option } from "effect";
import { createEffect, createSignal, type Accessor } from "solid-js";

import { Gitea, type Session } from "#core/remote/gitea";

import { collaboration } from "../../collaboration";
import { describe } from "../../describe";
import { contentHostFor } from "../../endpoints";
import { t } from "../../i18n";
import type { Shell } from "../../ProjectContext";

const reask = (shell: Shell): void => {
  const project = shell.project();
  if (project !== undefined) void collaboration.refresh(shell.services, project);
};

export interface Account {
  readonly host: string | null;
  readonly session: Accessor<Session | undefined>;
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
}

export const createAccount = (shell: Shell): Account => {
  const { services } = shell;
  const host = contentHostFor(services.settings);

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
        if (/OtpRequired/u.test(message)) setOtpWanted(true);
      })
      .finally(() => setBusy(false));
  };

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
        reask(shell);
        shell.report(t("signed in to {host} as {user}", { host: base, user: held.username }));
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
