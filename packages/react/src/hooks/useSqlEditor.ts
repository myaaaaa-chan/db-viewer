import type { EditorView } from "@codemirror/view";
import { type ConnectionInfo, generateQueryId, type TableRef } from "@myaaaaa_chan/db-viewer-core";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useDbViewer } from "../context";
import { useT } from "../i18n/useT";
import { errorSpan, lineColumn } from "../lib/error-position";
import { resolveRunTarget } from "../lib/run-target";
import { buildSqlSchema, columnCacheKey, referencedTables } from "../lib/sql-schema";
import { flashRun, setEditorError } from "../sql/diagnostics";
import { shownValue } from "../state/remote";
import { absoluteErrorPosition, initialSqlRunState, sqlRunReducer } from "../state/sql-run";
import { defaultSchema as pickDefaultSchema } from "../state/tree";
import { useCodeMirror } from "./useCodeMirror";
import { useErrorString } from "./useErrorString";
import { useNow } from "./useNow";

const FLASH_MS = 800;
const SCHEMA_DEBOUNCE_MS = 250;

// SQL エディタの実行・停止・結果・エラーの下線を受け持つ。
// 補完のために、読み込み済みのテーブル名と、SQL に書かれたテーブルのカラム名（getTableDetail）を集める。
export const useSqlEditor = (
  containerRef: RefObject<HTMLDivElement | null>,
  connection: ConnectionInfo | null,
) => {
  const { t } = useT();
  const errorString = useErrorString();
  const { dataSource, state: viewer } = useDbViewer();
  const viewRef = useRef<EditorView | null>(null);
  const [run, dispatch] = useReducer(sqlRunReducer, initialSqlRunState);
  const latestRun = useRef(run);
  useEffect(() => {
    latestRun.current = run;
  });

  // ---- 補完のスキーマ ----
  const loadedTables = useMemo(
    () =>
      Object.values(viewer.tables).flatMap((remote) =>
        (shownValue(remote) ?? []).map((summary) => summary.ref),
      ),
    [viewer.tables],
  );
  const [columns, setColumns] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({});
  const requested = useRef(new Set<string>());
  const connectionName = connection?.name ?? null;

  useEffect(() => {
    if (connectionName === null) return;
    requested.current = new Set();
    setColumns({});
  }, [connectionName]);

  const loadColumns = useCallback(
    (refs: ReadonlyArray<TableRef>) => {
      if (connectionName === null) return;
      for (const ref of refs) {
        const key = columnCacheKey(ref);
        if (requested.current.has(key)) continue;
        requested.current.add(key);
        void dataSource.getTableDetail(connectionName, ref).then((result) => {
          if (!result.ok) {
            requested.current.delete(key);
            return;
          }
          setColumns((previous) => ({
            ...previous,
            [key]: result.value.columns.map((c) => c.name),
          }));
        });
      }
    },
    [dataSource, connectionName],
  );

  const loadedTablesRef = useRef(loadedTables);
  useEffect(() => {
    loadedTablesRef.current = loadedTables;
  });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
    },
    [],
  );

  const onDocChange = useCallback(
    (text: string) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(
        () => loadColumns(referencedTables(text, loadedTablesRef.current)),
        SCHEMA_DEBOUNCE_MS,
      );
    },
    [loadColumns],
  );

  const schema = useMemo(() => buildSqlSchema(loadedTables, columns), [loadedTables, columns]);
  const schemaDefault = useMemo(() => {
    return viewer.schemas.status === "ready" ? pickDefaultSchema(viewer.schemas.value) : null;
  }, [viewer.schemas]);

  // ---- 実行と停止 ----
  const runStatement = useCallback(() => {
    const view = viewRef.current;
    if (!view || !connection || latestRun.current.status === "running") return;
    const text = view.state.doc.toString();
    const { anchor, head } = view.state.selection.main;
    const target = resolveRunTarget({
      text,
      selection: { anchor, head },
      dialect: connection.dialect,
    });
    if (!target) {
      dispatch({ type: "noStatementFound" });
      return;
    }
    const queryId = generateQueryId();
    const origin = lineColumn(text, target.from);
    dispatch({
      type: "runStarted",
      queryId,
      startedAt: Date.now(),
      target: { ...target, line: origin.line, column: origin.column },
    });
    view.dispatch({
      effects: [flashRun.of({ from: target.from, to: target.to }), setEditorError.of(null)],
    });
    setTimeout(() => viewRef.current?.dispatch({ effects: flashRun.of(null) }), FLASH_MS);
    void dataSource
      .executeQuery(connection.name, target.text, queryId)
      .then((result) => dispatch({ type: "runFinished", queryId, finishedAt: Date.now(), result }));
  }, [dataSource, connection]);

  const stop = useCallback(() => {
    const current = latestRun.current;
    if (!connection || current.status !== "running") return;
    void dataSource.cancelQuery(connection.name, current.queryId);
  }, [dataSource, connection]);

  useCodeMirror(containerRef, viewRef, {
    dialect: connection?.dialect ?? "postgres",
    schema,
    defaultSchema: schemaDefault,
    ariaLabel: t("sql.editor"),
    onRun: runStatement,
    onDocChange,
  });

  // 接続を切り替えたら、前の接続の結果は消す
  useEffect(() => {
    if (connectionName === null) return;
    dispatch({ type: "cleared" });
  }, [connectionName]);

  // ---- エラーの下線 ----
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const position = absoluteErrorPosition(run);
    if (run.status !== "failed" || position === null) {
      view.dispatch({ effects: setEditorError.of(null) });
      return;
    }
    // 実行中に文を編集していたら、位置がずれているので下線は引かない
    const { target } = run;
    if (view.state.doc.sliceString(target.from, target.to) !== target.text) return;
    const span = errorSpan(view.state.doc.toString(), position);
    if (span) {
      view.dispatch({
        effects: setEditorError.of({ ...span, message: errorString(run.error) }),
      });
    }
  }, [run, errorString]);

  const goToError = useCallback(() => {
    const view = viewRef.current;
    const position = absoluteErrorPosition(latestRun.current);
    if (!view || position === null) return;
    view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    view.focus();
  }, []);

  const now = useNow(run.status === "running");

  return { run, runStatement, stop, goToError, now };
};
