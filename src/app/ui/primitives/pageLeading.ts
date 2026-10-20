import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

export const PageLeading = createContext<() => JSX.Element | undefined>(() => undefined);

export const usePageLeading = (): (() => JSX.Element | undefined) => useContext(PageLeading);

export const PageDoor = createContext<() => JSX.Element | undefined>(() => undefined);

export const usePageDoor = (): (() => JSX.Element | undefined) => useContext(PageDoor);
