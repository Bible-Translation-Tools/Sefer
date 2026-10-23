import type { BookId } from "@sefer/text/book";
import type { UseNavigateResult } from "@tanstack/solid-router";

import type { Project } from "#core/project/project";

export type RevealAt = "top" | "centre";

/**
 * Whether answering an aim puts the caret there (`move`, the default: a
 * finding, a search hit, a chapter) or only brings it into view (`keep`: a
 * click in a reference, which must not move where the person is typing).
 */
export type RevealCaret = "move" | "keep";

export interface Reveal {
  readonly bookId: BookId;
  readonly from: number;
  readonly to?: number;
  readonly at?: RevealAt;
  readonly caret?: RevealCaret;
}

export type Navigate = UseNavigateResult<string>;

export interface RecentProject {
  readonly root: string;
  readonly name: string;
  readonly at: string;
}

export interface LiveProject {
  readonly get: () => Project | undefined;
  readonly set: (project: Project | undefined) => void;
}
