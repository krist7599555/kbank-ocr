import * as E from "fp-ts/Either";
import * as O from "fp-ts/Option";
import * as R from "fp-ts/Record";
import { pipe } from "fp-ts/lib/function";
import { record } from "fp-ts";

export function fp_regex(regex: RegExp, text: string): string[] {
  const a = regex.exec(text);
  if (!a) throw new Error(`regex /${regex}/ not match "${text}"`);
  return Array.from(a);
}

export const fp_regex_exec_array = (regex: RegExp) => (text: string) =>
  pipe(
    regex.exec(text),
    O.fromNullable,
    O.map((a) => Array.from(a))
  );

export const fp_regex_exec_groups = (regex: RegExp) => (text: string) =>
  pipe(
    regex.exec(text),
    O.fromNullable,
    O.map((x) => x.groups),
    O.chain((x) => (R.isEmpty(x) ? O.none : O.some(x)))
  );
