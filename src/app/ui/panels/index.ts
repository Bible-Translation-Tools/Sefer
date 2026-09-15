/**
 * The full-page panels, behind one door.
 *
 * A panel is a whole screen built from `primitives/` — a `PanelHeader`, some
 * cards, and the domain calls that fill them. Routes in `src/routes` are a
 * `createFileRoute` and a `<ShellGate>` around one of these, so that the page
 * itself is a plain component with no router in it and the route file stays
 * the two lines it should be.
 *
 * Save & Review used to be one of these. It and Compare are now the single
 * `/review` screen (`src/app/ui/review/`); what stayed behind is what History
 * still needs — `changes.ts`, `recorded.ts` and the unified `DiffView`.
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
export { changesOf, countsOf, recordedChanges, unsavedChanges, type BookChanges } from "./changes";
export { createRecordedVersion, type Recorded, type RecordedVersion } from "./recorded";
export { ago, exact, lines } from "./format";
