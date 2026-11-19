/**
 * Design scaffolding for the app bar's Sync chip, moved out of
 * `src/app/ui/cloud/SyncButton.tsx` so it never ships: the chip imports this
 * only in a design build (`__SEFER_DESIGN__`), the way the routes load the
 * playgrounds. The real states can also be reached against a local WACS
 * (`pnpm wacs:up`, tools/wacs).
 */
import type { SyncReading } from "#core/sync";

const DAY = 86_400_000;
const commit = (id: string, at: number) => ({
  id,
  message: "",
  author: { name: "teammate", email: "" },
  at,
});
const ORIGIN = "https://content.bibletranslationtools.org/team/project";

/** Stand-in readings for the chip's design tweak; "live" is the real one. */
const PREVIEWS: Readonly<Record<string, Partial<SyncReading>>> = {
  "not uploaded": { signedIn: true },
  "uploaded today": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 2 * 3_600_000),
  },
  "3 saves waiting": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 3 * DAY),
    ahead: [commit("b", Date.now()), commit("c", Date.now()), commit("d", Date.now())],
  },
  "updates on WACS": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("e", Date.now() - DAY),
    behind: [commit("e", Date.now() - DAY)],
  },
  diverged: {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("e", Date.now() - 9 * DAY),
    ahead: [commit("b", Date.now())],
    behind: [commit("e", Date.now() - 9 * DAY)],
  },
  "review before upload": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("e", Date.now() - DAY),
    ahead: [commit("b", Date.now()), commit("c", Date.now())],
    behind: [commit("e", Date.now() - DAY)],
    sendRefused: true,
  },
  "WACS unreachable": { signedIn: true, origin: ORIGIN, remoteKnown: true, online: false },
  "upload refused": {
    signedIn: true,
    origin: ORIGIN,
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 3 * DAY),
    ahead: [commit("b", Date.now())],
    sendRefused: true,
  },
  "no permission": {
    signedIn: true,
    origin: "https://content.bibletranslationtools.org/other_teaboogey/en_ulb",
    remoteKnown: true,
    remoteHead: commit("a", Date.now() - 3 * DAY),
    ahead: [commit("b", Date.now()), commit("c", Date.now())],
  },
  "signed out": { origin: ORIGIN, remoteKnown: true, remoteHead: commit("a", Date.now() - DAY) },
};

/** Stand-ins that also need the person to have no permission. */
const NO_WRITE = new Set(["no permission"]);

/**
 * The chip's "Sync state" tweak (SEFER-92, SEFER-83): each state can be seen
 * without a WACS account. The design surface loads lazily and installs its
 * handle after the app bar has mounted, so this waits for it. Returns what
 * takes the tweak away again.
 */
export function startSyncChipTweak(
  choose: (
    stand: { readonly reading: Partial<SyncReading>; readonly noWrite: boolean } | undefined,
  ) => void,
): () => void {
  let release: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tries = 0;
  const attempt = (): void => {
    // SAFETY: under `__SEFER_DESIGN__` the design surface installs this handle
    // (`src/dev/designSurface.ts`) with `register` of this shape; `unknown` in
    // the global's type only because platform may not import a dev tool.
    const design = globalThis.__sefer?.design as
      | {
          readonly register?: (registration: {
            readonly namespace: string;
            readonly tweaks: readonly {
              readonly key: string;
              readonly label: string;
              readonly kind: "choice";
              readonly options: readonly string[];
            }[];
            readonly onChange: (values: Readonly<Record<string, string>>) => void;
          }) => () => void;
        }
      | undefined;
    if (design?.register === undefined) {
      // The design surface can arrive well after the app bar (a slow first
      // load, a lazy chunk), so keep waiting, more slowly after a while.
      tries += 1;
      timer = setTimeout(attempt, tries < 100 ? 50 : 500);
      return;
    }
    release = design.register({
      namespace: "syncChip",
      tweaks: [
        {
          key: "state",
          label: "Sync state",
          kind: "choice",
          options: ["live", ...Object.keys(PREVIEWS)],
        },
      ],
      onChange: (values) => {
        const state = values["syncChip.state"] ?? "live";
        const reading = PREVIEWS[state];
        choose(reading === undefined ? undefined : { reading, noWrite: NO_WRITE.has(state) });
      },
    });
  };
  attempt();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    release?.();
  };
}
