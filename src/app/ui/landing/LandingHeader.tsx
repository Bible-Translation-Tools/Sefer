/**
 * The landing screen's one header: the muted breadcrumb and the two-way
 * segmented control over "Your projects" and "Find project".
 *
 * The trail ends in the tab, because the tab IS where you are: "Sefer /
 * Projects / Find project". A screen passes the crumbs ABOVE it and never
 * repeats its own name.
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

/** The tab's own name, which is also its crumb: the trail names the tab. */
const TAB_LABEL: Readonly<Record<LandingTab, string>> = {
  yours: "Your projects",
  find: "Find project",
};

export function LandingHeader(props: {
  readonly tab: LandingTab;
  readonly crumbs: readonly Crumb[];
}) {
  const navigate = useNavigate();

  return (
    <header class="space-y-3">
      <Breadcrumb crumbs={[...props.crumbs, { label: t(TAB_LABEL[props.tab]) }]} />
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
          { value: "yours", label: t(TAB_LABEL.yours) },
          { value: "find", label: t(TAB_LABEL.find) },
        ]}
      />
    </header>
  );
}
