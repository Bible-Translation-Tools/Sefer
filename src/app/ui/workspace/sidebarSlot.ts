/**
 * The project sidebar's slot: what the panel under the app bar shows.
 *
 * Normally the project's own table of contents (`ProjectSidebar`). A screen
 * whose job is a list of places — Find, Key terms, Findings — claims it for as
 * long as it is mounted and puts its results there instead, reduced to book
 * and chapter: on those screens the reader is navigating the RESULTS, not the
 * project, and an outline column inside the page beside a book list outside it
 * was the same question answered twice, in two columns of width.
 *
 * Module-level, like the command registry, because there is one workspace and
 * the claimant and the panel live in different subtrees of the root route.
 * The last claim wins, and releasing it restores the one before.
 *
 * `ownedWrite` for the same reason as `commands.ts`: a claim is made while a
 * screen is being built and released while it is disposed, both inside a
 * reactive owner, and Solid 2 refuses an unmarked write there.
 */

import type { JSX } from "@solidjs/web";
import { createSignal } from "solid-js";

interface Claim {
  readonly render: () => JSX.Element;
}

const [claims, setClaims] = createSignal<readonly Claim[]>([], {
  name: "sidebarClaims",
  ownedWrite: true,
});

/** What the sidebar should draw instead of the project's contents, if anything. */
export const sidebarClaim = (): (() => JSX.Element) | undefined => claims().at(-1)?.render;

/** Claims the sidebar; returns the release. */
export const claimSidebar = (render: () => JSX.Element): (() => void) => {
  const claim: Claim = { render };
  setClaims((held) => [...held, claim]);
  return () => setClaims((held) => held.filter((entry) => entry !== claim));
};
