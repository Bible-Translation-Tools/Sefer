/**
 * The Galley seam's front door. Modules take `Galley` and read `Analysis`;
 * nothing outside `src/core/galley` imports `vendor/`.
 */

export * from "./analysis";
export * from "./galley";
