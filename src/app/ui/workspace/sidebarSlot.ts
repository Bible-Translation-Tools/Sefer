import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

/**
 * What the panel's show/hide button says while this claim is up — the
 * panel's CONTENT, not "books": on Key terms it holds key terms. Whole
 * phrases, so a translation is free to word each one its own way.
 */
export interface SidebarLabel {
  readonly show: string;
  readonly hide: string;
}

interface Claim {
  readonly render: () => JSX.Element;
  readonly label?: SidebarLabel;
}

// ownedWrite: written while being built inside an owner, where Solid 2 throws otherwise.

const [claims, setClaims] = createSignal<readonly Claim[]>([], {
  name: "sidebarClaims",
  ownedWrite: true,
});

export const sidebarClaim = (): (() => JSX.Element) | undefined => claims().at(-1)?.render;

/** The show/hide wording of the claim on show, if it names one. */
export const sidebarLabel = (): SidebarLabel | undefined => claims().at(-1)?.label;

/** Claims the sidebar; returns the release. */
export const claimSidebar = (render: () => JSX.Element, label?: SidebarLabel): (() => void) => {
  const claim: Claim = { render, label };
  setClaims((held) => [...held, claim]);
  return () => setClaims((held) => held.filter((entry) => entry !== claim));
};
