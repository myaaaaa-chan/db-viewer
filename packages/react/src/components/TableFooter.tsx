import { useT } from "../i18n/useT";
import { formatInteger } from "../lib/format";
import type { PageInfo } from "../lib/page-info";
import { currentModifierLabels } from "../lib/platform";
import type { GridBounds } from "../state/grid-selection";
import type { Remote } from "../state/remote";
import { Icon } from "./Icon";

export type TableFooterProps = {
  readonly selectionSize: GridBounds | null;
  readonly page: PageInfo;
  readonly count: Remote<string>;
  readonly onCount: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
};

const KEY_MARK = "\u0001";

// 範囲選択の大きさ・ページの位置・件数の取得・ページ送り。
export function TableFooter(props: TableFooterProps) {
  const { selectionSize, page, count, onCount, onPrev, onNext } = props;
  const { t, tc, language } = useT();
  const labels = currentModifierLabels();
  const [hintBefore = "", hintAfter = ""] = t("footer.copyHint", { key: KEY_MARK }).split(KEY_MARK);

  return (
    <footer className="dbv-footer">
      {selectionSize ? (
        <span className="dbv-footer-selection">
          {t("footer.selected", {
            size: `${tc("grid.rowCount", selectionSize.rows)} × ${tc("grid.columnCount", selectionSize.cols)}`,
          })}{" "}
          · {hintBefore}
          <kbd className="dbv-kbd">{labels.copy}</kbd>
          {hintAfter}
        </span>
      ) : null}
      <span className="dbv-spacer" />
      <span>
        {page.from === null || page.to === null
          ? t("footer.noRows")
          : t("footer.range", {
              from: formatInteger(page.from, language),
              to: formatInteger(page.to, language),
            })}
      </span>
      {count.status === "ready" ? (
        <span>{tc("footer.total", count.value)}</span>
      ) : (
        <button
          type="button"
          className="dbv-button"
          disabled={count.status === "loading"}
          onClick={onCount}
        >
          {count.status === "loading" ? t("footer.counting") : t("footer.getCount")}
        </button>
      )}
      {count.status === "failed" ? (
        <span className="dbv-footer-error">{t("footer.countFailed")}</span>
      ) : null}
      <div className="dbv-pager">
        <button
          type="button"
          className="dbv-pagebutton"
          aria-label={t("footer.prevPage")}
          disabled={!page.hasPrev}
          onClick={onPrev}
        >
          <Icon name="chevronLeft" size={14} />
        </button>
        <button
          type="button"
          className="dbv-pagebutton"
          aria-label={t("footer.nextPage")}
          disabled={!page.hasNext}
          onClick={onNext}
        >
          <Icon name="pageNext" size={14} />
        </button>
      </div>
    </footer>
  );
}
