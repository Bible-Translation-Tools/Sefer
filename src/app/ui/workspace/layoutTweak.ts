/**
 * Refine's layout — a DESIGN TWEAK, scaffolding until the question is settled
 * (`pnpm design:scaffolding` lists it). `split` is what ships. `panels` is the
 * new direction, and reaches past the book page:
 *
 *  - the book page: everything straight on one white surface, the languages
 *    as TABS in one panel (the gateways read-only, the heart language last
 *    and the only one editable), which can split so the gateways get a panel
 *    of their own (`shell.referenceSplit`, remembered);
 *  - the project panel: its card reads "Project:" over the language; no
 *    testament switch — both testaments listed under their headings, the
 *    search always open above.
 *
 * Builds without the design surface are always `split`. Registered once, by
 * the workspace (`useLayoutTweak`), and read anywhere through `layout()`.
 */

import { createSignal, onCleanup } from "solid-js";

export type Layout = "split" | "panels";

// Module state, not context: the tweak is one value for the whole window, and
// the panel writes it from outside any component.
// `panels` by default on this design branch, so a shared link opens on it;
// the tweak can still switch back to `split` (what ships).
const [layout, setLayout] = createSignal<Layout>(__SEFER_DESIGN__ ? "panels" : "split", {
  name: "refineLayout",
  ownedWrite: true,
});

export { layout };

/** Registers the tweak with the design surface; call once, from the workspace. */
export function useLayoutTweak(): void {
  if (!__SEFER_DESIGN__) return;
  // The design surface is loaded lazily and installs its handle after the
  // workspace has mounted, so wait for it rather than register into nothing.
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
      tries += 1;
      if (tries < 100) timer = setTimeout(attempt, 50);
      return;
    }
    release = design.register({
      namespace: "refine",
      tweaks: [{ key: "layout", label: "Layout", kind: "choice", options: ["panels", "split"] }],
      onChange: (values) => {
        setLayout(values["refine.layout"] === "split" ? "split" : "panels");
      },
    });
  };
  attempt();
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    release?.();
  });
}
