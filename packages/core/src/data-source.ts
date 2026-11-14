import type {
  CellValue,
  ConnectionInfo,
  QueryOutcome,
  ResultSet,
  TableDetail,
  TableSummary,
} from "./domain";
import type { DbViewerError } from "./error";
import type { ColumnName, ConnectionName, QueryId, SchemaName, TableRef } from "./names";
import type { Filter, RowsQuery } from "./query";
import type { Result } from "./result";

export type DbResult<T> = Result<T, DbViewerError>;

// UI が依存するのはこのインターフェースだけ。想定内の失敗はすべて Result で返し、例外を投げない。
export interface DataSource {
  listConnections(): Promise<DbResult<ReadonlyArray<ConnectionInfo>>>;
  listSchemas(connection: ConnectionName): Promise<DbResult<ReadonlyArray<SchemaName>>>;
  listTables(
    connection: ConnectionName,
    schema: SchemaName,
  ): Promise<DbResult<ReadonlyArray<TableSummary>>>;
  getTableDetail(connection: ConnectionName, table: TableRef): Promise<DbResult<TableDetail>>;
  fetchRows(connection: ConnectionName, query: RowsQuery): Promise<DbResult<ResultSet>>;
  countRows(
    connection: ConnectionName,
    table: TableRef,
    filters: ReadonlyArray<Filter>,
    rawWhere: string | null,
  ): Promise<DbResult<{ readonly count: string }>>;
  fetchCell(
    connection: ConnectionName,
    table: TableRef,
    primaryKey: Readonly<Record<string, string>>,
    column: ColumnName,
  ): Promise<DbResult<{ readonly value: CellValue }>>;
  executeQuery(
    connection: ConnectionName,
    sql: string,
    queryId: QueryId,
  ): Promise<DbResult<QueryOutcome>>;
  cancelQuery(
    connection: ConnectionName,
    queryId: QueryId,
  ): Promise<DbResult<{ readonly cancelled: boolean }>>;
}
