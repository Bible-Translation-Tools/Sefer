import * as TextResult from "@sefer/text/result";
import { Effect } from "effect";

/**
 * `Effect.fromResult` for the packages' plain `Result` (`decode`, `book.apply`):
 * `@sefer/text` and the editor ask nothing of Effect, so the lift lives here.
 */
export const fromResult = <A, E>(result: TextResult.Result<A, E>): Effect.Effect<A, E> =>
  TextResult.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure);
