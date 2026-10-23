import type { HostKind } from "#core/boot";

export const detectHost = (): HostKind => ("__TAURI_INTERNALS__" in globalThis ? "tauri" : "web");
