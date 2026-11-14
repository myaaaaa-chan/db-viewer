import {
  type ColumnName,
  columnName,
  type Filter,
  type FilterOperator,
} from "@myaaaaa_chan/db-viewer-core";
import { type FormEvent, useId, useState } from "react";
import { useT } from "../i18n/useT";
import { Icon } from "./Icon";

const OPERATORS: ReadonlyArray<{ readonly op: FilterOperator; readonly label: string }> = [
  { op: "eq", label: "=" },
  { op: "neq", label: "!=" },
  { op: "lt", label: "<" },
  { op: "gt", label: ">" },
  { op: "like", label: "LIKE" },
  { op: "isNull", label: "IS NULL" },
];

const opLabel = (op: FilterOperator): string => OPERATORS.find((o) => o.op === op)?.label ?? op;

export type FilterBarProps = {
  readonly columns: ReadonlyArray<ColumnName>;
  readonly filters: ReadonlyArray<Filter>;
  readonly rawWhere: string | null;
  readonly onAdd: (filter: Filter) => void;
  readonly onRemove: (index: number) => void;
  readonly onApplyWhere: (text: string) => void;
};

// 構造化フィルタ（カラム・演算子・値）と、WHERE の直接入力。入力途中の値はここに持つ。
export function FilterBar(props: FilterBarProps) {
  const { columns, filters, rawWhere, onAdd, onRemove, onApplyWhere } = props;
  const { t } = useT();
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [column, setColumn] = useState("");
  const [op, setOp] = useState<FilterOperator>("eq");
  const [value, setValue] = useState("");
  const [where, setWhere] = useState(rawWhere ?? "");

  const selectedColumn = column || columns[0] || "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (selectedColumn === "") return;
    onAdd(
      op === "isNull"
        ? { column: columnName(selectedColumn), op }
        : { column: columnName(selectedColumn), op, value },
    );
    setAdding(false);
    setValue("");
  };

  return (
    <div className="dbv-filter">
      <div className="dbv-filter-row">
        <span className="dbv-filter-label">{t("filter.label")}</span>
        {filters.map((filter, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同じ条件を重ねて追加できるので、位置でしか区別できない
          <span className="dbv-chip" key={`${index}:${filter.column}:${filter.op}`}>
            <span>
              {filter.column} <span className="dbv-chip-op">{opLabel(filter.op)}</span>
              {filter.op === "isNull" ? null : ` ${filter.value}`}
            </span>
            <button
              type="button"
              className="dbv-iconbutton"
              aria-label={t("filter.remove")}
              onClick={() => onRemove(index)}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        {adding ? (
          <form className="dbv-filter-form" onSubmit={submit}>
            <select
              className="dbv-input"
              aria-label={t("filter.column")}
              value={selectedColumn}
              onChange={(event) => setColumn(event.target.value)}
            >
              {columns.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="dbv-input"
              aria-label={t("filter.operator")}
              value={op}
              onChange={(event) => setOp(event.target.value as FilterOperator)}
            >
              {OPERATORS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            {op === "isNull" ? null : (
              <input
                className="dbv-input dbv-input--mono"
                aria-label={t("filter.value")}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            <button type="submit" className="dbv-button dbv-button--small">
              {t("filter.confirm")}
            </button>
            <button
              type="button"
              className="dbv-button dbv-button--small"
              onClick={() => setAdding(false)}
            >
              {t("filter.cancel")}
            </button>
          </form>
        ) : (
          <button type="button" className="dbv-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} />
            {t("filter.add")}
          </button>
        )}
      </div>
      <form
        className="dbv-filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          onApplyWhere(where);
        }}
      >
        <label className="dbv-where-label" htmlFor={`${id}-where`}>
          WHERE
        </label>
        <input
          id={`${id}-where`}
          className="dbv-input dbv-where-input"
          aria-label={t("filter.where")}
          value={where}
          spellCheck={false}
          onChange={(event) => setWhere(event.target.value)}
        />
        <button type="submit" className="dbv-button dbv-button--primary">
          {t("filter.apply")}
        </button>
      </form>
    </div>
  );
}
