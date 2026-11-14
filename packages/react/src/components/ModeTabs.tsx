import { useDbViewer } from "../context";
import { useT } from "../i18n/useT";
import type { ViewerMode } from "../state/viewer";

const MODES: ReadonlyArray<ViewerMode> = ["data", "sql"];

// 右側の表示の切り替え。タブはなく、「データ」と「SQL」の 2 つだけ。
export function ModeTabs() {
  const { t } = useT();
  const { state, setMode } = useDbViewer();
  return (
    <div className="dbv-modetabs" role="tablist" aria-label={t("viewer.modeTabs")}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          className="dbv-modetab"
          aria-selected={state.mode === mode}
          onClick={() => setMode(mode)}
        >
          {mode === "data" ? t("viewer.data") : t("viewer.sql")}
        </button>
      ))}
    </div>
  );
}
