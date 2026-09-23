/**
 * The full-page panels, behind one door.
 *
 * A panel is a whole screen built from `primitives/` — a `PanelHeader`, some
 * cards, and the domain calls that fill them. Routes in `src/routes` are a
 * `createFileRoute` and a `<ShellGate>` around one of these, so that the page
 * itself is a plain component with no router in it and the route file stays
 * the two lines it should be.
 *
 * `/review` is not one of these; it lives in `src/app/ui/review/`. What is
 * here beside the panels is what History needs — `changes.ts`, `recorded.ts`
 * and the unified `DiffView`.
 */

export { FindingsPanel } from "./FindingsPanel";
export { HistoryPanel } from "./HistoryPanel";
