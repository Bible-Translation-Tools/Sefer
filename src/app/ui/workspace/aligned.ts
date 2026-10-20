import type { AlignedGroup } from "@sefer/editor";
import { createContext, useContext } from "solid-js";

const AlignedContext = createContext<AlignedGroup | undefined>(undefined);

export const AlignedProvider = AlignedContext;

export const useAlignedGroup = (): AlignedGroup | undefined => useContext(AlignedContext);
