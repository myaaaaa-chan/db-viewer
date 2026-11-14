import {
  type ColumnInfo,
  type DbResult,
  type DbViewerError,
  err,
  type Filter,
  hasMultipleStatements,
  ok,
  type QueryOutcome,
  type ResultSet,
  splitStatements,
  type TableRef,
  type TableSummary,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import type { DbAdapter } from "../../adapter";
import { capCells } from "../../cells";
import type { Limits } from "../../limits";
import { buildCountSql, buildFetchCellSql, buildRowsSql, type SqlParam } from "../../sql/build";
import { createConcurrencyGate, runGated } from "../concurrency-gate";
import {
  assertSupportedDriver,
  type OpenedStatement,
  openStatement,
  type SqliteDatabaseLike,
} from "./driver";
import { toDbError } from "./errors";
import {
  CATALOG_SQL,
  columnInfoFromRow,
  foreignKeysFromRows,
  indexColumnNames,
  MAIN_SCHEMA,
  parseIndexItems,
} from "./metadata";
import { cellFromSqliteValue } from "./values";

export type SqliteAdapterOptions = {
  // 初期値 true。PRAGMA query_only で書き込みを止める。
  readonly readOnly?: boolean;
};

type Row = ReadonlyArray<unknown>;

const queryError = (message: string): DbViewerError => ({
  kind: "query",
  message,
  sqlState: null,
  position: null,
});

const tableNotFound = (table: TableRef): DbViewerError => ({ kind: "tableNotFound", table });

// SQLite は、存在しない列を二重引用符で囲んだ名前を文字列として扱う場合がある（DQS）。
// 列の名前の打ち間違いが「条件に合う行がない」に化けないよう、先にカタログと突き合わせる。
const noSuchColumn = (
  columns: ReadonlyArray<ColumnInfo>,
  referenced: ReadonlyArray<string>,
): DbViewerError | null => {
  const known = new Set<string>(columns.map((column) => column.name));
  const missing = referenced.find((name) => !known.has(name));
  return missing === undefined ? null : queryError(`no such column: ${missing}`);
};

const filterColumns = (filters: ReadonlyArray<Filter>): ReadonlyArray<string> =>
  filters.map((filter) => filter.column);

// 同期 API で読み切る。上限を 1 行超えたところで止め（イテレータを閉じ）、まだ行があるかを返す。
const readUpTo = (
  opened: OpenedStatement,
  params: ReadonlyArray<SqlParam>,
  limit: number,
): { readonly rows: ReadonlyArray<Row>; readonly more: boolean } => {
  const rows: Array<Row> = [];
  for (const row of opened.rows(params)) {
    if (rows.length >= limit) return { rows, more: true };
    rows.push(row);
  }
  return { rows, more: false };
};

const toCells = (opened: OpenedStatement, rows: ReadonlyArray<Row>) =>
  rows.map((row) => row.map((value) => cellFromSqliteValue(value, opened.integersAsBigInt)));

/**
 * SQLite のアダプター。better-sqlite3 / node:sqlite / bun:sqlite のインスタンスを受け取る（driver.ts）。
 *
 * - タイムアウトは強制しない。ドライバに割り込む手段がなく、重いクエリはその間このプロセスを止める
 * - 中断には対応しない
 * - 読み取り専用は、実行のたびに PRAGMA query_only を ON にして、終わったら元の値に戻す。
 *   渡したインスタンスをアプリが自分でも使っていても、アプリの書き込みを止めない。
 *   実行した SQL が query_only を OFF にしても、次の実行はまた ON から始まる
 */
export const sqliteAdapter = (
  db: SqliteDatabaseLike,
  options: SqliteAdapterOptions = {},
): DbAdapter => {
  const readOnly = options.readOnly ?? true;
  assertSupportedDriver(db);
  const gate = createConcurrencyGate();

  const rowsOf = (sql: string, params: ReadonlyArray<SqlParam> = []): ReadonlyArray<Row> =>
    Array.from(openStatement(db, sql).rows(params));

  const totalChanges = (): number => Number(rowsOf("SELECT total_changes()")[0]?.[0]);

  const columnsOf = (table: TableRef): ReadonlyArray<ColumnInfo> =>
    table.schema === MAIN_SCHEMA
      ? rowsOf(CATALOG_SQL.columns, [table.name]).map(columnInfoFromRow)
      : [];

  const withReadOnly = <T>(work: () => T): T => {
    if (!readOnly) return work();
    const wasQueryOnly = Number(rowsOf("PRAGMA query_only")[0]?.[0]) !== 0;
    db.exec("PRAGMA query_only = ON");
    try {
      return work();
    } finally {
      db.exec(`PRAGMA query_only = ${wasQueryOnly ? "ON" : "OFF"}`);
    }
  };

  // 同時実行数の上限と読み取り専用をかけて、ドライバの例外を Result にする。
  const guarded = <T>(limits: Limits, work: () => DbResult<T>): Promise<DbResult<T>> =>
    runGated(gate, limits, async () => {
      try {
        return withReadOnly(work);
      } catch (cause) {
        return err(toDbError(cause));
      }
    });

  const catalog = <T>(work: () => DbResult<T>): Promise<DbResult<T>> => {
    try {
      return Promise.resolve(work());
    } catch (cause) {
      return Promise.resolve(err(toDbError(cause)));
    }
  };

  const primaryKeyColumnsOf = (table: string): ReadonlyArray<string> =>
    rowsOf(CATALOG_SQL.columns, [table])
      .map(columnInfoFromRow)
      .filter((column) => column.primaryKeyPosition !== null)
      .sort((a, b) => (a.primaryKeyPosition ?? 0) - (b.primaryKeyPosition ?? 0))
      .map((column) => column.name);

  return {
    dialect: "sqlite",
    readOnly,
    capabilities: { cancel: false, enforcesTimeout: false },

    listSchemas: () => catalog(() => ok([MAIN_SCHEMA])),

    listTables: (schema) =>
      catalog(() => {
        if (schema !== MAIN_SCHEMA) return ok([]);
        const tables: ReadonlyArray<TableSummary> = rowsOf(CATALOG_SQL.listTables).map((row) => ({
          ref: { schema: MAIN_SCHEMA, name: tableName(String(row[0])) },
          kind: row[1] === "view" ? "view" : "table",
        }));
        return ok(tables);
      }),

    getTableDetail: (table) =>
      catalog(() => {
        const entry =
          table.schema === MAIN_SCHEMA
            ? rowsOf(CATALOG_SQL.tableEntry, [table.name])[0]
            : undefined;
        if (entry === undefined) return err(tableNotFound(table));

        const indexes = rowsOf(CATALOG_SQL.indexList, [table.name]).map((row) => {
          const name = String(row[0]);
          const sql = rowsOf(CATALOG_SQL.indexSql, [name])[0]?.[0];
          return {
            name,
            columns: indexColumnNames(
              rowsOf(CATALOG_SQL.indexKeys, [name]),
              parseIndexItems(typeof sql === "string" ? sql : null),
            ),
            unique: Number(row[1]) === 1,
            primary: row[2] === "pk",
          };
        });

        return ok({
          summary: {
            ref: table,
            kind: entry[0] === "view" ? ("view" as const) : ("table" as const),
          },
          columns: columnsOf(table),
          indexes,
          foreignKeys: foreignKeysFromRows(
            table.name,
            rowsOf(CATALOG_SQL.foreignKeys, [table.name]),
            primaryKeyColumnsOf,
          ),
          ddl: { text: typeof entry[1] === "string" ? entry[1] : "", approximate: false },
        });
      }),

    fetchRows: (query, limits) =>
      guarded(limits, (): DbResult<ResultSet> => {
        const columns = columnsOf(query.table);
        if (columns.length === 0) return err(tableNotFound(query.table));
        const missing = noSuchColumn(columns, [
          ...filterColumns(query.filters),
          ...(query.sort ? [query.sort.column] : []),
        ]);
        if (missing) return err(missing);

        // 返す行数の上限。1 行余分に読んで、まだ行があるかを調べる
        const cap = Math.min(query.limit, limits.maxRows);
        const built = buildRowsSql("sqlite", {
          query: { ...query, limit: cap + 1 },
          columns: columns.map((column) => column.name),
          maxCellChars: limits.maxCellChars,
        });
        if (hasMultipleStatements(built.text, "sqlite")) return err({ kind: "multipleStatements" });

        const opened = openStatement(db, built.text);
        const { rows, more } = readUpTo(opened, built.params, cap);
        const capped = capCells(toCells(opened, rows), limits.maxCellChars);
        return ok({
          columns: columns.map((column) => ({
            name: column.name,
            dbType: column.dbType === "" ? null : column.dbType,
          })),
          rows: capped.rows,
          truncated: more,
          truncatedCells: capped.truncatedCells,
        });
      }),

    countRows: (table, filters, rawWhere, limits) =>
      guarded(limits, () => {
        const columns = columnsOf(table);
        if (columns.length === 0) return err(tableNotFound(table));
        const missing = noSuchColumn(columns, filterColumns(filters));
        if (missing) return err(missing);

        const built = buildCountSql("sqlite", { table, filters, rawWhere });
        if (hasMultipleStatements(built.text, "sqlite")) return err({ kind: "multipleStatements" });

        const opened = openStatement(db, built.text);
        const count = cellFromSqliteValue(readUpTo(opened, built.params, 1).rows[0]?.[0], true);
        return ok({ count: count ?? "0" });
      }),

    fetchCell: (table, primaryKey, column, limits) =>
      guarded(limits, () => {
        const keys = Object.keys(primaryKey);
        if (keys.length === 0) return err(queryError("A primary key is required."));
        const columns = columnsOf(table);
        if (columns.length === 0) return err(tableNotFound(table));
        const missing = noSuchColumn(columns, [...keys, column]);
        if (missing) return err(missing);

        const built = buildFetchCellSql("sqlite", { table, primaryKey, column });
        const opened = openStatement(db, built.text);
        // 切り詰めない。1 行に決まるかを調べるため、2 行まで読む
        const { rows, more } = readUpTo(opened, built.params, 1);
        if (rows.length === 0) return err(queryError("No row matches the primary key."));
        if (more) return err(queryError("The primary key matches more than one row."));
        return ok({ value: cellFromSqliteValue(rows[0]?.[0], opened.integersAsBigInt) });
      }),

    execute: (sql, _queryId, limits) => {
      const statements = splitStatements(sql, "sqlite");
      if (statements.length > 1) return Promise.resolve(err({ kind: "multipleStatements" }));
      const statement = statements[0];
      if (statement === undefined) return Promise.resolve(err(queryError("The SQL is empty.")));

      return guarded(limits, (): DbResult<QueryOutcome> => {
        const startedAt = performance.now();
        const elapsed = () => Math.round(performance.now() - startedAt);
        const opened = openStatement(db, statement.text);

        if (opened.columns.length > 0) {
          const { rows, more } = readUpTo(opened, [], limits.maxRows);
          const capped = capCells(toCells(opened, rows), limits.maxCellChars);
          return ok({
            kind: "rows",
            columns: opened.columns,
            rows: capped.rows,
            truncated: more,
            truncatedCells: capped.truncatedCells,
            elapsedMs: elapsed(),
          });
        }

        // node:sqlite は DDL の後でも、直前の INSERT などの changes を返す。
        // 行を書き換えたかどうかは、接続全体の変更数の増え方で判断する
        const before = totalChanges();
        const { changes } = opened.run([]);
        const affectedRows = totalChanges() > before ? Number(changes) : 0;
        return ok({ kind: "command", affectedRows, elapsedMs: elapsed() });
      });
    },

    cancel: () => Promise.resolve(err({ kind: "unsupported", feature: "cancel" })),
  };
};
