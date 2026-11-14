import {
  type ColumnInfo,
  columnName,
  type ForeignKeyInfo,
  schemaName,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";

// SQLite のスキーマは main だけを扱う（02 §2）。
export const MAIN_SCHEMA = schemaName("main");

// 内部のテーブル（sqlite_sequence など）は PostgreSQL のシステムスキーマと同じく一覧に出さない。
export const CATALOG_SQL = {
  listTables: `SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name`,
  tableEntry: `SELECT type, sql FROM sqlite_schema WHERE name = ? AND type IN ('table', 'view')`,
  // 生成列は SELECT * に含まれるが table_info には出ないので、table_xinfo を使い、仮想テーブルの隠し列（1）を除く
  columns: `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_xinfo(?) WHERE hidden IN (0, 2, 3) ORDER BY cid`,
  indexList: `SELECT name, "unique", origin FROM pragma_index_list(?) ORDER BY seq`,
  indexKeys: `SELECT name FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno`,
  indexSql: `SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?`,
  foreignKeys: `SELECT id, seq, "table", "from", "to" FROM pragma_foreign_key_list(?) ORDER BY id, seq`,
} as const;

type Row = ReadonlyArray<unknown>;

// pragma の整数は BigInt で届く
const toNumber = (value: unknown): number => Number(value);
const toText = (value: unknown): string => String(value);
const toNullableText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

// [name, type, notnull, dflt_value, pk]
export const columnInfoFromRow = (row: Row): ColumnInfo => {
  const primaryKeyPosition = toNumber(row[4]);
  return {
    name: columnName(toText(row[0])),
    dbType: toText(row[1]),
    // 主キーの列は、NOT NULL を書かなくても NULL を入れるものとして扱わない
    nullable: toNumber(row[2]) === 0 && primaryKeyPosition === 0,
    defaultValue: toNullableText(row[3]),
    primaryKeyPosition: primaryKeyPosition > 0 ? primaryKeyPosition : null,
  };
};

const CLOSERS: Readonly<Record<string, string>> = { "'": "'", '"': '"', "`": "`", "[": "]" };

// 引用符で囲まれた区間の直後の位置。閉じていなければ末尾。
const skipQuoted = (sql: string, start: number): number => {
  const closer = CLOSERS[sql.charAt(start)] ?? "";
  let i = start + 1;
  while (i < sql.length) {
    if (sql.charAt(i) === closer) {
      // 引用符を 2 つ重ねたものは引用符そのもの（角括弧は重ねられない）
      if (closer !== "]" && sql.charAt(i + 1) === closer) i += 2;
      else return i + 1;
    } else {
      i++;
    }
  }
  return sql.length;
};

const trimOrdering = (item: string): string =>
  item
    .trim()
    .replace(/\s+(?:ASC|DESC)$/i, "")
    .replace(/\s+COLLATE\s+\S+$/i, "");

/**
 * CREATE INDEX の列の並び（最初の最上位の括弧の中）を、最上位のカンマで区切って返す。
 * pragma は式インデックスの式を返さないので、その文字列はここで DDL から取り出す。
 */
export const parseIndexItems = (sql: string | null): ReadonlyArray<string> => {
  if (sql === null) return [];
  let i = 0;
  while (i < sql.length && sql.charAt(i) !== "(") {
    i += sql.charAt(i) in CLOSERS ? skipQuoted(sql, i) - i : 1;
  }
  const items: Array<string> = [];
  let depth = 1;
  let itemStart = i + 1;
  i++;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (ch in CLOSERS) {
      i = skipQuoted(sql, i);
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) {
        items.push(trimOrdering(sql.slice(itemStart, i)));
        return items;
      }
    }
    if (ch === "," && depth === 1) {
      items.push(trimOrdering(sql.slice(itemStart, i)));
      itemStart = i + 1;
    }
    i++;
  }
  return items;
};

// keyRows は pragma_index_xinfo の [name]（式のときは NULL）。items は DDL の列の並び。
export const indexColumnNames = (
  keyRows: ReadonlyArray<Row>,
  items: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  keyRows.map((row, position) => toNullableText(row[0]) ?? items[position] ?? "<expression>");

// 行は [id, seq, table, from, to]。to が NULL の外部キーは、参照先の主キーの列を指す。
export const foreignKeysFromRows = (
  ownTable: string,
  rows: ReadonlyArray<Row>,
  primaryKeyOf: (table: string) => ReadonlyArray<string>,
): ReadonlyArray<ForeignKeyInfo> => {
  const groups = new Map<number, Array<Row>>();
  for (const row of rows) {
    const id = toNumber(row[0]);
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  return Array.from(groups.values(), (group) => {
    const referenced = toText(group[0]?.[2]);
    const from = group.map((row) => toText(row[3]));
    const to = group.every((row) => row[4] !== null)
      ? group.map((row) => toText(row[4]))
      : primaryKeyOf(referenced);
    return {
      name: `${ownTable}_${from.join("_")}_fkey`,
      columns: from.map(columnName),
      references: {
        table: { schema: MAIN_SCHEMA, name: tableName(referenced) },
        columns: to.map(columnName),
      },
    };
  });
};
