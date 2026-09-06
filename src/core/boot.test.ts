import { Effect, Exit, Result } from "effect";
import { describe, expect, test } from "vitest";

import { boot } from "./boot";

describe("application boot", () => {
  test("reports the host and build identity", () => {
    const exit = Effect.runSyncExit(boot("web", "abc1234+production"));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit))
      expect(exit.value).toEqual({
        host: "web",
        build: "abc1234+production",
        phase: "ready",
      });
  });

  test("fails with UnknownHost for a host kind it does not know", () => {
    const result = Effect.runSync(Effect.result(boot("android", "abc1234+production")));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("UnknownHost");
      expect(result.failure).toMatchObject({ received: "android" });
    }
  });

  test("fails with MissingBuildIdentity when the build identity is absent or blank", () => {
    for (const build of [undefined, "", "   "]) {
      const result = Effect.runSync(Effect.result(boot("tauri", build)));

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure._tag).toBe("MissingBuildIdentity");
    }
  });
});
