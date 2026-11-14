import type {
  ColumnName,
  Dialect,
  Filter,
  RowsQuery,
  TableRef,
} from "@myaaaaa_chan/db-viewer-core";
import { placeholder, quoteIdentifier, quoteTable, syntaxOf } from "./dialect";

export type SqlParam = string | number;

// ドライバにそのまま渡せる形。params の順番は text の中のプレースホルダの順番と一致する。
export type BuiltSql = { readonly text: string; readonly params: ReadonlyArray<SqlParam> };

const COMPARISON: Readonly<Record<Exclude<Filter["op"], "isNull">, string>> = {
  eq: "=",
  neq: "<>",
  lt: "<",
  gt: ">",
  like: "LIKE",
};

// プレースホルダの番号は、文面に書く順に振る。1 回の組み立ての中だけで使う。
const createParams = (dialect: Dialect) => {
  const values: Array<SqlParam> = [];
  return {
    add: (value: SqlParam): string => {
      values.push(value);
      return placeholder(dialect, values.length);
    },
    values: (): ReadonlyArray<SqlParam> => values,
  };
};
type Params = ReturnType<typeof createParams>;

const filterCondition = (dialect: Dialect, params: Params, filter: Filter): string => {
  const column = quoteIdentifier(dialect, filter.column);
  if (filter.op === "isNull") return `${column} IS NULL`;
  const left = filter.op === "like" ? syntaxOf(dialect).likeOperand(column) : column;
  return `${left} ${COMPARISON[filter.op]} ${params.add(filter.value)}`;
};

// rawWhere は括弧で囲んで AND で結合する。末尾の改行は、行コメントで終わる入力が閉じ括弧を巻き込まないため。
const whereClause = (
  dialect: Dialect,
  params: Params,
  filters: ReadonlyArray<Filter>,
  rawWhere: string | null,
): ReadonlyArray<string> => {
  const conditions = filters.map((filter) => filterCondition(dialect, params, filter));
  if (rawWhere !== null && rawWhere.trim() !== "") conditions.push(`(${rawWhere}\n)`);
  return conditions.length === 0 ? [] : [`WHERE ${conditions.join(" AND ")}`];
};

export type RowsSqlInput = {
  // limit と offset はそのまま SQL に使う。アダプターが上限を判定するための余分の 1 行を足してから渡す
  readonly query: RowsQuery;
  // SELECT 句に並べる列。アダプターがカタログから読み取った、そのテーブルの列
  readonly columns: ReadonlyArray<ColumnName>;
  readonly maxCellChars: number;
};

export const buildRowsSql = (dialect: Dialect, input: RowsSqlInput): BuiltSql => {
  const { query, columns, maxCellChars } = input;
  const params = createParams(dialect);
  const select = columns.map((column) => {
    const quoted = quoteIdentifier(dialect, column);
    return `${syntaxOf(dialect).truncatedCell(quoted, maxCellChars)} AS ${quoted}`;
  });
  const where = whereClause(dialect, params, query.filters, query.rawWhere);
  const orderBy = query.sort
    ? [
        `ORDER BY ${quoteIdentifier(dialect, query.sort.column)} ${query.sort.direction === "desc" ? "DESC" : "ASC"}`,
      ]
    : [];
  const limit = `LIMIT ${params.add(query.limit)} OFFSET ${params.add(query.offset)}`;

  const text = [
    "SELECT",
    select.join(",\n"),
    `FROM ${quoteTable(dialect, query.table)}`,
    ...where,
    ...orderBy,
    limit,
  ].join("\n");
  return { text, params: params.values() };
};

export type CountSqlInput = {
  readonly table: TableRef;
  readonly filters: ReadonlyArray<Filter>;
  readonly rawWhere: string | null;
};

export const buildCountSql = (dialect: Dialect, input: CountSqlInput): BuiltSql => {
  const params = createParams(dialect);
  const where = whereClause(dialect, params, input.filters, input.rawWhere);
  const text = [
    `SELECT COUNT(*) AS "count"`,
    `FROM ${quoteTable(dialect, input.table)}`,
    ...where,
  ].join("\n");
  return { text, params: params.values() };
};

export type FetchCellSqlInput = {
  readonly table: TableRef;
  readonly primaryKey: Readonly<Record<string, string>>;
  readonly column: ColumnName;
};

// 1 行に決まらないこと（0 行と 2 行以上）を見分けるため、LIMIT 2 で読む。
export const buildFetchCellSql = (dialect: Dialect, input: FetchCellSqlInput): BuiltSql => {
  const params = createParams(dialect);
  const column = quoteIdentifier(dialect, input.column);
  const conditions = Object.entries(input.primaryKey).map(
    ([key, value]) => `${quoteIdentifier(dialect, key)} = ${params.add(value)}`,
  );
  const text = [
    `SELECT ${syntaxOf(dialect).fullCell(column)} AS ${column}`,
    `FROM ${quoteTable(dialect, input.table)}`,
    ...(conditions.length === 0 ? [] : [`WHERE ${conditions.join(" AND ")}`]),
    "LIMIT 2",
  ].join("\n");
  return { text, params: params.values() };
};
