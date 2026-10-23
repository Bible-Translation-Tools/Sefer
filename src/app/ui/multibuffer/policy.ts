import { editorPolicy, type EditorPolicy, type ProjectionName } from "@sefer/editor";

export const cardPolicy = (
  mode: "regular" | "usfm",
  ...regular: readonly ProjectionName[]
): EditorPolicy =>
  mode === "usfm"
    ? editorPolicy("usfm")
    : editorPolicy("regular", "lock-verse-numbers", ...regular);
