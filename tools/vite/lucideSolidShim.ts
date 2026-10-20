// Solid 2 under Solid 1's names (splitProps, Dynamic) for lucide-solid only; its pick must stay lazy.
import { Dynamic } from "@solidjs/web";
import { merge, omit } from "solid-js";

export * from "solid-js";
export { Dynamic };

export const mergeProps = merge;

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
  // SAFETY: `omit` narrows its return type by the literal keys it is given; ours are a `string[]` the caller assembled, so the compiler cannot see that the result is still the same record minus some of its keys.
  const rest = omit(props, ...taken) as Record<string, unknown>;
  return [...picked, rest];
};
