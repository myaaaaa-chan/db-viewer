import type { TableDetail } from "@myaaaaa_chan/db-viewer-core";
import { useT } from "../i18n/useT";
import type { DetailTab } from "../state/table-view";

const keyLabel = (position: number | null, keyCount: number): string => {
  if (position === null) return "";
  return keyCount > 1 ? `PK ${position}` : "PK";
};

// カラム・インデックス・外部キー・DDL。表（データ）以外のタブの中身。
export function TableInfo(props: {
  readonly tab: Exclude<DetailTab, "rows">;
  readonly detail: TableDetail;
}) {
  const { tab, detail } = props;
  const { t } = useT();
  const yesNo = (value: boolean) => (value ? t("info.yes") : t("info.no"));

  if (tab === "columns") {
    const keyCount = detail.columns.filter((c) => c.primaryKeyPosition !== null).length;
    return (
      <div className="dbv-info">
        <table className="dbv-info-table">
          <thead>
            <tr>
              <th scope="col">{t("info.name")}</th>
              <th scope="col">{t("info.type")}</th>
              <th scope="col">{t("info.nullable")}</th>
              <th scope="col">{t("info.default")}</th>
              <th scope="col">{t("info.key")}</th>
            </tr>
          </thead>
          <tbody>
            {detail.columns.map((column) => (
              <tr key={column.name}>
                <td>{column.name}</td>
                <td className="dbv-info-muted">{column.dbType}</td>
                <td>{yesNo(column.nullable)}</td>
                <td className="dbv-info-muted">{column.defaultValue ?? ""}</td>
                <td>{keyLabel(column.primaryKeyPosition, keyCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tab === "indexes") {
    return (
      <div className="dbv-info">
        {detail.indexes.length === 0 ? (
          <p className="dbv-info-empty">{t("info.noIndexes")}</p>
        ) : (
          <table className="dbv-info-table">
            <thead>
              <tr>
                <th scope="col">{t("info.name")}</th>
                <th scope="col">{t("info.columns")}</th>
                <th scope="col">{t("info.unique")}</th>
                <th scope="col">{t("info.primary")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.indexes.map((index) => (
                <tr key={index.name}>
                  <td>{index.name}</td>
                  <td className="dbv-info-muted">{index.columns.join(", ")}</td>
                  <td>{yesNo(index.unique)}</td>
                  <td>{yesNo(index.primary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  if (tab === "foreignKeys") {
    return (
      <div className="dbv-info">
        {detail.foreignKeys.length === 0 ? (
          <p className="dbv-info-empty">{t("info.noForeignKeys")}</p>
        ) : (
          <table className="dbv-info-table">
            <thead>
              <tr>
                <th scope="col">{t("info.name")}</th>
                <th scope="col">{t("info.columns")}</th>
                <th scope="col">{t("info.references")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.foreignKeys.map((fk) => (
                <tr key={fk.name}>
                  <td>{fk.name}</td>
                  <td className="dbv-info-muted">{fk.columns.join(", ")}</td>
                  <td>
                    {fk.references.table.schema}.{fk.references.table.name} (
                    {fk.references.columns.join(", ")})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="dbv-info">
      {detail.ddl.approximate ? (
        <p className="dbv-ddl-note">
          <span className="dbv-ddl-badge">{t("info.approximate")}</span>
          {t("info.approximateNote")}
        </p>
      ) : null}
      <pre className="dbv-ddl">{detail.ddl.text}</pre>
    </div>
  );
}
