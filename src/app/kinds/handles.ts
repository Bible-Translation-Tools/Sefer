import { Effect, Exit } from "effect";

import type { OpenHandle, Unavailable } from "#core/resources/kinds/handle";
import type { Resource } from "#core/resources/library";

import type { Services } from "../services";
import { openHandle } from "./table";

export interface ResourceHandles {
  readonly open: (resource: Resource) => Promise<Exit.Exit<OpenHandle, Unavailable>>;
  readonly releaseAll: () => void;
}

export const createResourceHandles = (services: Services): ResourceHandles => {
  const open = new Map<string, Promise<Exit.Exit<OpenHandle, Unavailable>>>();
  return {
    open: (resource) => {
      const key = `${resource.id}\u0000${resource.content}\u0000${resource.format}`;
      const held = open.get(key);
      if (held !== undefined) return held;
      const opening = services.run(Effect.exit(openHandle(services.fileSystem, resource)));
      open.set(key, opening);
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
