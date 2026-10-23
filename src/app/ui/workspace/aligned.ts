import type { AlignedGroup } from "@sefer/editor";
import { createContext, useContext } from "solid-js";

// `null`, not `undefined`: Solid 2 treats an `undefined` default (or value)
// as none, and throws on reading it.
const AlignedContext = createContext<AlignedGroup | null>(null);

export const AlignedProvider = AlignedContext;

export const useAlignedGroup = (): AlignedGroup | undefined =>
  useContext(AlignedContext) ?? undefined;
