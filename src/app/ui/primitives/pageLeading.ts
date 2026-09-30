/**
 * What a page's header draws before its title — the workspace's panel toggle
 * on a project screen. A context rather than an import because a primitive may
 * not know the workspace: the layout provides it, `PanelHeader` (page level)
 * and any header that is not a `PanelHeader` (Review's) read it.
 */

import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

export const PageLeading = createContext<() => JSX.Element | undefined>(() => undefined);

export const usePageLeading = (): (() => JSX.Element | undefined) => useContext(PageLeading);
