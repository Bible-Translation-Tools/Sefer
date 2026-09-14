/**
 * The landing screen's one header: the muted breadcrumb and the two-way
 * segmented control over "Your projects" and "Find project".
 *
 * The two halves are two ROUTES rather than two signals, because they are two
 * places — one lists what is on this device, the other browses a service on
 * the internet — and a reader who bookmarks the catalogue or presses Back
 * should land where they expect. The segmented control therefore navigates;
 * the active segment is whichever route rendered it, which is why `tab` is a
 * prop and not state.
 */

import { useNavigate } from "@tanstack/solid-router";

import { t } from "../../i18n";
import { SegmentedControl } from "../primitives";
import { Breadcrumb, type Crumb } from "./Breadcrumb";

export type LandingTab = "yours" | "find";

export function LandingHeader(props: {
  readonly tab: LandingTab;
  readonly crumbs: readonly Crumb[];
}) {
  const navigate = useNavigate();

  return (
    <header class="space-y-3">
      <Breadcrumb crumbs={props.crumbs} />
      <SegmentedControl
        label={t("Landing section")}
        value={props.tab}
        onChange={(next) => {
          // `search: true` keeps the query string, and the one that matters is
          // `?fixture=1`: the composition reads it off `location` at startup,
          // so a tab switch that dropped it would send the next RELOAD to OPFS
          // instead of the seeded fixture.
          void navigate({ to: next === "yours" ? "/projects" : "/start/find", search: true });
        }}
        items={[
          { value: "yours", label: t("Your projects") },
          { value: "find", label: t("Find project") },
        ]}
      />
    </header>
  );
}
