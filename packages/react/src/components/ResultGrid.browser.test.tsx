import type { ColumnName, ResultSet } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ResultGrid } from "./ResultGrid";

const result: ResultSet = {
  columns: [
    { name: "id", dbType: "int8" },
    { name: "name", dbType: "text" },
    { name: "note", dbType: "text" },
  ],
  rows: [
    ["1", "alice", null],
    ["2", "", "has\ttab"],
    ["3", "carol", 'say "hi"'],
    ["4", "dave", "plain"],
  ],
  truncated: false,
  truncatedCells: [[3, 2]],
};

const Frame = (props: { readonly children: React.ReactNode }) => (
  <div style={{ display: "flex", width: 700, height: 300 }}>{props.children}</div>
);

const stubClipboard = () => vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

describe("ResultGrid", () => {
  it("DbViewerProvider がなくても、列名と型・行の値を表示する", async () => {
    const screen = await render(
      <Frame>
        <ResultGrid result={result} />
      </Frame>,
    );
    await expect.element(screen.getByRole("grid", { name: "SQL result" })).toBeVisible();
    await expect.element(screen.getByRole("columnheader", { name: /id\s*int8/ })).toBeVisible();
    await expect
      .element(screen.getByRole("gridcell", { name: "alice", exact: true }))
      .toBeVisible();
  });

  it("NULL は目印の「NULL」を出し、空文字は何も出さない", async () => {
    const screen = await render(
      <Frame>
        <ResultGrid result={result} />
      </Frame>,
    );
    const nullCell = screen.getByRole("gridcell", { name: "NULL", exact: true });
    await expect.element(nullCell).toBeVisible();
    expect(getComputedStyle(nullCell.element()).fontStyle).toBe("italic");
    const rows = screen.getByRole("row").elements();
    const emptyStringCell = rows[2]?.querySelectorAll('[role="gridcell"]')[1];
    expect(emptyStringCell?.textContent).toBe("");
  });

  it("切り詰めたセルには「…」を付ける", async () => {
    const screen = await render(
      <Frame>
        <ResultGrid result={result} />
      </Frame>,
    );
    const cell = screen.getByRole("gridcell", { name: "plain" });
    await expect.element(cell).toBeVisible();
    expect(getComputedStyle(cell.element(), "::after").content).toContain("…");
    const untouched = screen.getByRole("gridcell", { name: "dave" });
    expect(getComputedStyle(untouched.element(), "::after").content).not.toContain("…");
  });

  it("クリックと Shift+クリックで範囲を選び、Ctrl+C で TSV をクリップボードへ送る（列名なし・NULL は空）", async () => {
    const writeText = stubClipboard();
    const screen = await render(
      <Frame>
        <ResultGrid result={result} />
      </Frame>,
    );
    await userEvent.click(screen.getByRole("gridcell", { name: "alice", exact: true }));
    await userEvent.click(screen.getByRole("gridcell", { name: "has\ttab" }), {
      modifiers: ["Shift"],
    });
    expect(screen.getByRole("gridcell", { selected: true }).elements()).toHaveLength(4);

    await userEvent.keyboard("{Control>}c{/Control}");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('alice\t\n\t"has\ttab"');
  });

  it("矢印キーでセルを移動し、Shift+矢印キーで範囲を広げる", async () => {
    const screen = await render(
      <Frame>
        <ResultGrid result={result} />
      </Frame>,
    );
    await userEvent.click(screen.getByRole("gridcell", { name: "1", exact: true }));
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(screen.getByRole("gridcell", { selected: true }).elements()).toHaveLength(1);
    await expect.element(screen.getByRole("gridcell", { selected: true })).toHaveTextContent("");

    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowRight}{/Shift}");
    expect(screen.getByRole("gridcell", { selected: true }).elements()).toHaveLength(4);
  });

  it("列ヘッダーを押すと並べ替えの切り替えを知らせ、並べ替え中の列を示す", async () => {
    const onSortToggle = vi.fn<(column: ColumnName) => void>();
    const screen = await render(
      <Frame>
        <ResultGrid
          result={result}
          sort={{ column: "name" as ColumnName, direction: "desc" }}
          onSortToggle={onSortToggle}
        />
      </Frame>,
    );
    await expect
      .element(screen.getByRole("columnheader", { name: /name/ }))
      .toHaveAttribute("aria-sort", "descending");
    await expect
      .element(screen.getByRole("columnheader", { name: /^id/ }))
      .toHaveAttribute("aria-sort", "none");
    await userEvent.click(screen.getByRole("button", { name: /^id/ }));
    expect(onSortToggle).toHaveBeenCalledWith("id");
  });

  it("ドラッグで列幅を変えられる", async () => {
    const screen = await render(
      <Frame>
        <ResultGrid result={result} />
      </Frame>,
    );
    const header = screen.getByRole("columnheader", { name: /^id/ });
    const before = header.element().getBoundingClientRect().width;
    const handle = screen.getByRole("separator", { name: "Resize column id" }).element();
    const box = handle.getBoundingClientRect();
    const y = box.top + box.height / 2;
    handle.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: box.left + 2, clientY: y }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: box.left + 62, clientY: y }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, clientX: box.left + 62, clientY: y }),
    );
    await vi.waitFor(() =>
      expect(header.element().getBoundingClientRect().width).toBeGreaterThan(before + 40),
    );
  });

  it("行が多くても、見えている行だけを描く（仮想スクロール）", async () => {
    const many: ResultSet = {
      columns: [{ name: "n", dbType: "int4" }],
      rows: Array.from({ length: 1000 }, (_, i) => [String(i)]),
      truncated: false,
      truncatedCells: [],
    };
    const screen = await render(
      <Frame>
        <ResultGrid result={many} />
      </Frame>,
    );
    await expect.element(screen.getByRole("gridcell", { name: "0", exact: true })).toBeVisible();
    expect(screen.getByRole("row").elements().length).toBeLessThan(60);
    expect(screen.getByRole("grid").element().getAttribute("aria-rowcount")).toBe("1001");
  });

  it("列が多くても、見えている列だけを描く（列の仮想スクロール）", async () => {
    const wide: ResultSet = {
      columns: Array.from({ length: 300 }, (_, i) => ({ name: `c${i}`, dbType: "int4" })),
      rows: [Array.from({ length: 300 }, (_, i) => String(i))],
      truncated: false,
      truncatedCells: [],
    };
    const screen = await render(
      <Frame>
        <ResultGrid result={wide} />
      </Frame>,
    );
    await expect.element(screen.getByRole("columnheader", { name: /^c0/ })).toBeVisible();
    expect(screen.getByRole("columnheader").elements().length).toBeLessThan(40);
    expect(screen.getByRole("grid").element().getAttribute("aria-colcount")).toBe("300");
  });

  it("行がなければ、列名を出したまま「行がありません」と表示する", async () => {
    const screen = await render(
      <Frame>
        <ResultGrid result={{ ...result, rows: [], truncatedCells: [] }} />
      </Frame>,
    );
    await expect.element(screen.getByText("No rows")).toBeVisible();
    await expect.element(screen.getByRole("columnheader", { name: /id/ })).toBeVisible();
  });
});
