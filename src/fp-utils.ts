import * as TE from "fp-ts/taskEither";
import * as E from "fp-ts/either";

export const taskEitherify = <T>(fn: () => Promise<T>) =>
  TE.tryCatch(fn, E.toError);
