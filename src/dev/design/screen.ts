import type { JSX } from "@solidjs/web";

import type { Tweak, Variant } from "../annotate";

export interface ScreenProps {
  readonly variant: () => string;
  readonly tweak: (key: string) => string;
  readonly on: (key: string) => boolean;
}

export interface Screen {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly variants?: readonly Variant[];
  readonly tweaks?: readonly Tweak[];
  readonly view: (props: ScreenProps) => JSX.Element;
}

export const isScreen = (value: unknown): value is Screen => {
  if (typeof value !== "object" || value === null) return false;
  if (!("id" in value) || !("view" in value)) return false;
  return typeof value.id === "string" && typeof value.view === "function";
};
