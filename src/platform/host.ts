import type { HostKind } from "../core/boot";

/** Tauri exposes this marker in the webview; Web has no equivalent marker. */
export const detectHost = (): HostKind => ("__TAURI_INTERNALS__" in globalThis ? "tauri" : "web");
