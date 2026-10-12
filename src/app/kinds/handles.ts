/**
 * The open project's resource handles: each opened once, on first need, and
 * released together when the project closes (`shell.resources`).
 *
 * The SHELL owns their lifetime, not the pane, because a handle can be
 * expensive to open and to hold — a few books of notes today, a 44 MB wasm
 * corpus when Macula comes — and a pane is remounted whenever the reader
 * picks another text or book.
 */

import { Effect, Exit } from "effect";

import type { OpenHandle, Unavailable } from "#core/resources/kinds/handle";
import type { Resource } from "#core/resources/library";

import type { Services } from "../services";
import { openHandle } from "./table";

export interface ResourceHandles {
  /** The handle on `resource`, opened now or the one already open. */
  readonly open: (resource: Resource) => Promise<Exit.Exit<OpenHandle, Unavailable>>;
  /** Lets every open handle go. */
  readonly releaseAll: () => void;
}

export const createResourceHandles = (services: Services): ResourceHandles => {
  const open = new Map<string, Promise<Exit.Exit<OpenHandle, Unavailable>>>();
  return {
    open: (resource) => {
      // Keyed by what was registered, so re-adding a root that now declares
      // another kind opens a new handle rather than answering with the old.
      const key = `${resource.id}\u0000${resource.content}\u0000${resource.format}`;
      const held = open.get(key);
      if (held !== undefined) return held;
      const opening = services.run(Effect.exit(openHandle(services.fileSystem, resource)));
      open.set(key, opening);
      // A failure is not kept: the reader may add the missing book, or the
      // network may come back, and the next ask should try again.
      void opening.then((exit) => {
        if (Exit.isFailure(exit)) open.delete(key);
      });
      return opening;
    },
    releaseAll: () => {
      const all = [...open.values()];
      open.clear();
      for (const opening of all)
        void opening.then((exit) => {
          if (Exit.isSuccess(exit)) void services.run(exit.value.handle.release);
        });
    },
  };
};
