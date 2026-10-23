import { createContext, useContext } from "solid-js";

import type { Composition } from "./composition";

const CompositionContext = createContext<Composition | undefined>(undefined);

export const CompositionProvider = CompositionContext;

export const useComposition = (): Composition => {
  const composition = useContext(CompositionContext);
  if (composition === undefined)
    throw new Error("useComposition() must be called inside a <CompositionProvider>");
  return composition;
};
