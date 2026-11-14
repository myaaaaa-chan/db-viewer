import type { ConnectionInfo, ConnectionName } from "@myaaaaa_chan/db-viewer-core";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { cx } from "./cx";
import { Icon } from "./Icon";

const DIALECT_LABEL = { postgres: "PostgreSQL", sqlite: "SQLite" } as const;

export type ConnectionSelectProps = {
  readonly connections: ReadonlyArray<ConnectionInfo>;
  readonly selected: ConnectionName | null;
  readonly onSelect: (connection: ConnectionName) => void;
};

// 接続の選択。接続名と DB の種類を並べて見せたいので、<select> ではなく listbox を自前で作る。
export function ConnectionSelect(props: ConnectionSelectProps) {
  const { connections, selected, onSelect } = props;
  const { t } = useT();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const current = connections.find((c) => c.name === selected) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const openList = () => {
    setActiveIndex(
      Math.max(
        connections.findIndex((c) => c.name === selected),
        0,
      ),
    );
    setOpen(true);
  };

  const choose = (connection: ConnectionInfo) => {
    setOpen(false);
    onSelect(connection.name);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, connections.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const target = connections[activeIndex];
      if (target) choose(target);
    }
  };

  return (
    <div className="dbv-select" ref={root}>
      <label className="dbv-field-label" htmlFor={`${id}-button`}>
        {t("tree.connection")}
      </label>
      <button
        id={`${id}-button`}
        type="button"
        className="dbv-select-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="dbv-select-value">
          <Icon name="database" size={16} className="dbv-muted-icon" />
          <span className="dbv-select-name">{current?.name ?? ""}</span>
          <span className="dbv-select-dialect">
            {current ? DIALECT_LABEL[current.dialect] : ""}
          </span>
        </span>
        <Icon name="chevronDown" size={14} className="dbv-muted-icon" />
      </button>
      {open ? (
        <ul
          id={`${id}-list`}
          className="dbv-select-list"
          role="listbox"
          aria-label={t("tree.connection")}
        >
          {connections.map((connection, index) => (
            <li
              key={connection.name}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={connection.name === selected}
              className={cx(
                "dbv-select-option",
                index === activeIndex && "dbv-select-option--active",
              )}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(connection)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <span className="dbv-select-name">{connection.name}</span>
              <span className="dbv-select-dialect">{DIALECT_LABEL[connection.dialect]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
