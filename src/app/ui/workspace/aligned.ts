/**
 * The aligned group, handed down to the editors a container shows side by
 * side — the main editor and its reference panes, on the book page.
 *
 * The container makes the group (`createAlignedGroup`, `#editor`) and provides
 * it; each editor that can be aligned joins it when its view mounts. An
 * editor with no group above it is simply not aligned with anything, so a
 * screen that shows one editor needs nothing.
 */

import { createContext, useContext } from "solid-js";

import type { AlignedGroup } from "#editor/index";

// A Solid 2 context is itself the provider component.
const AlignedContext = createContext<AlignedGroup | undefined>(undefined);

export const AlignedProvider = AlignedContext;

export const useAlignedGroup = (): AlignedGroup | undefined => useContext(AlignedContext);
