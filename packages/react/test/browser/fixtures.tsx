import { type DataSource, err, ok, type QueryOutcome } from "@myaaaaa_chan/db-viewer-core";
import {
  createMemoryDataSource,
  type MemoryConnectionSpec,
  type MemoryExecute,
  memoryTable,
} from "@myaaaaa_chan/db-viewer-core/testing";
import { DbViewer } from "../../src/index";

// 切り詰めの上限を小さくしてあるので、20 文字を超えるセルは切り詰められる
export const MAX_CELL_CHARS = 20;
export const LONG_VALUE = "0123456789".repeat(5);

export const usersTable = memoryTable({
  name: "users",
  columns: [
    { name: "id", dbType: "int8", primaryKeyPosition: 1 },
    { name: "email", dbType: "text", nullable: false },
    { name: "role", dbType: "text" },
    { name: "bio", dbType: "text" },
  ],
  rows: Array.from({ length: 120 }, (_, index) => {
    const id = index + 1;
    return [
      String(id),
      `user${id}@example.com`,
      id % 10 === 0 ? "admin" : "member",
      id === 3 ? LONG_VALUE : id === 4 ? "" : null,
    ];
  }),
  ddl: "CREATE TABLE users (...);",
});

export const logsTable = memoryTable({
  name: "logs",
  columns: [
    { name: "at", dbType: "text" },
    { name: "message", dbType: "text" },
  ],
  rows: [["2026-11-14", LONG_VALUE]],
});

export const sessionsView = memoryTable({
  name: "active_sessions",
  kind: "view",
  columns: [{ name: "id", dbType: "int8" }],
  rows: [["1"]],
});

export const execute: MemoryExecute = (_connection, sql) => {
  if (/bad/i.test(sql)) {
    return err({
      kind: "query",
      message: 'column "bad" does not exist',
      sqlState: "42703",
      position: sql.toLowerCase().indexOf("bad"),
    });
  }
  if (/^\s*delete/i.test(sql))
    return ok<QueryOutcome>({ kind: "command", affectedRows: 3, elapsedMs: 4 });
  return ok<QueryOutcome>({
    kind: "rows",
    columns: [{ name: "answer", dbType: "int4" }],
    rows: [[sql.includes("SELECT 2") ? "2" : "1"]],
    truncated: false,
    truncatedCells: [],
    elapsedMs: 5,
  });
};

export const connection = (
  name: string,
  overrides: Partial<MemoryConnectionSpec> = {},
): MemoryConnectionSpec => ({
  name,
  dialect: "postgres",
  readOnly: true,
  cancel: false,
  schemas: [
    { name: "public", tables: [usersTable, logsTable, sessionsView] },
    {
      name: "audit",
      tables: [
        memoryTable({ name: "events", columns: [{ name: "id", dbType: "int8" }], rows: [] }),
      ],
    },
  ],
  ...overrides,
});

export const createDataSource = (
  connections: ReadonlyArray<MemoryConnectionSpec> = [connection("main")],
) => createMemoryDataSource({ connections, execute, maxCellChars: MAX_CELL_CHARS });

export function Viewer(props: { readonly dataSource: DataSource; readonly language?: string }) {
  return (
    <div style={{ width: 1200, height: 700 }}>
      <DbViewer dataSource={props.dataSource} language={props.language ?? "en"} />
    </div>
  );
}
