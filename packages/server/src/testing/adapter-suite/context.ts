import {
  type DbResult,
  queryId,
  type RowsQuery,
  type TableRef,
  tableName,
} from "@myaaaaa_chan/db-viewer-core";
import type { Limits } from "../../limits";
import type { AdapterEnvironment, OpenOptions } from "./harness";

/** 各テストの group に渡す共通の道具。 */
export type SuiteContext = {
  readonly open: (options?: Partial<OpenOptions>) => Promise<AdapterEnvironment>;
  readonly limits: (overrides?: Partial<Limits>) => Limits;
};

export const refOf = (env: AdapterEnvironment, name: string): TableRef => ({
  schema: env.schema,
  name: tableName(name),
});

export const rowsQuery = (
  env: AdapterEnvironment,
  table: string,
  overrides: Partial<Omit<RowsQuery, "table">> = {},
): RowsQuery => ({
  table: refOf(env, table),
  filters: [],
  rawWhere: null,
  sort: null,
  limit: 100,
  offset: 0,
  ...overrides,
});

// 失敗なら、失敗の中身を載せて落とす。テストの出力から原因が分かるようにする。
export const valueOf = <T>(result: DbResult<T>): T => {
  if (!result.ok) throw new Error(`expected ok but got ${JSON.stringify(result.error)}`);
  return result.value;
};

export const errorOf = <T>(result: DbResult<T>) => {
  if (result.ok) throw new Error(`expected an error but got ${JSON.stringify(result.value)}`);
  return result.error;
};

let sequence = 0;
export const nextQueryId = () => queryId(`suite-query-${++sequence}`);
