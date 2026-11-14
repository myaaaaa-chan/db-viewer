import type { DataSource, DbResult } from "../data-source";
import type {
  CellValue,
  ColumnInfo,
  ConnectionInfo,
  Dialect,
  ForeignKeyInfo,
  IndexInfo,
  QueryOutcome,
  ResultSet,
  TableDetail,
  TableKind,
} from "../domain";
import type { DbViewerError } from "../error";
import {
  type ColumnName,
  type ConnectionName,
  columnName,
  connectionName,
  type SchemaName,
  schemaName,
  type TableName,
  type TableRef,
  tableName,
} from "../names";
import type { Filter } from "../query";
import { andThen, err, ok, tryAsync } from "../result";
import { hasMultipleStatements } from "../statements";

// テスト用に、DB を使わず決まった値を返す DataSource。React のテストとサンプルで使う。
// 並べ替えとフィルタは「数値に読める文字列は数値、それ以外は文字列」として比べる近似で、
// 実際の DB の照合順序とは一致しない。SQL は解釈せず、executeQuery は execute に委ねる。

export type MemoryColumnSpec = {
  readonly name: string;
  readonly dbType: string;
  // 省略すると、主キーでなければ true
  readonly nullable?: boolean;
  readonly defaultValue?: string | null;
  readonly primaryKeyPosition?: number | null;
};

export type MemoryTableSpec = {
  readonly name: string;
  readonly kind?: TableKind;
  readonly columns: ReadonlyArray<MemoryColumnSpec>;
  // 列は columns の順
  readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
  // 省略すると、主キーがあれば主キーのインデックスを 1 つ作る
  readonly indexes?: ReadonlyArray<IndexInfo>;
  readonly foreignKeys?: ReadonlyArray<ForeignKeyInfo>;
  readonly ddl?: string;
};

export type MemoryTable = {
  readonly name: TableName;
  readonly kind: TableKind;
  readonly columns: ReadonlyArray<ColumnInfo>;
  readonly indexes: ReadonlyArray<IndexInfo>;
  readonly foreignKeys: ReadonlyArray<ForeignKeyInfo>;
  readonly ddl: string | null;
  readonly rows: ReadonlyArray<ReadonlyArray<CellValue>>;
};

export type MemoryConnectionSpec = {
  readonly name: string;
  readonly dialect: Dialect;
  // 省略すると true
  readonly readOnly?: boolean;
  // 省略すると false
  readonly cancel?: boolean;
  readonly schemas: ReadonlyArray<{
    readonly name: string;
    readonly tables: ReadonlyArray<MemoryTable>;
  }>;
};

export type MemoryExecute = (
  connection: ConnectionInfo,
  sql: string,
) => DbResult<QueryOutcome> | Promise<DbResult<QueryOutcome>>;

export type MemoryDataSourceOptions = {
  readonly connections: ReadonlyArray<MemoryConnectionSpec>;
  readonly execute?: MemoryExecute;
  // 既定値は設計上の値（サーバーの既定と同じ）
  readonly maxRows?: number;
  readonly maxCellChars?: number;
};

const DEFAULT_MAX_ROWS = 1000;
const DEFAULT_MAX_CELL_CHARS = 10_000;

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export const memoryTable = (spec: MemoryTableSpec): MemoryTable => {
  const columns: ReadonlyArray<ColumnInfo> = spec.columns.map((c) => ({
    name: columnName(c.name),
    dbType: c.dbType,
    nullable: c.nullable ?? (c.primaryKeyPosition ?? null) === null,
    defaultValue: c.defaultValue ?? null,
    primaryKeyPosition: c.primaryKeyPosition ?? null,
  }));
  const primaryKey = primaryKeyColumns(columns);
  return {
    name: tableName(spec.name),
    kind: spec.kind ?? "table",
    columns,
    indexes:
      spec.indexes ??
      (primaryKey.length === 0
        ? []
        : [{ name: `${spec.name}_pkey`, columns: primaryKey, unique: true, primary: true }]),
    foreignKeys: spec.foreignKeys ?? [],
    ddl: spec.ddl ?? null,
    rows: spec.rows,
  };
};

const primaryKeyColumns = (columns: ReadonlyArray<ColumnInfo>): ReadonlyArray<ColumnName> =>
  columns
    .filter((c) => c.primaryKeyPosition !== null)
    .sort((a, b) => (a.primaryKeyPosition ?? 0) - (b.primaryKeyPosition ?? 0))
    .map((c) => c.name);

const buildDdl = (schema: SchemaName, table: MemoryTable): string => {
  const target = `${quoteIdent(schema)}.${quoteIdent(table.name)}`;
  if (table.kind === "view") {
    return `CREATE VIEW ${target} AS SELECT ${table.columns.map((c) => quoteIdent(c.name)).join(", ")} FROM ...;`;
  }
  const lines = table.columns.map(
    (c) => `  ${quoteIdent(c.name)} ${c.dbType}${c.nullable ? "" : " NOT NULL"}`,
  );
  const primaryKey = primaryKeyColumns(table.columns);
  if (primaryKey.length > 0) {
    lines.push(`  PRIMARY KEY (${primaryKey.map(quoteIdent).join(", ")})`);
  }
  return `CREATE TABLE ${target} (\n${lines.join(",\n")}\n);`;
};

const toDetail = (schema: SchemaName, table: MemoryTable): TableDetail => ({
  summary: { ref: { schema, name: table.name }, kind: table.kind },
  columns: table.columns,
  indexes: table.indexes,
  foreignKeys: table.foreignKeys,
  ddl: { text: table.ddl ?? buildDdl(schema, table), approximate: false },
});

const queryError = (message: string): DbViewerError => ({
  kind: "query",
  message,
  sqlState: null,
  position: null,
});

// 数値に読める文字列どうしは数値として、それ以外は UTF-16 の順で比べる。
const NUMERIC = /^-?\d+(\.\d+)?$/;
const compareValues = (a: string, b: string): number => {
  if (NUMERIC.test(a) && NUMERIC.test(b)) return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
};

// PostgreSQL と同じく、\ が直後の 1 文字をエスケープし、大文字小文字を区別する。
const likeToRegExp = (pattern: string): RegExp => {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i);
    if (ch === "\\" && i + 1 < pattern.length) {
      i++;
      source += pattern.charAt(i).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") {
      source += ".*";
    } else if (ch === "_") {
      source += ".";
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "s");
};

const matches = (cell: CellValue, filter: Filter): boolean => {
  if (filter.op === "isNull") return cell === null;
  // SQL では NULL との比較は真にならない
  if (cell === null) return false;
  switch (filter.op) {
    case "eq":
      return compareValues(cell, filter.value) === 0;
    case "neq":
      return compareValues(cell, filter.value) !== 0;
    case "lt":
      return compareValues(cell, filter.value) < 0;
    case "gt":
      return compareValues(cell, filter.value) > 0;
    case "like":
      return likeToRegExp(filter.value).test(cell);
  }
};

const columnIndex = (table: MemoryTable, name: string): DbResult<number> => {
  const index = table.columns.findIndex((c) => c.name === name);
  return index < 0 ? err(queryError(`column "${name}" does not exist`)) : ok(index);
};

type Rows = ReadonlyArray<ReadonlyArray<CellValue>>;

const filterRows = (
  table: MemoryTable,
  filters: ReadonlyArray<Filter>,
  rawWhere: string | null,
): DbResult<Rows> => {
  if (rawWhere !== null && rawWhere.trim() !== "") {
    return err(queryError("rawWhere is not supported by the in-memory DataSource"));
  }
  const resolved: Array<{ readonly index: number; readonly filter: Filter }> = [];
  for (const filter of filters) {
    const index = columnIndex(table, filter.column);
    if (!index.ok) return index;
    resolved.push({ index: index.value, filter });
  }
  return ok(
    table.rows.filter((row) =>
      resolved.every(({ index, filter }) => matches(row[index] ?? null, filter)),
    ),
  );
};

// NULL は最も大きい値として扱う（PostgreSQL の既定と同じ。昇順では最後、降順では最初）。
const sortRows = (
  table: MemoryTable,
  rows: Rows,
  sort: { readonly column: string; readonly direction: "asc" | "desc" } | null,
): DbResult<Rows> => {
  if (sort === null) return ok(rows);
  const index = columnIndex(table, sort.column);
  if (!index.ok) return index;
  const compare = (a: CellValue, b: CellValue): number => {
    if (a === null) return b === null ? 0 : 1;
    if (b === null) return -1;
    return compareValues(a, b);
  };
  const sign = sort.direction === "asc" ? 1 : -1;
  return ok(
    [...rows].sort((x, y) => sign * compare(x[index.value] ?? null, y[index.value] ?? null)),
  );
};

const truncateCell = (value: string, maxCellChars: number): string | null => {
  if (value.length <= maxCellChars) return null;
  const chars = Array.from(value);
  return chars.length <= maxCellChars ? null : chars.slice(0, maxCellChars).join("");
};

const toResultSet = (
  table: MemoryTable,
  requested: Rows,
  maxRows: number,
  maxCellChars: number,
): ResultSet => {
  const truncatedCells: Array<readonly [row: number, column: number]> = [];
  const rows = requested.slice(0, maxRows).map((row, rowIndex) =>
    row.map((cell, column) => {
      const cut = cell === null ? null : truncateCell(cell, maxCellChars);
      if (cut === null) return cell;
      truncatedCells.push([rowIndex, column]);
      return cut;
    }),
  );
  return {
    columns: table.columns.map((c) => ({ name: c.name, dbType: c.dbType })),
    rows,
    truncated: requested.length > maxRows,
    truncatedCells,
  };
};

type Connection = {
  readonly info: ConnectionInfo;
  readonly schemas: ReadonlyMap<string, ReadonlyArray<MemoryTable>>;
  readonly schemaNames: ReadonlyArray<SchemaName>;
};

const toConnection = (spec: MemoryConnectionSpec): Connection => ({
  info: {
    name: connectionName(spec.name),
    dialect: spec.dialect,
    readOnly: spec.readOnly ?? true,
    capabilities: { cancel: spec.cancel ?? false },
  },
  schemas: new Map(spec.schemas.map((s) => [s.name, s.tables])),
  schemaNames: spec.schemas.map((s) => schemaName(s.name)),
});

export const createMemoryDataSource = (options: MemoryDataSourceOptions): DataSource => {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxCellChars = options.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;
  const connections = new Map(options.connections.map((spec) => [spec.name, toConnection(spec)]));

  const findConnection = (name: ConnectionName): DbResult<Connection> => {
    const connection = connections.get(name);
    return connection ? ok(connection) : err({ kind: "connectionNotFound", connection: name });
  };

  const findTable = (connection: Connection, ref: TableRef): DbResult<MemoryTable> => {
    const table = connection.schemas.get(ref.schema)?.find((t) => t.name === ref.name);
    return table ? ok(table) : err({ kind: "tableNotFound", table: ref });
  };

  const withTable = <T>(
    name: ConnectionName,
    ref: TableRef,
    use: (table: MemoryTable) => DbResult<T>,
  ): Promise<DbResult<T>> =>
    Promise.resolve(
      andThen(
        andThen(findConnection(name), (connection) => findTable(connection, ref)),
        use,
      ),
    );

  return {
    listConnections: async () => ok([...connections.values()].map((c) => c.info)),

    listSchemas: async (name) => andThen(findConnection(name), (c) => ok(c.schemaNames)),

    listTables: async (name, schema) =>
      andThen(findConnection(name), (c) =>
        ok(
          (c.schemas.get(schema) ?? []).map((t) => ({
            ref: { schema, name: t.name },
            kind: t.kind,
          })),
        ),
      ),

    getTableDetail: (name, ref) => withTable(name, ref, (table) => ok(toDetail(ref.schema, table))),

    fetchRows: (name, query) =>
      withTable(name, query.table, (table) =>
        andThen(filterRows(table, query.filters, query.rawWhere), (filtered) =>
          andThen(sortRows(table, filtered, query.sort), (sorted) =>
            ok(
              toResultSet(
                table,
                sorted.slice(query.offset, query.offset + query.limit),
                maxRows,
                maxCellChars,
              ),
            ),
          ),
        ),
      ),

    countRows: (name, ref, filters, rawWhere) =>
      withTable(name, ref, (table) =>
        andThen(filterRows(table, filters, rawWhere), (rows) => ok({ count: String(rows.length) })),
      ),

    fetchCell: (name, ref, primaryKey, column) =>
      withTable(name, ref, (table) => {
        const keyColumns = primaryKeyColumns(table.columns);
        const given = Object.keys(primaryKey).sort();
        if (keyColumns.length === 0) return err(queryError("table has no primary key"));
        if (given.join("\u0000") !== [...keyColumns].sort().join("\u0000")) {
          return err(queryError(`primaryKey must contain exactly: ${keyColumns.join(", ")}`));
        }
        const target = columnIndex(table, column);
        if (!target.ok) return target;
        const keyIndexes = keyColumns.map((k) => table.columns.findIndex((c) => c.name === k));
        const found = table.rows.filter((row) =>
          keyColumns.every((k, i) => row[keyIndexes[i] ?? -1] === primaryKey[k]),
        );
        if (found.length !== 1) {
          return err(queryError(`primary key matched ${found.length} rows, expected exactly 1`));
        }
        return ok({ value: found[0]?.[target.value] ?? null });
      }),

    executeQuery: async (name, sql) => {
      const connection = findConnection(name);
      if (!connection.ok) return connection;
      const { info } = connection.value;
      if (hasMultipleStatements(sql, info.dialect)) return err({ kind: "multipleStatements" });
      const execute = options.execute;
      if (!execute) {
        return err(queryError("executeQuery is not configured for this in-memory DataSource"));
      }
      const executed = await tryAsync(
        async () => execute(info, sql),
        (cause): DbViewerError => ({
          kind: "internal",
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
      return executed.ok ? executed.value : executed;
    },

    cancelQuery: async (name) =>
      andThen(findConnection(name), (c) =>
        c.info.capabilities.cancel
          ? ok({ cancelled: false })
          : err({ kind: "unsupported", feature: "cancel" }),
      ),
  };
};
