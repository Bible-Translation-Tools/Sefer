/**
 * The full-page panels, behind one door.
 *
 * A panel is a whole screen built from `primitives/` — a `PanelHeader`, some
 * cards, and the domain calls that fill them. Routes in `src/routes` are a
 * `createFileRoute` and a `<ShellGate>` around one of these, so that the page
 * itself is a plain component with no router in it and the route file stays
 * the two lines it should be.
 */

export { DiffView, type DiffViewProps } from "./DiffView";
export { FindingsFilters, type FindingsFiltersProps } from "./FindingsFilters";
export {
  createFindingsFilter,
  VIEWS,
  type FindingsFilterState,
  type FindingsView,
} from "./findingsFilter";
export { FindingsPanel } from "./FindingsPanel";
export { HistoryPanel } from "./HistoryPanel";
export { SavePanel } from "./SavePanel";
export { changesOf, countsOf, unsavedChanges, type BookChanges } from "./changes";
export { ago, exact, lines } from "./format";
