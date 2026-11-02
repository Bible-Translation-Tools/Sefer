/**
 * The outcome of an operation that can refuse: what it made, or why not.
 *
 * Shaped like Effect's `Result` (`_tag`, `success`, `failure`) so code reading
 * the fields reads either, but plain data, so this package and the editor ask
 * nothing of their host's libraries. A host on Effect lifts one with
 * `#core/result`'s `fromResult`, not Effect's, which wants its own type.
 */
export interface Success<A> {
  readonly _tag: "Success";
  readonly success: A;
}

export interface Failure<E> {
  readonly _tag: "Failure";
  readonly failure: E;
}

export type Result<A, E> = Success<A> | Failure<E>;

export const succeed = <A>(success: A): Success<A> => ({ _tag: "Success", success });

export const fail = <E>(failure: E): Failure<E> => ({ _tag: "Failure", failure });

export const isSuccess = <A, E>(result: Result<A, E>): result is Success<A> =>
  result._tag === "Success";

export const isFailure = <A, E>(result: Result<A, E>): result is Failure<E> =>
  result._tag === "Failure";
