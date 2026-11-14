import {
  columnName,
  type DbResult,
  type DbViewerError,
  err,
  hasMultipleStatements,
  ok,
  type QueryOutcome,
  type ResultSet,
  type SchemaName,
  schemaName,
  splitStatements,
  type TableRef,
  type TableSummary,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import type { Pool, PoolClient } from "pg";
import type { DbAdapter } from "../../adapter";
import { capCells } from "../../cells";
import { DEFAULT_LIMITS, type Limits } from "../../limits";
import { buildCountSql, buildFetchCellSql, buildRowsSql } from "../../sql/build";
import { createConcurrencyGate, runGated } from "../concurrency-gate";
import { cancelBackend } from "./cancel";
import {
  buildDdl,
  CATALOG_SQL,
  type ColumnRow,
  columnRowFromRow,
  foreignKeysFromRows,
  indexesFromRows,
  kindOfRelation,
  toColumnInfo,
} from "./catalog";
import { loadCursor } from "./driver";
import { type ErrorContext, type SentSql, toDbError } from "./errors";
import { createInFlightRegistry, type InFlightRequest } from "./in-flight";
import { inTransaction, type Session } from "./session";
import { queryRows, readStatement, type StatementResult } from "./statement";
import { createTypeNameCache, type TypeField } from "./type-names";

/**
 * postgresAdapter が受け取る Pool の、型として要る分だけ。pg.Pool がそのまま渡せる。
 * 公開する型に "pg" を出さないための型。pg と @types/pg を入れない SQLite だけの利用者が、
 * skipLibCheck: false の型検査で落ちないようにする。
 */
export type PostgresPool = {
  readonly connect: () => Promise<{ readonly release: (destroy?: boolean) => void }>;
  readonly options: object;
};

export type PostgresAdapterOptions = {
  // 初期値 true。BEGIN READ ONLY で書き込みを止める。
  readonly readOnly?: boolean;
  // 例: "Asia/Tokyo"。指定したときだけ、実行のたびに SET LOCAL TimeZone を発行する
  readonly timeZone?: string;
};

type Relation = { readonly oid: string; readonly relkind: string };

const queryError = (message: string): DbViewerError => ({
  kind: "query",
  message,
  sqlState: null,
  position: null,
});

const tableNotFound = (table: TableRef): DbViewerError => ({ kind: "tableNotFound", table });

// 設計上の値（未計測）。メタデータには limits が渡されないので、既定のタイムアウトと同じにする
const CATALOG_TIMEOUT_MS = DEFAULT_LIMITS.statementTimeoutMs;
// 中断の依頼を DB に届ける接続が使えないときに、待つのをやめる時間。設計上の値（未計測）
const CANCEL_DELIVERY_TIMEOUT_MS = 5_000;

// テストで短くするための値。公開しない（index.ts から出さない）
export type PostgresAdapterInternals = {
  readonly catalogTimeoutMs: number;
  readonly cancelDeliveryTimeoutMs: number;
};

const DEFAULT_INTERNALS: PostgresAdapterInternals = {
  catalogTimeoutMs: CATALOG_TIMEOUT_MS,
  cancelDeliveryTimeoutMs: CANCEL_DELIVERY_TIMEOUT_MS,
};

const relationOf = async (client: PoolClient, table: TableRef): Promise<Relation | null> => {
  const { rows } = await queryRows(client, CATALOG_SQL.relation, [table.schema, table.name]);
  const row = rows[0];
  return row ? { oid: row[0] ?? "", relkind: row[1] ?? "" } : null;
};

const columnsOf = async (
  client: PoolClient,
  relation: Relation,
): Promise<ReadonlyArray<ColumnRow>> =>
  (await queryRows(client, CATALOG_SQL.columns, [relation.oid])).rows.map(columnRowFromRow);

// format_type に渡して、結果の列の型名にする
const lookupTypeNames = async (
  client: PoolClient,
  missing: ReadonlyArray<TypeField>,
): Promise<ReadonlyArray<string | null>> => {
  const { rows } = await queryRows(client, CATALOG_SQL.typeNames, [
    missing.map((field) => field.dataTypeID),
    missing.map((field) => field.dataTypeModifier),
  ]);
  return rows.map((row) => row[0] ?? null);
};

export const createPostgresAdapter = (
  pool: Pool,
  options: PostgresAdapterOptions,
  internals: PostgresAdapterInternals,
): DbAdapter => {
  const readOnly = options.readOnly ?? true;
  const timeZone = options.timeZone;
  const gate = createConcurrencyGate();
  const typeNames = createTypeNameCache();
  const inFlight = createInFlightRegistry((pid) => cancelBackend(pool, pid), {
    deliveryTimeoutMs: internals.cancelDeliveryTimeoutMs,
  });
  // タイムアウトの対象にならない処理（中断の依頼）で、エラーを変換するときの文脈
  const noStatement: ErrorContext = {
    timeoutMs: internals.catalogTimeoutMs,
    cancelRequested: false,
    sent: null,
  };

  const timeoutContext = (limits: Limits): ErrorContext => ({
    timeoutMs: limits.statementTimeoutMs,
    cancelRequested: false,
    sent: null,
  });

  // 同時実行数の上限と、トランザクション（読み取り専用・タイムアウト・タイムゾーン）をかける。
  const guarded = <T>(
    limits: Limits,
    work: (session: Session) => Promise<DbResult<T>>,
  ): Promise<DbResult<T>> =>
    runGated(gate, limits, () =>
      inTransaction(
        pool,
        { readOnly, statementTimeoutMs: limits.statementTimeoutMs, timeZone },
        timeoutContext(limits),
        work,
      ),
    );

  // カタログの読み取りは、トランザクションの外に出さない。固定の問い合わせでも、他のセッションが表を
  // ロックしていると（実行中の ALTER TABLE など）止まり、Pool を使い切るので、タイムアウトをかける。
  // 同時実行数の上限（busy）はかけない。ツリーを開くたびに busy になるのを避けるため。
  const catalog = <T>(work: (client: PoolClient) => Promise<DbResult<T>>): Promise<DbResult<T>> =>
    inTransaction(
      pool,
      { readOnly: true, statementTimeoutMs: internals.catalogTimeoutMs, timeZone: undefined },
      { timeoutMs: internals.catalogTimeoutMs, cancelRequested: false, sent: null },
      ({ client }) => work(client),
    );

  const runUserStatement = async (
    { client, pid, discard }: Session,
    statement: { readonly text: string; readonly from: number },
    request: InFlightRequest,
    limits: Limits,
  ): Promise<DbResult<QueryOutcome>> => {
    const Cursor = await loadCursor();
    const sent: SentSql = { text: statement.text, offset: statement.from };
    const errorContext = (): ErrorContext => ({
      timeoutMs: limits.statementTimeoutMs,
      cancelRequested: request.cancelRequested(),
      sent,
    });

    // 中断の依頼が時間内に届かなかった接続は、後から届いて次のクエリを止めないよう、Pool に戻さない
    const finish = async () => {
      if ((await request.finishStatement()) === "abandoned") discard();
    };

    // 準備の間に中断が来ていたら、文は送らない
    if (request.startStatement(pid) === "cancelled") {
      await finish();
      return err({ kind: "cancelled" });
    }
    const startedAt = performance.now();
    let result: StatementResult;
    try {
      result = await readStatement(client, Cursor, statement.text, limits.maxRows);
    } catch (cause) {
      // 中断の依頼が DB に届き終わるまで待ってから、エラーの種類を決める
      await finish();
      return err(toDbError(cause, errorContext()));
    }
    await finish();
    const elapsedMs = Math.round(performance.now() - startedAt);

    if (result.fields.length === 0) {
      return ok({ kind: "command", affectedRows: result.rowCount, elapsedMs });
    }
    const names = await typeNames.resolve(result.fields, (missing) =>
      lookupTypeNames(client, missing),
    );
    const capped = capCells(result.rows.slice(0, limits.maxRows), limits.maxCellChars);
    return ok({
      kind: "rows",
      columns: result.fields.map((field, index) => ({
        name: field.name,
        dbType: names[index] ?? null,
      })),
      rows: capped.rows,
      truncated: result.rows.length > limits.maxRows,
      truncatedCells: capped.truncatedCells,
      elapsedMs,
    });
  };

  return {
    dialect: "postgres",
    readOnly,
    capabilities: { cancel: true, enforcesTimeout: true },

    listSchemas: () =>
      catalog(async (client) => {
        const { rows } = await queryRows(client, CATALOG_SQL.listSchemas);
        return ok(rows.map((row) => schemaName(row[0] ?? "")));
      }),

    listTables: (schema: SchemaName) =>
      catalog(async (client) => {
        const { rows } = await queryRows(client, CATALOG_SQL.listTables, [schema]);
        const tables: ReadonlyArray<TableSummary> = rows.map((row) => ({
          ref: { schema, name: tableName(row[0] ?? "") },
          kind: kindOfRelation(row[1] ?? ""),
        }));
        return ok(tables);
      }),

    getTableDetail: (table) =>
      catalog(async (client) => {
        const relation = await relationOf(client, table);
        if (relation === null) return err(tableNotFound(table));
        const query = async (sql: string) => (await queryRows(client, sql, [relation.oid])).rows;

        const columns = await columnsOf(client, relation);
        const indexes = indexesFromRows(await query(CATALOG_SQL.indexes));
        const foreignKeys = foreignKeysFromRows(await query(CATALOG_SQL.foreignKeys));
        const kind = kindOfRelation(relation.relkind);
        const constraints = (await query(CATALOG_SQL.constraintDefinitions)).map((row) => ({
          name: row[0] ?? "",
          definition: row[1] ?? "",
        }));
        const indexDefinitions = (await query(CATALOG_SQL.standaloneIndexDefinitions)).map(
          (row) => row[0] ?? "",
        );
        const viewDefinition =
          kind === "view" ? ((await query(CATALOG_SQL.viewDefinition))[0]?.[0] ?? "") : null;

        return ok({
          summary: { ref: table, kind },
          columns: columns.map(toColumnInfo),
          indexes,
          foreignKeys,
          ddl: {
            text: buildDdl({
              ref: table,
              relkind: relation.relkind,
              columns,
              constraints,
              indexDefinitions,
              viewDefinition,
            }),
            approximate: true,
          },
        });
      }),

    fetchRows: (query, limits) =>
      guarded(limits, async ({ client }): Promise<DbResult<ResultSet>> => {
        const relation = await relationOf(client, query.table);
        if (relation === null) return err(tableNotFound(query.table));
        const columns = await columnsOf(client, relation);

        // 返す行数の上限。1 行余分に読んで、まだ行があるかを調べる
        const cap = Math.min(query.limit, limits.maxRows);
        const built = buildRowsSql("postgres", {
          query: { ...query, limit: cap + 1 },
          columns: columns.map((column) => columnName(column.name)),
          maxCellChars: limits.maxCellChars,
        });
        if (hasMultipleStatements(built.text, "postgres"))
          return err({ kind: "multipleStatements" });

        const { rows } = await queryRows(client, built.text, built.params);
        const capped = capCells(rows.slice(0, cap), limits.maxCellChars);
        return ok({
          columns: columns.map(({ name, dbType }) => ({ name, dbType })),
          rows: capped.rows,
          truncated: rows.length > cap,
          truncatedCells: capped.truncatedCells,
        });
      }),

    countRows: (table, filters, rawWhere, limits) =>
      guarded(limits, async ({ client }) => {
        if ((await relationOf(client, table)) === null) return err(tableNotFound(table));
        const built = buildCountSql("postgres", { table, filters, rawWhere });
        if (hasMultipleStatements(built.text, "postgres"))
          return err({ kind: "multipleStatements" });
        const { rows } = await queryRows(client, built.text, built.params);
        return ok({ count: rows[0]?.[0] ?? "0" });
      }),

    fetchCell: (table, primaryKey, column, limits) =>
      guarded(limits, async ({ client }) => {
        if (Object.keys(primaryKey).length === 0)
          return err(queryError("A primary key is required."));
        if ((await relationOf(client, table)) === null) return err(tableNotFound(table));
        const built = buildFetchCellSql("postgres", { table, primaryKey, column });
        // 切り詰めない。1 行に決まるかを調べるため、2 行まで読む（SQL が LIMIT 2）
        const { rows } = await queryRows(client, built.text, built.params);
        if (rows.length === 0) return err(queryError("No row matches the primary key."));
        if (rows.length > 1) return err(queryError("The primary key matches more than one row."));
        return ok({ value: rows[0]?.[0] ?? null });
      }),

    execute: (sql, queryId, limits) => {
      const statements = splitStatements(sql, "postgres");
      if (statements.length > 1) return Promise.resolve(err({ kind: "multipleStatements" }));
      const statement = statements[0];
      if (statement === undefined) return Promise.resolve(err(queryError("The SQL is empty.")));

      return runGated(gate, limits, async () => {
        const request = inFlight.begin(queryId);
        if (request === null) return err(queryError("This queryId is already running."));
        try {
          return await inTransaction(
            pool,
            { readOnly, statementTimeoutMs: limits.statementTimeoutMs, timeZone },
            timeoutContext(limits),
            (session) => runUserStatement(session, statement, request, limits),
            {
              // 接続待ちの間に中断が来たら、待つのをやめる
              abortConnect: request.whenCancelRequested.then(
                (): DbViewerError => ({
                  kind: "cancelled",
                }),
              ),
            },
          );
        } finally {
          request.end();
        }
      });
    },

    cancel: async (queryId) => {
      try {
        return ok({ cancelled: await inFlight.cancel(queryId) });
      } catch (cause) {
        return err(toDbError(cause, noStatement));
      }
    },
  };
};

/**
 * PostgreSQL のアダプター（03_サーバー §4）。pg の Pool を受け取る。
 *
 * - 1 回の依頼 = 1 つのトランザクション。利用者の SQL は 1 文だけを extended protocol で流す
 * - 型の変換は問い合わせごとに文字列のままにする。pg.types のグローバルな設定は変えない
 * - 中断は Pool を通さない一時的な接続で pg_cancel_backend を呼ぶ。Pool を使い切っていても届く。
 *   文を流している間だけ受け付け、終わった後の接続は止めない
 * - 行数の上限は pg-cursor で maxRows + 1 行だけ読む
 */
export const postgresAdapter = (
  pool: PostgresPool,
  options: PostgresAdapterOptions = {},
): DbAdapter =>
  // 公開する型は構造的な最小限（PostgresPool）にし、中では pg.Pool として扱う。
  // pg.Pool 以外を渡したときは、最初の問い合わせで失敗する
  createPostgresAdapter(pool as Pool, options, DEFAULT_INTERNALS);
