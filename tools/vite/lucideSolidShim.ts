/**
 * Solid 2, wearing Solid 1's names — for lucide-solid only.
 *
 * `tools/vite/lucideSolid.ts` points lucide-solid's `solid-js` and
 * `solid-js/web` imports here. The module re-exports the real Solid 2 runtime
 * and adds back the two names lucide-solid asks for that Solid 2 dropped:
 *
 *  - `splitProps`, which became `omit` plus a hand-built lazy pick. The pick
 *    must stay lazy — lucide's `Icon` reads `localProps.size` inside a memo,
 *    and a copied snapshot would freeze a prop the caller can change.
 *  - `Dynamic`, which moved from `solid-js/web` to `@solidjs/web`.
 *
 * Nothing in `src/` imports this file, and nothing should: it exists to keep a
 * third-party package honest, not to be a compatibility layer of our own.
 */

import { Dynamic } from "@solidjs/web";
import { merge, omit } from "solid-js";

export * from "solid-js";
export { Dynamic };

/** Solid 1's `mergeProps`. Solid 2 calls the same operation `merge`. */
export const mergeProps = merge;

/**
 * Solid 1's `splitProps(props, ...keyLists)`: one object per key list, then the
 * remainder. Each picked object forwards its getters so the result stays
 * reactive.
 */
export const splitProps = (
  props: Record<string, unknown>,
  ...keyLists: readonly (readonly string[])[]
): readonly Record<string, unknown>[] => {
  const picked = keyLists.map((keys) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      Object.defineProperty(out, key, {
        get: () => props[key],
        enumerable: true,
        configurable: true,
      });
    }
    return out;
  });
  const taken = keyLists.flat();
  // SAFETY: `omit` narrows its return type by the literal keys it is given;
  // ours are a `string[]` the caller assembled, so the compiler cannot see
  // that the result is still the same record minus some of its keys.
  const rest = omit(props, ...taken) as Record<string, unknown>;
  return [...picked, rest];
};
