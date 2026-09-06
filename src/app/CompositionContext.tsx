import { createContext, useContext } from "solid-js";

import type { Composition } from "./composition";

// A Solid 2 context is itself the provider component, so CompositionProvider
// is the context. The explicit `undefined` default keeps a missing provider a
// plain Error with our own message rather than Solid's ContextNotFoundError.
const CompositionContext = createContext<Composition | undefined>(undefined);

export const CompositionProvider = CompositionContext;

export const useComposition = (): Composition => {
  const composition = useContext(CompositionContext);
  if (composition === undefined)
    throw new Error("useComposition() must be called inside a <CompositionProvider>");
  return composition;
};
