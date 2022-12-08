import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as TE from "fp-ts/TaskEither";
import * as path from "path";
import * as fs from "fs/promises";

export const fp_validate_absolute_path = (p: string) =>
  path.isAbsolute(p)
    ? E.right(p)
    : E.left(E.toError(`expect absolute path, got ${p}`));

export const fp_file_exists = (p: string) =>
  pipe(
    TE.right(p),
    TE.chainEitherK(fp_validate_absolute_path),
    TE.chain((o) =>
      TE.tryCatch(
        () => fs.access(o, fs.constants.R_OK).then(() => o),
        E.toError
      )
    ),
    (o) => o

    //
  );

export const either_unwrap = E.getOrElseW((err) => {
  throw err;
});

export const task_either_unwrap = TE.getOrElseW((err) => {
  throw err;
});
export const throw_error = (err: Error) => {
  throw err;
};
