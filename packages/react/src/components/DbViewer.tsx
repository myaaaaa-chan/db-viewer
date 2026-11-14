import { useState } from "react";
import { useDbViewer } from "../context";
import type { DbViewerProps } from "../types";
import { cx } from "./cx";
import { DbViewerProvider } from "./DbViewerProvider";
import { ModeTabs } from "./ModeTabs";
import { SchemaTree } from "./SchemaTree";
import { SqlEditor } from "./SqlEditor";
import { TableView } from "./TableView";

// 全部入り: 左にツリー、右に「データ / SQL」の切り替え。
// 切り替えても、フィルタやエディタの内容を残すため、どちらも描いたまま隠す（SQL は最初に開くまで描かない）。
export function DbViewer(props: DbViewerProps) {
  return (
    <DbViewerProvider {...props} className={cx("dbv-viewer", props.className)}>
      <SchemaTree />
      <DbViewerMain />
    </DbViewerProvider>
  );
}

function DbViewerMain() {
  const { state } = useDbViewer();
  const [sqlOpened, setSqlOpened] = useState(false);
  if (state.mode === "sql" && !sqlOpened) setSqlOpened(true);

  return (
    <main className="dbv-main">
      <div className="dbv-pane" hidden={state.mode !== "data"}>
        <TableView toolbarStart={<ModeTabs />} />
      </div>
      {sqlOpened ? (
        <div className="dbv-pane" hidden={state.mode !== "sql"}>
          <SqlEditor toolbarStart={<ModeTabs />} />
        </div>
      ) : null}
    </main>
  );
}
