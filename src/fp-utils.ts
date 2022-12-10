import * as TE from "fp-ts/taskEither";
import * as E from "fp-ts/either";
import * as A from "fp-ts/array";
import { tuple } from "fp-ts";
import { pipe } from "fp-ts/lib/function";
import type { FixedLengthArray } from "type-fest";

export const taskEitherify = <T>(fn: () => Promise<T>) =>
  TE.tryCatch(fn, E.toError);

type Tuple<T, N extends number> = N extends N
  ? number extends N
    ? T[]
    : _TupleOf<T, N, []>
  : never;
type _TupleOf<T, N extends number, R extends unknown[]> = R["length"] extends N
  ? R
  : _TupleOf<T, N, [T, ...R]>;

/**
 *
 * FP-List: Divides up an input list into a set of sublists, according to n and m input specifications you provide. Each sublist will have n items, and the start of each sublist will be offset by m items from the previous one.
 *
 * `divvy 5 5 [1..20] == [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20]]`
 * In the case where a source list's trailing elements do no fill an entire sublist, those trailing elements will be dropped.
 *
 * `divvy 5 2 [1..10] == [[1,2,3,4,5],[3,4,5,6,7],[5,6,7,8,9]]`
 * As an example, you can generate a moving average over a list of prices:
 *
 * @see Haskell {@link https://hackage.haskell.org/package/split-0.2.3.5/docs/src/Data.List.Split.Internals.html#divvy}
 */
export const fp_array_divvy =
  <N extends number>(n: N) =>
  (m: number) =>
  <T>(arr: T[]) =>
    pipe(
      arr,
      A.chop((xs) => {
        return [A.takeLeft(n)(xs) as Tuple<T, N>, A.dropLeft(m)(xs)];
      })
    );
const a = fp_array_divvy(3)(4)(["a", "b"]);
