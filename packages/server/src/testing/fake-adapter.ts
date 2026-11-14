import { ok, schemaName } from "@myaaaaa_chan/db-viewer-core";
import type { DbAdapter } from "../adapter";

// handler のテスト用。すべての操作が成功する既定の応答を持ち、必要なものだけ差し替える。
export const createFakeAdapter = (overrides: Partial<DbAdapter> = {}): DbAdapter => ({
  dialect: "sqlite",
  readOnly: true,
  capabilities: { cancel: false, enforcesTimeout: false },
  listSchemas: async () => ok([schemaName("main")]),
  listTables: async () => ok([]),
  getTableDetail: async (table) =>
    ok({
      summary: { ref: table, kind: "table" },
      columns: [],
      indexes: [],
      foreignKeys: [],
      ddl: { text: "", approximate: false },
    }),
  fetchRows: async () => ok({ columns: [], rows: [], truncated: false, truncatedCells: [] }),
  countRows: async () => ok({ count: "0" }),
  fetchCell: async () => ok({ value: null }),
  execute: async () => ok({ kind: "command", affectedRows: 0, elapsedMs: 0 }),
  cancel: async () => ok({ cancelled: false }),
  ...overrides,
});
