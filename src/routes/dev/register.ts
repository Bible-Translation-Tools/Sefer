import { createRoute, type AnyRoute } from "@tanstack/solid-router";

import { Route as rootRoute } from "../__root";
import { FixturePage } from "./fixture";

const fixtureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev/fixture",
  component: FixturePage,
});

export const installDevRoutes = (tree: AnyRoute): void => {
  const existing = tree.children === undefined ? [] : [...tree.children];
  tree._addFileChildren([...existing, fixtureRoute]);
};
