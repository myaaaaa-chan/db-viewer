import type {
  CellValue,
  ColumnName,
  ConnectionInfo,
  DbResult,
  Dialect,
  Filter,
  QueryId,
  QueryOutcome,
  ResultSet,
  RowsQuery,
  SchemaName,
  TableDetail,
  TableRef,
  TableSummary,
} from "@myaaaaa_chan/db-viewer-core";
import type { Limits } from "./limits";

// core の ConnectionInfo と同じもの。handler が listConnections でそのまま返す。
// enforcesTimeout が false の接続（SQLite はドライバに割り込む手段がないため false）では、重いクエリがタイムアウトせず、
// そのプロセスの処理を止め続ける
export type AdapterCapabilities = ConnectionInfo["capabilities"];

/**
 * DB の方言の違いを吸収するアダプター（03_サーバー §3）。
 * 想定内の失敗はすべて Result で返し、例外を投げない。DB のエラーは query などに変換する。
 * このインターフェースは MVP では安定した API とは保証しない。
 */
export interface DbAdapter {
  readonly dialect: Dialect;
  readonly readOnly: boolean;
  readonly capabilities: AdapterCapabilities;

  listSchemas(): Promise<DbResult<ReadonlyArray<SchemaName>>>;
  listTables(schema: SchemaName): Promise<DbResult<ReadonlyArray<TableSummary>>>;
  getTableDetail(table: TableRef): Promise<DbResult<TableDetail>>;
  /**
   * `query.limit` と `limits.maxRows` の小さいほうを返す行数の上限にする。
   * `truncated` は、その上限を超える行がまだあって返さなかった場合に true にする。
   * セルは `limits.maxCellChars` までに切り詰め、切った位置を `truncatedCells` に入れる。
   */
  fetchRows(query: RowsQuery, limits: Limits): Promise<DbResult<ResultSet>>;
  countRows(
    table: TableRef,
    filters: ReadonlyArray<Filter>,
    rawWhere: string | null,
    limits: Limits,
  ): Promise<DbResult<{ readonly count: string }>>;
  /** 切り詰めない。主キーで 1 行に決まらない（0 行・2 行以上・主キーが空）場合は query エラーにする。 */
  fetchCell(
    table: TableRef,
    primaryKey: Readonly<Record<string, string>>,
    column: ColumnName,
    limits: Limits,
  ): Promise<DbResult<{ readonly value: CellValue }>>;
  execute(sql: string, queryId: QueryId, limits: Limits): Promise<DbResult<QueryOutcome>>;
  cancel(queryId: QueryId): Promise<DbResult<{ readonly cancelled: boolean }>>;
}
