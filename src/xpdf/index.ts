import assert from "node:assert";
import { $, fs } from "zx";
import {
  array as A,
  string,
  task,
  ord,
  number,
  taskEither as TE,
  either as E,
  record as R,
  option as O,
  apply,
} from "fp-ts";

import { flow, pipe } from "fp-ts/lib/function";
import * as path from "node:path";
import { fp_regex, fp_regex_exec_groups } from "../fp_regex";
import { taskEitherify } from "../fp-utils";
import { fs as fp_fs } from "fp-ts-node";
import _ from "lodash";

// TODO: ensure pdfinfo, pdftohtml is able to run in portable
// http://www.xpdfreader.com/download.html

export async function pdfinfo(pdf_path: string) {
  const out = await $`pdfinfo -meta ${pdf_path}`;
  const obj: Record<string, string> = Object.fromEntries(
    out.stdout.split("\n").map((line) => {
      const [, key, val, ...rest] = line.split(":").map((s) => s.trim());
      assert(rest.length == 0, `output "${line}" have many colon`);
      return [key.replaceAll(" ", "_").toLowerCase(), val];
    })
  );
  const pages: number = +obj.pages;
  assert(isFinite(pages));

  const [, w, h] = fp_regex(/^(\d+) x (\d+) pts/, obj.page_size);
  const page_size: [number, number] = [+w, +h];
  assert(isFinite(+w) && isFinite(+h));

  const [, size] = fp_regex(/^(\d+) bytes$/, obj.page_size);
  const file_size = +size;
  assert(isFinite(file_size));

  return {
    ...obj,
    pages,
    page_size,
    file_size,
  };
}

interface XPdfHtml {
  page: number;
  html_path: string;
  html_content: string;
}

const read_pdftohtml_output = (
  html_path: string
): TE.TaskEither<string, XPdfHtml> =>
  pipe(
    {
      html_path: TE.right(html_path),
      page: pipe(
        html_path,
        fp_regex_exec_groups(/page(?<page>\d+).html$/),
        O.chain((x) => (_.isInteger(+x.page) ? O.some(+x.page) : O.none)),
        TE.fromOption(() => `${html_path} is not match page{num}.html`)
      ),
      html_content: pipe(
        html_path,
        fp_fs.readFile({ encoding: "utf8" }),
        TE.mapLeft((err) => err.message)
      ),
    },
    apply.sequenceS(TE.ApplicativePar)
  );

export const pdftohtml = (opt: {
  pdf_path: string;
  output_dir: string;
  resolution?: number;
}) =>
  pipe(
    // prettier-ignore
    TE.tryCatch(() => $`pdftohtml -r ${opt.resolution ?? 150} -table -formfields ${opt.pdf_path} ${opt.output_dir}`, E.toError),
    TE.chain(() => TE.tryCatch(() => fs.readdir(opt.output_dir), E.toError)),
    TE.map((o) =>
      pipe(
        o,
        //
        A.map((filename) => path.resolve(opt.output_dir, filename)),
        A.filter(string.endsWith(".html")),
        A.filter((s) => !s.includes("index.html")),
        A.traverse(TE.ApplicativePar)((o) => read_pdftohtml_output(o)),
        // TE.chain((a) => a),
        (o) => o
      )
    ),
    (o) => o,
    // TE.sequenceArray(TE.ApplicativePar),
    // A.sequence(TE.ApplicativePar),
    (o) => o
  );
//   const _out = await $`pdftohtml -r ${
//     opt.resolution ?? 150
//   } -table -formfields ${opt.pdf_path} ${opt.output_dir}`;

//   return pipe(
//     await fs.readdir(opt.output_dir),
//     array.map((filename) => path.resolve(opt.output_dir, filename)),
//     array.filter(string.endsWith(".html")),
//     array.filter((s) => !s.includes("index.html")),
//     array.map((html_path) => {
//       const [, page] = fp_regex(/page(\d+).html$/, html_path);
//       return async () => ({
//         page: +page,
//         html_path,
//         html_content: (await fs.readFile(html_path)).toString("utf-8"),
//       });
//     }),
//     array.sequence(task.ApplicativePar),
//     task.map((arr) =>
//       array.sortBy([
//         ord.contramap((p: { page: number }) => p.page)(number.Ord),
//       ])(arr)
//     ),
//     task.map((o) => ({ pages: o }))
//   )();
// }
