import { strict as assert } from "node:assert";
import * as cheerio from "cheerio";
import _ from "lodash";
import xlsx from "json-as-xlsx";

import * as path from "path";
import { fileURLToPath } from "url";
import { pdftohtml } from "./xpdf/index";
import { fs } from "zx";
import { fp_regex, fp_regex_exec_groups } from "./fp_regex";
import { flow, pipe } from "fp-ts/lib/function";
import { array, nonEmptyArray, string, taskEither } from "fp-ts";
import * as O from "fp-ts/Option";
import * as TE from "fp-ts/TaskEither";
import * as T from "fp-ts/Task";
import * as E from "fp-ts/Either";
import * as A from "fp-ts/array";
import * as R from "fp-ts/record";
import * as D from "io-ts/Decoder";
import * as N from "fp-ts/Number";
import * as Monoid from "fp-ts/Monoid";
import * as S from "fp-ts/Semigroup";
import * as RA from "fp-ts/ReadonlyArray";
import * as Ord from "fp-ts/Ord";
import { fs as fpfs } from "fp-ts-node";
import { either_unwrap, task_either_unwrap } from "./fp-validate";
import { contramap, ordNumber } from "fp-ts/lib/Ord";
import { fp_array_divvy } from "./fp-utils";

const fp_gt = (target: number) => (val: number) => val > target;
const fp_lt = (target: number) => (val: number) => val < target;
const fp_gte = (target: number) => (val: number) => val >= target;
const fp_lte = (target: number) => (val: number) => val <= target;
const num_eq = (a: number, b: number) => a.toFixed(2) === b.toFixed(2);

const fp_between = (lo: number, hi: number) => (val: number) =>
  lo <= val && val <= hi;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __root_dir = path.resolve(__dirname, "..");
const rpath = <T extends Exclude<string, `./${string}` | `/${string}`>>(
  rel: T
) => path.resolve(__root_dir, rel);

function try_infer_human_name(s: string) {
  const KNOWS = [
    { person_role: "insbx", person_name: "กฤษฏิ์ พรไพรินทร์" },
    { person_role: "insbx", person_name: "กัลลยารัตน์ นนท์จุมจัง" },
    { person_role: "insbx", person_name: "ณพล เนตรพรหม" },
    { person_role: "insbx", person_name: "เมธาวจี สาระคุณ" },
    { person_role: "insbx", person_name: "ศุภกานต์ ผดุงใจ" },
    { person_role: "insbx", person_name: "นราวิชญ์ ชุติศิลป์" },
    { person_role: "insbx", person_name: "ณัฏฐ์นรี ฤกษ์เกรียงไกร" },
    { person_role: "insbx", person_name: "ปณาลี ก้อนแก้ว" },
    { person_role: "insbx", person_name: "นวจิต เอื้ออภินันท์สกุล" },
  ];
  const match =
    /^(โอนไป|จาก) ?(?<bank>.+)? X(?<last4digit>\d{4}) (?<fullname_dirty>(?<titlename>(น\.ส\.|ด\.ญ\.|นาย|นางสาว|นางบจก\.|บริษัท)?) ?(?<fullname_cut>(?<name>\S+)(?<surname>( .+)*))\+\+)$/.exec(
      s
    );
  // @ts-ignore
  const o: {
    bank: "SCB" | undefined;
    last4digit: "8008" | string;
    titlename: "บริษัท" | string;
    fullname_cut: "สิตาภัส จำก" | string;
    fullname_dirty: "สิตาภัส จำก++" | string;
    name: "สิตาภัส" | string;
    surname: " จำก" | string;
    raw: "โอนไป SCB X8008 บริษัท สิตาภัส จำก++" | string;
  } = { ...match?.groups, raw: s };

  return {
    ...o,
    ...KNOWS.find((k) => k.person_name.startsWith(o.fullname_cut)),
  };
}

// console.log(try_infer_human_name(" X3244 น.ส. ณัฏฐ์นรี ฤกษ์++"));
// console.log(try_infer_human_name("ณัฏฐ์นรี ฤกษ์++"));
// console.log(try_infer_human_name(""));
// console.log(try_infer_human_name("โอนไป X3244 น.ส. ณัฏฐ์นรี ฤกษ์++"));
// console.log(try_infer_human_name("โอนไป SCB X2317 นางสาว ปณาลี ก้อนแ++"));
// console.log(try_infer_human_name("โอนไป KTB X7010 น.ส. ศศิภรณ์ โมราร++"));
// console.log(try_infer_human_name("โอนไป KTB X5432 น.ส.ศุภกานต์ ผดุง++"));
// console.log(try_infer_human_name("จาก X3440 บจก. เอ็นพีพี บ็อก++"));
// console.log(try_infer_human_name("โอนไป X3028 นาย กฤษฏิ์ พรไพริน++"));
// console.log(try_infer_human_name("จาก X9635 บจก. โกลว ครีเอท++"));
// console.log(try_infer_human_name("โอนไป SCB X8008 บริษัท สิตาภัส จำก++"));
// console.log(try_infer_human_name("จาก SMART BBL X9328 WORKS CREATIVE CO.++"));
// console.log(try_infer_human_name("โอนไป LHBANK X6082 น.ส. กัลลยารัตน์ น++"));

// process.exit(0);

const pdf_file_path = await pipe(
  process.argv[2],
  O.fromNullable,
  E.fromOption(() => E.toError("expect in pass *.pdf as arguments")),
  E.chain(
    E.fromPredicate(string.endsWith(".pdf"), (x) =>
      E.toError(`accpect only *.pdf got ${x}`)
    )
  ),
  TE.fromEither,
  TE.chain((a) =>
    TE.tryCatch(() => fs.access(a, fs.constants.R_OK).then(() => a), E.toError)
  ),
  TE.getOrElse((err) => {
    throw err;
  })
)();

const fp_ensure_writable_empty_dir = async (outdir: string) => {
  if (!path.isAbsolute(outdir)) {
    throw new Error(`require absolute path, got ${outdir}`);
  }
  await fs.remove(outdir).catch(_.noop);
  await fs.mkdir(outdir, { recursive: true });
  await fs.ensureDir(outdir, fs.constants.W_OK);
  return outdir;
};

const outdir = rpath("out/generate");
const xpdfhtmls = await pipe(
  pdftohtml({
    pdf_path: pdf_file_path,
    output_dir: path.resolve(
      await fp_ensure_writable_empty_dir(outdir),
      "html"
    ),
  }),
  TE.getOrElse((err) => {
    throw err;
  })
)();

const REGEX_MONEY = /^\d{1,3}(,\d{3})*\.\d{2}$/;
const REGEX_MONEY_STR = `\\d{1,3}(,\\d{3})*\\.\\d{2}`;
const REGEX_TIME = /^[012]\d:[0123456]\d$/;
const REGEX_DD_MM_YY = /^[0123]\d-[01]\d-\d\d$/;
const REGEX_DD_MM_YYYY = /^[0123]\d\/[01]\d\/20\d\d$/;
const REGEX_DD_MM_YYYY_STR = `[0123]\\d\\/[01]\\d\\/20\\d\\d`;
const REGEX_TRANSACTION_DETAIL = /^(จาก|โอนไป)( .+)? X\d{4} .+$/;
const REGEX_IS_STRING = /.+/;

type Point = { x: number; y: number };
type XPDFHtmlText = { text: string } & Point;
const ord_point = Ord.contramap((o: Point) => o.y)(N.Ord);
const ord2_point = Ord.contramap((o: Point) => o.y)(N.Ord);
const x = A.sortBy([ord_point, ord2_point]);

type ActualOutputRow =
  | {
      type: "carry";
      transaction_name: "ยอดยกมา";
      date: string;
      total: number;
    }
  | {
      type: "payment";
      transaction_name: "โอนเงิน";
      date: string;
      time: string;
      total: number;
      amount: number;
      chanel: string;
      detail: string;
    }
  | {
      type: "receive";
      transaction_name: "รับโอนเงิน" | "รับโอนเงินอัตโนมัติ";
      date: string;
      time: string;
      total: number;
      amount: number;
      chanel: string;
      detail: string;
    };

const parse_money = (money: string) => {
  assert(REGEX_MONEY.test(money), `money must in kbank format got ${money}`);
  return +money.replaceAll(",", "");
};

const is_รับโอนเงิน = (
  a: string
): a is "รับโอนเงิน" | "รับโอนเงินอัตโนมัติ" => {
  return a === "รับโอนเงิน" || a === "รับโอนเงินอัตโนมัติ";
};
const is_same_row = (a: Point, ...rest: Point[]): boolean =>
  rest.every((p) => p.y === a.y);
const is_same_col = (a: Point, ...rest: Point[]): boolean =>
  rest.every((p) => p.x === a.x);

type KVlidate<T> =
  | T
  | ((inp: T) => boolean)
  | (T extends string ? RegExp : never)
  | (T extends object ? { [key in keyof T]?: KVlidate<T[key]> } : never)
  | (T extends (infer B)[] ? KVlidate<B>[] : never);

const K_DEBUG = !!process.env.DEBUG;
const k_check = <
  T extends string | number | Record<string, any>[] | Record<string, any>,
  V extends KVlidate<T>
>(
  expect: V,
  actual: T
) => {
  if (K_DEBUG) {
    console.log("k_check", { expect, actual });
  }
  if (
    (typeof expect === "string" || typeof expect === "number") &&
    typeof expect === typeof actual
  ) {
    return expect === actual;
  }
  if (typeof expect === "function") {
    // console.log("CALL FUBCTION", [expect, actual, expect(actual)]);
    return expect(actual);
  }
  if (Array.isArray(expect) && Array.isArray(actual)) {
    return (
      expect.length === actual.length &&
      expect.every((ex, i) => k_check(ex, actual[i]))
    );
  }
  if (expect instanceof RegExp && typeof actual === "string") {
    if (K_DEBUG) {
      console.log("kdebug:regex", [expect.test(actual), expect, actual]);
    }
    return expect.test(actual);
  }
  if (_.isObject(expect) && _.isObject(actual)) {
    return _.keys(expect).every((k) => k_check(expect[k], actual[k]));
  }

  // console.log("NOT MATCH K CHECK", { expect, actual });
  return false;
};

const X_POS = {
  date: 45,
  time: 83,
  transaction_name: 108,
  amount: 200,
  total: 295,
  chanel: 353,
  detail: 432,
};

/// test
assert(
  k_check(
    [
      { x: 45, y: 247, text: REGEX_DD_MM_YY },
      { x: 108, y: 247, text: "ยอดยกมา" },
      { x: 315, y: 247, text: REGEX_MONEY },
    ],
    [
      { x: 45, y: 247, text: "01-11-22" },
      { x: 108, y: 247, text: "ยอดยกมา" },
      { x: 315, y: 247, text: "532,845.10" },
    ]
  )
);
assert(
  k_check(
    [
      { x: 45, text: REGEX_DD_MM_YY },
      { x: 83, text: REGEX_TIME },
      { x: 108, text: is_รับโอนเงิน },
      { text: REGEX_MONEY },
      { x: 315, text: REGEX_MONEY },
      { x: 353, text: REGEX_IS_STRING },
      { x: 432, text: REGEX_TRANSACTION_DETAIL },
    ],
    [
      { x: 45, y: 260, text: "04-11-22" },
      { x: 83, y: 260, text: "02:25" },
      { x: 108, y: 260, text: "รับโอนเงินอัตโนมัติ" },
      { x: 247, y: 260, text: "211,848.00" },
      { x: 315, y: 260, text: "744,693.10" },
      { x: 353, y: 260, text: "โอนเข้า/หักบัญชีอัตโนมัติ" },
      { x: 432, y: 260, text: "จาก SMART BBL X9328 WORKS CREATIVE CO.++" },
    ]
  )
);

// assert(k_check(REGEX_TRANSACTION_DETAIL, "จาก X1914 บจก. พัลมา++"));
// assert(
//   k_check(REGEX_TRANSACTION_DETAIL, "จาก SMART BBL X9328 WORKS CREATIVE CO.++")
// );

let pages: {
  meta: Record<string, number | string>;
  data: ActualOutputRow[];
}[] = [];

const html2textposition = (html: string) =>
  pipe(
    cheerio.load(html),
    ($) => $(".txt[style]").toArray(),
    A.map((el) =>
      pipe(
        el.attribs.style,
        fp_regex_exec_groups(
          /^position:absolute; left:(?<x>\d+)px; top:(?<y>\d+)px;$/
        ),
        E.fromOption(
          () =>
            new Error(
              `el.attribs.style not match ^position:absolute; left:(?<x>\\d+)px; top:(?<y>\\d+)px;`
            )
        ),
        E.chainW(
          flow(
            R.map(parseInt),
            ({ x, y }) => ({ x, y, text: cheerio.load(el).text().trim() }),
            D.struct({ x: D.number, y: D.number, text: D.string }).decode,
            E.mapLeft((err) => new Error(D.draw(err)))
          )
        )
      )
    ),
    A.sequence(E.Applicative),
    E.map(
      A.sortBy([
        Ord.contramap((o: Point) => o.y)(N.Ord),
        Ord.contramap((o: Point) => o.x)(N.Ord),
      ])
    )
  );

const fp_array_extract_regexs =
  (re: RegExp[]) =>
  (
    strs: string[]
  ): O.Option<{
    init: Record<string, string>;
    rest: string[];
  }> => {
    const idx = pipe(
      strs,
      fp_array_divvy(re.length)(1),
      A.findIndex((xs) => {
        return pipe(
          A.zip(re, xs),
          A.every(([r, x]) => r.test(x))
        );
      })
    );
    return pipe(
      idx,
      O.map((i) =>
        pipe(
          strs,
          A.splitAt(i),
          ([head, rest]) => [head, A.splitAt(re.length)(rest)] as const,
          ([head, [xs, tail]]) => ({
            rest: A.concat(head)(tail),
            init: pipe(
              A.zip(xs, re),
              A.map(([s, r]) =>
                pipe(r.exec(s), (o) => O.fromNullable(o?.groups))
              ),
              A.reduce({}, (acc: Record<string, string>, obj) => ({
                ...acc,
                ...O.toNullable(obj),
              }))
            ),
          })
        )
      )
    );
  };

function parse_xpdfhtml_head(head: XPDFHtmlText[]): Record<string, any> {
  const { left: column_left, right: column_right } = pipe(
    head,
    A.partition((p) => p.x >= 346)
  );

  console.log({ column_left, column_right });

  let out = pipe(
    head,
    A.map((o) => o.text),
    A.chop((arr) => {
      return pipe(
        [
          [
            /^ที่ (?<kbank_pdf_id>[A-Z]{2}\.[0-9]{3} : [A-Z0-9]{22}\/25[0-9]{2})$/,
          ],
          [
            /^หน้าที่ (?<page_current>\d)\/(?<page_total>\d)\((?<page_id>\d{4})\)/,
          ],
          [/^เลขที่อ้างอิง$/, /^(?<kbank_reference_id>\d{20})$/],
          [/^เลขที่บัญชีเงินฝาก$/, /^(?<account_id_censor>XXX-X-XX\d{3}-\d)$/],
          [
            /^รอบระหว่างวันที่$/,
            /^(?<date_begin>[0123]\d\/[01]\d\/20\d\d) - (?<date_end>[0123]\d\/[01]\d\/20\d\d)$/,
          ],
          [/^สาขาเจ้าของบัญชี$/, /^(?<account_location>สาขา.+)$/],
          [/^ยอดยกไป$/, new RegExp(`^(?<summary_total>${REGEX_MONEY_STR})$`)],
          [
            /^รวมถอนเงิน (?<summary_payment_count>\d+) รายการ$/,
            new RegExp(`^(?<summary_payment_money>${REGEX_MONEY_STR})$`),
          ],
          [
            /^รวมฝากเงิน (?<summary_receive_count>\d+) รายการ$/,
            new RegExp(`^(?<summary_receive_money>${REGEX_MONEY_STR})$`),
          ],
          [/^ชื่อบัญชี (?<account_name>.+)$/],
        ],
        A.reduce(
          { rest: arr as string[], result: {} as Record<string, string> },
          (out, re) => {
            return pipe(
              fp_array_extract_regexs(re)(out.rest),
              O.fold(
                () => out,
                ({ init, rest }) => ({
                  rest: rest,
                  result: { ...out.result, ...init },
                })
              )
            );
          }
        ),
        (o) =>
          arr.length === o.rest.length
            ? [{ ...o.result, address: o.rest.join("\n") }, []]
            : [o.result, o.rest]
      );
    }),
    A.reduce({}, (acc: Record<string, string>, obj) => ({ ...acc, ...obj }))
  );

  return out;

  // let filtered_headers: Record<string, any> = {};

  // for (const regexs of REGEXS_HEADER) {
  //   const n = regexs.length;
  //   const i = _.range(head.length)
  //     .map((i) => head.slice(i, i + n).map((t) => t.text))
  //     .findIndex((strs) => k_check(regexs as any as RegExp[], strs));

  //   if (i !== -1) {
  //     //! mutable
  //     const txts = head.splice(i, n).map((t) => t.text);
  //     for (const [txt, re] of _.zip(txts, regexs)) {
  //       filtered_headers = {
  //         ...filtered_headers,
  //         ...re.exec(txt).groups,
  //       };
  //       console.log({ filtered_headers });
  //     }
  //   } else {
  //     console.log("NOTFOUND", regexs, head);
  //   }
  // }
  // filtered_headers.page_current = +filtered_headers.page_current;
  // filtered_headers.page_total = +filtered_headers.page_total;
  // filtered_headers.address = [
  //   filtered_headers.address_line_1,
  //   filtered_headers.address_line_2,
  //   filtered_headers.address_line_3,
  // ]
  //   .filter(_.isString)
  //   .join(" ")
  //   .trim();
  // delete filtered_headers.address_line_1;
  // delete filtered_headers.address_line_2;
  // delete filtered_headers.address_line_3;
  return {};
}
function parse_xpdfhtml_table(head: XPDFHtmlText[]): Record<string, any> {
  return {};
}

function parse_xpdfhtml(html: string) {
  const texts = pipe(
    html2textposition(html),
    E.getOrElseW((err) => {
      throw err;
    })
  );
  const { head, table } = pipe(
    O.Do,
    O.bind("arr", () => nonEmptyArray.fromArray(texts)),
    O.bind("range", ({ arr }) =>
      O.some(nonEmptyArray.range(0, arr.length - 1))
    ),
    O.bind("tablehead", () =>
      nonEmptyArray.fromArray([
        { x: 82, y: 213, text: "เวลา/" },
        { x: 52, y: 220, text: "วันที่" },
        { x: 138, y: 220, text: "รายการ" },
        { x: 211, y: 220, text: "ถอนเงิน / ฝากเงิน" },
        { x: 299, y: 220, text: "ยอดคงเหลือ" },
        { x: 379, y: 220, text: "ช่องทาง" },
        { x: 481, y: 220, text: "รายละเอียด" },
        { x: 77, y: 226, text: "วันที่มีผล" },
      ])
    ),
    O.chain((o) =>
      pipe(
        o.range,
        A.findFirst((idx) =>
          pipe(
            A.zip(o.tablehead, o.arr.slice(idx)),
            A.every(([a, b]) => a.text === b.text)
          )
        ),
        O.map((idx) => ({
          head: o.arr.slice(0, idx),
          table: o.arr.slice(idx + o.tablehead.length),
        }))
      )
    ),
    O.getOrElseW(() => {
      throw new Error("can not infer table head");
    })
  );

  return {
    head: parse_xpdfhtml_head(head),
  };

  // let { headers, rows } = (() => {
  //   const sorted_texts = texts;
  //   const row_header_idx = sorted_texts.findIndex((t, idx, arr) => {
  //     if (t.text !== HEADER_CHECK[0].text) return;
  //     // if (idx > 18 && idx < 22) {
  //     //   console.log("TEST", idx, arr.slice(idx, idx + HEADER_CHECK.length));
  //     //   let a = HEADER_CHECK;
  //     //   let b = arr.slice(idx, idx + HEADER_CHECK.length);
  //     //   console.log(a[0], b[0], k_check(a[0], b[0]));
  //     // }

  //     return k_check(HEADER_CHECK, arr.slice(idx, idx + HEADER_CHECK.length));
  //   });

  // console.log({ sorted_texts });
  // assert(row_header_idx !== -1, "must found header");
  // console.log({ row_header_idx });
  // assert(isFinite(row_header_idx), "must able to font header row");

  // return {
  //   headers: sorted_texts.slice(0, row_header_idx),
  //   rows: sorted_texts
  //     .slice(row_header_idx + HEADER_CHECK.length)
  //     .reduce((acc: XPDFHtmlText[], itm) => {
  //       // prettier-ignore
  //       const new_x = _.findLast([
  //             X_POS.date,
  //             X_POS.time,
  //             X_POS.transaction_name,
  //             X_POS.amount,
  //             X_POS.total,
  //             X_POS.chanel,
  //             X_POS.detail,
  //           ], p => itm.x >= p);

  //       // console.log("x", itm.x, new_x);
  //       itm.x = new_x;
  //       if (!_.isEmpty(acc)) {
  //         const back = _.last(acc);
  //         if (is_same_col(itm, back)) {
  //           console.log(itm, acc);
  //           // assumed mutiple line
  //           //! mutate back
  //           back.text += " " + itm.text;
  //           return acc.slice();
  //         } else {
  //           return [...acc, itm];
  //         }
  //       }
  //       return [...acc, itm];
  //     }, []),
  // };
}

const page_1 = parse_xpdfhtml(xpdfhtmls[0].html_content);
console.log(page_1);
//   let filtered_headers: Record<string, any> = {};

//   for (const regexs of REGEXS_HEADER) {
//     const n = regexs.length;
//     const i = _.range(headers.length)
//       .map((i) => headers.slice(i, i + n).map((t) => t.text))
//       .findIndex((strs) => k_check(regexs as any as RegExp[], strs));

//     if (i !== -1) {
//       //! mutable
//       const txts = headers.splice(i, n).map((t) => t.text);
//       for (const [txt, re] of _.zip(txts, regexs)) {
//         filtered_headers = {
//           ...filtered_headers,
//           ...re.exec(txt).groups,
//         };
//         console.log({ filtered_headers });
//       }
//     } else {
//       console.log("NOTFOUND", regexs, headers);
//     }
//   }
//   filtered_headers.page_current = +filtered_headers.page_current;
//   filtered_headers.page_total = +filtered_headers.page_total;
//   filtered_headers.address = [
//     filtered_headers.address_line_1,
//     filtered_headers.address_line_2,
//     filtered_headers.address_line_3,
//   ]
//     .filter(_.isString)
//     .join(" ")
//     .trim();
//   delete filtered_headers.address_line_1;
//   delete filtered_headers.address_line_2;
//   delete filtered_headers.address_line_3;

//   if (headers.length > 0) {
//     console.error("HEADERS not clean all", headers);
//   }
//   assert(headers.length == 0);

//   console.log({ filtered_headers, remain_header: headers });

//   // process.exit(0);

//   let actual_rows: ActualOutputRow[] = [];

//   let is_valid_head = false;
//   while (!_.isEmpty(rows)) {
//     if (
//       rows.length >= 3 &&
//       k_check(
//         [
//           { text: "สอบถามข้อมูลเพิ่มเติม" },
//           {
//             text: "บุคคลธรรมดา K Contact Center 02-8888888 นิติบุคคล K-BIZ Contact",
//           },
//           { text: "Center 02-8888822" },
//         ],
//         rows.slice(0, 3)
//       )
//     ) {
//       rows.splice(0, 3);
//       continue;
//     }
//     if (
//       rows.length == 1 &&
//       k_check([{ text: "ออกโดย K BIZ" }], rows.slice(0, 1))
//     ) {
//       rows.splice(0, 1);
//       continue;
//     }
//     if (
//       k_check(
//         [
//           { y: 247, x: X_POS.date, text: REGEX_DD_MM_YY },
//           { y: 247, x: X_POS.transaction_name, text: "ยอดยกมา" },
//           { y: 247, x: X_POS.total, text: REGEX_MONEY },
//         ],
//         rows.slice(0, 3)
//       )
//     ) {
//       is_valid_head = true;
//       actual_rows.push({
//         type: "carry",
//         date: rows[0].text,
//         transaction_name: "ยอดยกมา",
//         total: parse_money(rows[2].text),
//       });
//       rows.splice(0, 3);
//       continue;
//     }

//     assert(is_valid_head, "ต้องมี head ก่อนจะเริ่ม row");

//     if (
//       k_check(
//         [
//           { y: rows[0].y, x: X_POS.date, text: REGEX_DD_MM_YY },
//           { y: rows[0].y, x: X_POS.time, text: REGEX_TIME },
//           { y: rows[0].y, x: X_POS.transaction_name, text: is_รับโอนเงิน },
//           { y: rows[0].y, x: X_POS.amount, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.total, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.chanel, text: REGEX_IS_STRING },
//           { y: rows[0].y, x: X_POS.detail, text: REGEX_TRANSACTION_DETAIL },
//         ],
//         rows.slice(0, 7)
//       )
//     ) {
//       assert(is_รับโอนเงิน(rows[2].text), "ต้องหาร /^รับโอน.*/");
//       actual_rows.push({
//         type: "receive",
//         date: rows[0].text,
//         time: rows[1].text,
//         transaction_name: rows[2].text,
//         amount: parse_money(rows[3].text),
//         total: parse_money(rows[4].text),
//         chanel: rows[5].text,
//         detail: rows[6].text,
//       });
//       rows.splice(0, 7);
//       continue;
//     }
//     if (
//       k_check(
//         [
//           { y: rows[0].y, x: X_POS.date, text: REGEX_DD_MM_YY },
//           { y: rows[0].y, x: X_POS.time, text: REGEX_TIME },
//           { y: rows[0].y, x: X_POS.transaction_name, text: "โอนเงิน" },
//           { y: rows[0].y, x: X_POS.amount, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.total, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.chanel, text: REGEX_IS_STRING },
//           { y: rows[0].y, x: X_POS.detail, text: REGEX_TRANSACTION_DETAIL },
//         ],
//         rows.slice(0, 7)
//       )
//     ) {
//       actual_rows.push({
//         type: "payment",
//         date: rows[0].text,
//         time: rows[1].text,
//         transaction_name: "โอนเงิน",
//         amount: parse_money(rows[3].text),
//         total: parse_money(rows[4].text),
//         chanel: rows[5].text,
//         detail: rows[6].text,
//       });
//       rows.splice(0, 7);
//       continue;
//     }
//     console.error(rows);
//     throw new Error("row pattern ไม่ตรง");
//   }

//   pages.push({
//     meta: filtered_headers,
//     data: actual_rows,
//   });
// }

// for (const p of xpdfhtmls) {
//   const $ = cheerio.load(p.html_content);
//   let texts: XPDFHtmlText[] = $(".txt[style]")
//     .map((_, el) => {
//       const [, left, top] = fp_regex(
//         /^position:absolute; left:(\d+)px; top:(\d+)px;$/,
//         el.attribs.style
//       );
//       return {
//         x: parseInt(left),
//         y: parseInt(top),
//         text: $(el).text().trim(),
//       };
//     })
//     .toArray();

//   const REGEXS_HEADER = [
//     [/^ที่ (?<uuid>[A-Z]{2}\.[0-9]{3} : [A-Z0-9]{22}\/25[0-9]{2})$/],
//     [/^หน้าที่ (?<page_current>\d)\/(?<page_total>\d)\((?<page_id>\d{4})\)/],
//     [/^เลขที่อ้างอิง$/, /^(?<kbank_reference_id>\d{20})$/],
//     [/^เลขที่บัญชีเงินฝาก$/, /^(?<account_id_censor>XXX-X-XX\d{3}-\d)$/],
//     [
//       /^รอบระหว่างวันที่$/,
//       /^(?<date_begin>[0123]\d\/[01]\d\/20\d\d) - (?<date_end>[0123]\d\/[01]\d\/20\d\d)$/,
//     ],
//     [/^สาขาเจ้าของบัญชี$/, /^(?<account_location>สาขา.+)$/],
//     [/^ยอดยกไป$/, new RegExp(`^(?<summary_total>${REGEX_MONEY_STR})$`)],
//     [
//       /^รวมถอนเงิน (?<summary_payment_count>\d+) รายการ$/,
//       new RegExp(`^(?<summary_payment_money>${REGEX_MONEY_STR})$`),
//     ],
//     [
//       /^รวมฝากเงิน (?<summary_receive_count>\d+) รายการ$/,
//       new RegExp(`^(?<summary_receive_money>${REGEX_MONEY_STR})$`),
//     ],
//     [/^ชื่อบัญชี (?<account_name>.+)$/],
//     [
//       /^(?<address_line_1>.+)$/,
//       /^(?<address_line_2>.+)$/,
//       /^(?<address_line_3>.+)$/,
//     ],
//     [/^(?<address_line_1>.+)$/, /^(?<address_line_2>.+)$/],
//     [/^(?<address_line_1>.+)$/],
//   ] as const;

//   const HEADER_CHECK: XPDFHtmlText[] = [
//     { x: 82, y: 213, text: "เวลา/" },
//     { x: 52, y: 220, text: "วันที่" },
//     { x: 138, y: 220, text: "รายการ" },
//     { x: 211, y: 220, text: "ถอนเงิน / ฝากเงิน" },
//     { x: 299, y: 220, text: "ยอดคงเหลือ" },
//     { x: 379, y: 220, text: "ช่องทาง" },
//     { x: 481, y: 220, text: "รายละเอียด" },
//     { x: 77, y: 226, text: "วันที่มีผล" },
//   ];

//   let { headers, rows } = (() => {
//     const sorted_texts = _.sortBy(texts, ["y", "x"]);
//     const row_header_idx = sorted_texts.findIndex((t, idx, arr) => {
//       if (t.text !== HEADER_CHECK[0].text) return;
//       // if (idx > 18 && idx < 22) {
//       //   console.log("TEST", idx, arr.slice(idx, idx + HEADER_CHECK.length));
//       //   let a = HEADER_CHECK;
//       //   let b = arr.slice(idx, idx + HEADER_CHECK.length);
//       //   console.log(a[0], b[0], k_check(a[0], b[0]));
//       // }

//       return k_check(HEADER_CHECK, arr.slice(idx, idx + HEADER_CHECK.length));
//     });

//     // console.log({ sorted_texts });
//     assert(row_header_idx !== -1, "must found header");
//     // console.log({ row_header_idx });
//     assert(isFinite(row_header_idx), "must able to font header row");

//     return {
//       headers: sorted_texts.slice(0, row_header_idx),
//       rows: sorted_texts
//         .slice(row_header_idx + HEADER_CHECK.length)
//         .reduce((acc: XPDFHtmlText[], itm) => {
//           // prettier-ignore
//           const new_x = _.findLast([
//               X_POS.date,
//               X_POS.time,
//               X_POS.transaction_name,
//               X_POS.amount,
//               X_POS.total,
//               X_POS.chanel,
//               X_POS.detail,
//             ], p => itm.x >= p);

//           // console.log("x", itm.x, new_x);
//           itm.x = new_x;
//           if (!_.isEmpty(acc)) {
//             const back = _.last(acc);
//             if (is_same_col(itm, back)) {
//               console.log(itm, acc);
//               // assumed mutiple line
//               //! mutate back
//               back.text += " " + itm.text;
//               return acc.slice();
//             } else {
//               return [...acc, itm];
//             }
//           }
//           return [...acc, itm];
//         }, []),
//     };
//   })();

//   let filtered_headers: Record<string, any> = {};

//   for (const regexs of REGEXS_HEADER) {
//     const n = regexs.length;
//     const i = _.range(headers.length)
//       .map((i) => headers.slice(i, i + n).map((t) => t.text))
//       .findIndex((strs) => k_check(regexs as any as RegExp[], strs));

//     if (i !== -1) {
//       //! mutable
//       const txts = headers.splice(i, n).map((t) => t.text);
//       for (const [txt, re] of _.zip(txts, regexs)) {
//         filtered_headers = {
//           ...filtered_headers,
//           ...re.exec(txt).groups,
//         };
//         console.log({ filtered_headers });
//       }
//     } else {
//       console.log("NOTFOUND", regexs, headers);
//     }
//   }
//   filtered_headers.page_current = +filtered_headers.page_current;
//   filtered_headers.page_total = +filtered_headers.page_total;
//   filtered_headers.address = [
//     filtered_headers.address_line_1,
//     filtered_headers.address_line_2,
//     filtered_headers.address_line_3,
//   ]
//     .filter(_.isString)
//     .join(" ")
//     .trim();
//   delete filtered_headers.address_line_1;
//   delete filtered_headers.address_line_2;
//   delete filtered_headers.address_line_3;

//   if (headers.length > 0) {
//     console.error("HEADERS not clean all", headers);
//   }
//   assert(headers.length == 0);

//   console.log({ filtered_headers, remain_header: headers });

//   // process.exit(0);

//   let actual_rows: ActualOutputRow[] = [];

//   let is_valid_head = false;
//   while (!_.isEmpty(rows)) {
//     if (
//       rows.length >= 3 &&
//       k_check(
//         [
//           { text: "สอบถามข้อมูลเพิ่มเติม" },
//           {
//             text: "บุคคลธรรมดา K Contact Center 02-8888888 นิติบุคคล K-BIZ Contact",
//           },
//           { text: "Center 02-8888822" },
//         ],
//         rows.slice(0, 3)
//       )
//     ) {
//       rows.splice(0, 3);
//       continue;
//     }
//     if (
//       rows.length == 1 &&
//       k_check([{ text: "ออกโดย K BIZ" }], rows.slice(0, 1))
//     ) {
//       rows.splice(0, 1);
//       continue;
//     }
//     if (
//       k_check(
//         [
//           { y: 247, x: X_POS.date, text: REGEX_DD_MM_YY },
//           { y: 247, x: X_POS.transaction_name, text: "ยอดยกมา" },
//           { y: 247, x: X_POS.total, text: REGEX_MONEY },
//         ],
//         rows.slice(0, 3)
//       )
//     ) {
//       is_valid_head = true;
//       actual_rows.push({
//         type: "carry",
//         date: rows[0].text,
//         transaction_name: "ยอดยกมา",
//         total: parse_money(rows[2].text),
//       });
//       rows.splice(0, 3);
//       continue;
//     }

//     assert(is_valid_head, "ต้องมี head ก่อนจะเริ่ม row");

//     if (
//       k_check(
//         [
//           { y: rows[0].y, x: X_POS.date, text: REGEX_DD_MM_YY },
//           { y: rows[0].y, x: X_POS.time, text: REGEX_TIME },
//           { y: rows[0].y, x: X_POS.transaction_name, text: is_รับโอนเงิน },
//           { y: rows[0].y, x: X_POS.amount, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.total, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.chanel, text: REGEX_IS_STRING },
//           { y: rows[0].y, x: X_POS.detail, text: REGEX_TRANSACTION_DETAIL },
//         ],
//         rows.slice(0, 7)
//       )
//     ) {
//       assert(is_รับโอนเงิน(rows[2].text), "ต้องหาร /^รับโอน.*/");
//       actual_rows.push({
//         type: "receive",
//         date: rows[0].text,
//         time: rows[1].text,
//         transaction_name: rows[2].text,
//         amount: parse_money(rows[3].text),
//         total: parse_money(rows[4].text),
//         chanel: rows[5].text,
//         detail: rows[6].text,
//       });
//       rows.splice(0, 7);
//       continue;
//     }
//     if (
//       k_check(
//         [
//           { y: rows[0].y, x: X_POS.date, text: REGEX_DD_MM_YY },
//           { y: rows[0].y, x: X_POS.time, text: REGEX_TIME },
//           { y: rows[0].y, x: X_POS.transaction_name, text: "โอนเงิน" },
//           { y: rows[0].y, x: X_POS.amount, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.total, text: REGEX_MONEY },
//           { y: rows[0].y, x: X_POS.chanel, text: REGEX_IS_STRING },
//           { y: rows[0].y, x: X_POS.detail, text: REGEX_TRANSACTION_DETAIL },
//         ],
//         rows.slice(0, 7)
//       )
//     ) {
//       actual_rows.push({
//         type: "payment",
//         date: rows[0].text,
//         time: rows[1].text,
//         transaction_name: "โอนเงิน",
//         amount: parse_money(rows[3].text),
//         total: parse_money(rows[4].text),
//         chanel: rows[5].text,
//         detail: rows[6].text,
//       });
//       rows.splice(0, 7);
//       continue;
//     }
//     console.error(rows);
//     throw new Error("row pattern ไม่ตรง");
//   }

//   pages.push({
//     meta: filtered_headers,
//     data: actual_rows,
//   });
// }

// // merge data
// console.log(pages);

// const merged_meta = pipe(
//   pages,
//   array.map((r) => r.meta),
//   (o) => {
//     assert(
//       o.every(
//         (i, idx) => i.page_current === 1 + idx && i.page_total === o.length
//       ),
//       "contain all page"
//     );
//     return o.map((i) => _.omit(i, "page_current", "page_total"));
//   },
//   (arr) => {
//     assert(
//       arr.every((itm) => {
//         // arr[0] is first page, so always have full information
//         if (!k_check(itm, arr[0])) {
//           console.log("meta not same ", itm, arr[0]);
//           return false;
//         }
//         return true;
//       }),
//       "all meta must equal"
//     );
//     return arr[0];
//   },
//   (o) => {
//     // prettier-ignore
//     return {
//       ...o,
//       summary_total: parse_money(o.summary_total as string),
//       summary_payment_count: parseInt(o.summary_payment_count as string),
//       summary_payment_money: parse_money(o.summary_payment_money as string),
//       summary_receive_count: parseInt(o.summary_receive_count as string),
//       summary_receive_money: parse_money(o.summary_receive_money as string),
//     }
//   }
// );

// const transactions = pipe(
//   pages,
//   array.map((o) => o.data),
//   array.flatten
// );

// const __ = pipe(
//   transactions,
//   (o) => {
//     const {
//       payment = [],
//       receive = [],
//       carry = [],
//     } = _.groupBy(o, (a) => a.type);
//     console.log({
//       carry: carry.length,
//       pages: pages.length,
//       payment: payment.length,
//       receive: receive.length,
//     });
//     assert(pages.length === carry.length);
//     assert(merged_meta.summary_payment_count === payment.length);
//     assert(merged_meta.summary_receive_count === receive.length);
//     assert(
//       merged_meta.summary_payment_money ===
//         _.sumBy(payment, (o) => (o as any).amount)
//     );
//     assert(
//       merged_meta.summary_receive_money ===
//         _.sumBy(receive, (o) => (o as any).amount)
//     );
//     return o;
//   },
//   array.reduce(null as null | number, (acc, itm) => {
//     console.log("acc", acc, itm);

//     switch (itm.type) {
//       case "carry": {
//         assert(acc === null || acc === itm.total);
//         return itm.total;
//       }
//       case "payment": {
//         assert(_.isNumber(acc));
//         console.log("payment:", itm.total, "==", acc - itm.amount);
//         assert(num_eq(itm.total, acc - itm.amount));
//         return itm.total;
//       }
//       case "receive": {
//         assert(_.isNumber(acc));
//         assert(num_eq(itm.total, acc + itm.amount));
//         return itm.total;
//       }
//     }
//   }),
//   (o) => {
//     console.log({ a: merged_meta.summary_total, b: o });
//     assert(
//       num_eq(merged_meta.summary_total, o),
//       "sum transaction not equal summary on page one"
//     );
//     return o;
//   }
// );

// const transactions_without_carry = pipe(
//   transactions
//     .filter(
//       <T extends { type: string }>(
//         itm: T
//       ): itm is T & { type: "payment" | "receive" } =>
//         itm.type === "payment" || itm.type === "receive"
//     )
//     .map((o, idx) => {
//       return {
//         id: idx + 1,
//         ...o,
//       };
//     })
// );

// const final_output = {
//   meta: merged_meta,
//   data: transactions_without_carry,
// };
// await fs.writeJSON(path.resolve(outdir, "out.json"), final_output, {
//   spaces: 2,
//   replacer: null,
// });

// const XLSX_FORMAT_MONEY = "_([$฿]* #,##0.00_);_(฿* (#,##0.00);_( -_);_(@_)";

// xlsx(
//   [
//     {
//       sheet: "Transaction",
//       // prettier-ignore
//       columns: [
//         { label: "ที่", value: "id", format: "0" },
//         { label: "วันที่ใบเสร็จ", value: "date", format: "@" },
//         { label: "เวลาใบเสร็จ", value: "time", format: "@" },
//         { label: "เลขที่ใบเสร็จ", value: "invoice_id", format: "@" },
//         { label: "จ่ายให้ / รับจาก", value: "person", format: "@" },
//         { label: "รายการ", value: "transaction_name", format: "@" },
//         { label: "รายรับ", value: "receive_amount", format: XLSX_FORMAT_MONEY },
//         { label: "รายจ่าย", value: "payment_amount", format: XLSX_FORMAT_MONEY },
//         { label: "สำรองจ่ายโดย", value: "prepaid_by", format: "@" },
//         { label: "หมายเหตุ", value: "detail", format: "@" },
//         // { label: "transaction_name", value: "transaction_name" },
//         // { label: "type", value: "type", format: XLSX_FORMAT_MONEY },
//         // { label: "amount", value: "amount", format: XLSX_FORMAT_MONEY },
//         // { label: "total", value: "total", format: XLSX_FORMAT_MONEY },
//         // { label: "chanel", value: "chanel", format: "@" },
//         // { label: "detail", value: "detail", format: "@" },
//       ],
//       content: final_output.data.map((o) => {
//         const person = try_infer_human_name(o.detail);
//         return Object.assign({
//           ...o,
//           invoice_id: "-",
//           receive_amount: o.type == "receive" ? o.amount : 0,
//           payment_amount: o.type == "payment" ? o.amount : 0,
//           prepaid_by: "",
//           person: person?.person_name ?? person.fullname_dirty,
//           transaction_name:
//             person?.person_role === "insbx" &&
//             18_000 <= o.amount &&
//             o.amount < 40_000
//               ? "เงินเดือน"
//               : "",
//         });
//       }),
//     },
//     {
//       sheet: "Metadata",
//       columns: [
//         { label: "key", value: "key" },
//         { label: "value", value: "value" }, // Top level data
//       ],
//       content: _.sortBy(
//         _.toPairs(merged_meta).map(([key, val]) => ({ key: key, value: val })),
//         "key"
//       ),
//     },
//   ],
//   {
//     fileName: path.resolve(outdir, "out"),

//     // extraLength: 3, // A bigger number means that columns will be wider
//     writeMode: "writeFile",
//     writeOptions: {
//       type: "file",
//     },
//     RTL: false, // Display the columns from right-to-left (the default value is false)
//   }
// );

// // await fs.writeFile(path.resolve(outdir, "out.xlsx"), xlsx_buff);
