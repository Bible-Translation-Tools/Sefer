import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

interface Claim {
  readonly render: () => JSX.Element;
}

// ownedWrite: written while being built inside an owner, where Solid 2 throws otherwise.

const [claims, setClaims] = createSignal<readonly Claim[]>([], {
  name: "sidebarClaims",
  ownedWrite: true,
});

export const sidebarClaim = (): (() => JSX.Element) | undefined => claims().at(-1)?.render;

export const claimSidebar = (render: () => JSX.Element): (() => void) => {
  const claim: Claim = { render };
  setClaims((held) => [...held, claim]);
  return () => setClaims((held) => held.filter((entry) => entry !== claim));
};
