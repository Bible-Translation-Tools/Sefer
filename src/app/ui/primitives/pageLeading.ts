/**
 * What a page's header draws before its title — the workspace's panel toggle
 * on a project screen — and what it ends with — the way back to the book. A
 * context rather than an import because a primitive may not know the
 * workspace: the layout provides both, `PanelHeader` (page level) and any
 * header that is not a `PanelHeader` (Review's) read them.
 */

import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

export const PageLeading = createContext<() => JSX.Element | undefined>(() => undefined);

export const usePageLeading = (): (() => JSX.Element | undefined) => useContext(PageLeading);

/**
 * The door out (`BackToEditor`), drawn at the end of a page header. A render
 * function, called only where a header draws it, so the editor — which has no
 * page header — never registers a way back to itself.
 */
export const PageDoor = createContext<() => JSX.Element | undefined>(() => undefined);

export const usePageDoor = (): (() => JSX.Element | undefined) => useContext(PageDoor);
