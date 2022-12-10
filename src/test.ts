import { flow, pipe } from "fp-ts/lib/function";
import { array, nonEmptyArray, string, taskEither } from "fp-ts";
import * as O from "fp-ts/Option";
import * as TE from "fp-ts/TaskEither";
import * as T from "fp-ts/Task";
import * as E from "fp-ts/Either";
import * as A from "fp-ts/Array";
import * as R from "fp-ts/record";
import * as D from "io-ts/Decoder";
import * as N from "fp-ts/Number";
import * as Monoid from "fp-ts/Monoid";
import * as S from "fp-ts/Semigroup";
import * as RA from "fp-ts/ReadonlyArray";
import * as Ord from "fp-ts/Ord";

console.log({ R, O });

const a = pipe(
  [1, 1, 2, 2, 1, 3],
  A.chop((a) => {
    return [[13, a[0]], a.slice(1)];
  })
);
console.log(a);
export {};
