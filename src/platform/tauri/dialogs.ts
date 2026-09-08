/**
 * TODO(seam): the desktop host's Dialogs, backed by the Tauri dialog plugin.
 * Unwired stub.
 *
 * The real implementation is a thin call each: `open({ directory: true })`,
 * `open({ multiple: true, filters })` and `confirm(message, options)` from
 * `@tauri-apps/plugin-dialog`, which already returns real absolute paths — the
 * handle-to-path gap the Web implementation carries does not exist here.
 * The plugin is not a dependency yet, so this Layer refuses to build.
 */
import { Effect, Layer } from "effect";

import { Dialogs } from "../../core/host/dialogs";

const UNIMPLEMENTED =
  "TauriDialogsLive is a stub: add @tauri-apps/plugin-dialog before composing the desktop host.";

export const TauriDialogsLive: Layer.Layer<Dialogs> = Layer.effect(
  Dialogs,
  Effect.die(new Error(UNIMPLEMENTED)),
);
