import type { Extension } from "@codemirror/state";

import { attributePopover } from "./recipes/attributePopover";
import { verseMenu } from "./recipes/verseMenu";

/**
 * An opinionated piece of UI a host opts into. The behaviour and the data
 * under each one are always in the package, as commands and queries on the
 * mount (`renumberVerse`, `attributesAt`, `setAttributes`…); a feature is one
 * UI over them. A host passes the ones it wants to `mountBookEditor`; one
 * that passes none gets the editor with no menus and no popovers.
 */
export type EditorFeature = Extension;

export { attributePopover, verseMenu };

/** Every feature, as Sefer mounts the editor: CodeMirror's `basicSetup`, for this editor. */
export const editorFeatures = (): readonly EditorFeature[] => [verseMenu(), attributePopover()];
