import type { BookId } from "@sefer/text/book";
import { bookName, testamentOf, type Testament } from "@sefer/text/location/canon";

import type { Shell } from "../../ProjectContext";
import { metadataOf } from "./project";

export { bookName, testamentOf };
export type { Testament };

/** The name a book's own text gives it: its main title, else its running head, else its long name. */
const NAMED = ["mt1", "mt", "h", "toc1"] as const;

const headingOf = (text: string): string | undefined => {
  const end = text.search(/\n\\c\s/);
  const head = end < 0 ? text : text.slice(0, end);
  for (const marker of NAMED) {
    const found = new RegExp(`(?:^|\\n)\\\\${marker}[ \\t]+([^\\n]*\\S)`).exec(head);
    if (found !== null) return found[1].trim();
  }
  return undefined;
};

/**
 * A book's name as the screens show it (the book list, the editor's head):
 * the name its text gives it, so a name typed at the top of the book shows
 * everywhere at once (Thomas, 2026-10-30); else the project's metadata, else
 * the canon's. Follows the book's edits through its stamp.
 */
export const shownBookName = (shell: Shell, id: BookId): string => {
  shell.stampOf(id);
  const project = shell.project();
  const text = project?.book(id)?.source().text;
  const heading = text === undefined ? undefined : headingOf(text);
  return heading ?? bookName(id, metadataOf(project));
};
