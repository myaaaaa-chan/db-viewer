import type { DataSource } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { createDataSource, LONG_VALUE, Viewer } from "../../test/browser/fixtures";

const stubClipboard = () => vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

const openUsers = async (dataSource: DataSource = createDataSource()) => {
  const screen = await render(<Viewer dataSource={dataSource} />);
  await userEvent.click(screen.getByRole("treeitem", { name: "users", exact: true }));
  await expect.element(screen.getByRole("gridcell", { name: "user1@example.com" })).toBeVisible();
  return screen;
};

describe("ツリーでテーブルを開く", () => {
  it("開いたスキーマのテーブルとビューが並び、テーブルを選ぶと行が出る", async () => {
    const screen = await render(<Viewer dataSource={createDataSource()} />);
    await expect
      .element(screen.getByRole("treeitem", { name: "public", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByRole("treeitem", { name: "logs", exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("treeitem", { name: "users", exact: true }));
    await expect.element(screen.getByRole("grid", { name: "public.users data" })).toBeVisible();
    await expect.element(screen.getByRole("gridcell", { name: "user1@example.com" })).toBeVisible();
    await expect
      .element(screen.getByRole("treeitem", { name: "users", exact: true }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("スキーマを開くまで、そのスキーマのテーブルは読み込まない", async () => {
    const dataSource = createDataSource();
    const listTables = vi.spyOn(dataSource, "listTables");
    const screen = await render(<Viewer dataSource={dataSource} />);
    await expect
      .element(screen.getByRole("treeitem", { name: "audit", exact: true }))
      .toBeVisible();
    expect(listTables.mock.calls.map(([, schema]) => schema)).toEqual(["public"]);

    await userEvent.click(screen.getByRole("treeitem", { name: "audit", exact: true }));
    await expect
      .element(screen.getByRole("treeitem", { name: "events", exact: true }))
      .toBeVisible();
    expect(listTables.mock.calls.map(([, schema]) => schema)).toEqual(["public", "audit"]);
  });

  it("名前を検索すると、一致するテーブルだけに絞り、一致しない組には案内を出す", async () => {
    const screen = await render(<Viewer dataSource={createDataSource()} />);
    await userEvent.fill(screen.getByRole("searchbox", { name: "Search tables" }), "LOG");
    await expect.element(screen.getByRole("treeitem", { name: "logs", exact: true })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "users", exact: true }).elements()).toHaveLength(0);
    await expect.element(screen.getByText("No matching views")).toBeVisible();
  });

  it("矢印キーでツリーを移動し、Enter でテーブルを開く", async () => {
    const screen = await render(<Viewer dataSource={createDataSource()} />);
    await expect.element(screen.getByRole("treeitem", { name: "logs", exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("tree"));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    await expect.element(screen.getByRole("grid", { name: "public.logs data" })).toBeVisible();
  });

  it("接続が 2 つあるときだけ接続の選択を出し、選ぶと別の接続のツリーに変わる", async () => {
    const one = await render(<Viewer dataSource={createDataSource()} />);
    await expect.element(one.getByRole("treeitem", { name: "public", exact: true })).toBeVisible();
    expect(one.getByRole("combobox", { name: "Connection" }).elements()).toHaveLength(0);
    await one.unmount();

    const two = await render(
      <Viewer
        dataSource={createDataSource([
          { name: "main", dialect: "postgres", readOnly: true, schemas: [], cancel: false },
          {
            name: "local",
            dialect: "sqlite",
            readOnly: false,
            cancel: false,
            schemas: [{ name: "main", tables: [] }],
          },
        ])}
      />,
    );
    await userEvent.click(two.getByRole("combobox", { name: "Connection" }));
    await userEvent.click(two.getByRole("option", { name: /local/ }));
    await expect
      .element(two.getByRole("combobox", { name: "Connection" }))
      .toHaveTextContent("SQLite");
    await expect.element(two.getByRole("treeitem", { name: "main", exact: true })).toBeVisible();
  });
});

describe("データ表", () => {
  it("1 ページ 100 件で表示し、次へ・前へで移動する", async () => {
    const screen = await openUsers();
    await expect.element(screen.getByText("Rows 1–100")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await expect.element(screen.getByText("Rows 101–120")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    await expect
      .element(screen.getByRole("gridcell", { name: "user101@example.com" }))
      .toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await expect.element(screen.getByText("Rows 1–100")).toBeVisible();
  });

  it("「件数を取得」を押したときだけ件数を数える", async () => {
    const dataSource = createDataSource();
    const countRows = vi.spyOn(dataSource, "countRows");
    const screen = await openUsers(dataSource);
    expect(countRows).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Get count" }));
    await expect.element(screen.getByText("120 rows in total")).toBeVisible();
    expect(countRows).toHaveBeenCalledTimes(1);
  });

  it("構造化フィルタを足すと条件を満たす行だけになり、条件を消すと戻る", async () => {
    const screen = await openUsers();
    await userEvent.click(screen.getByRole("button", { name: "Add condition" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Column" }), "role");
    await userEvent.fill(screen.getByRole("textbox", { name: "Value" }), "admin");
    await userEvent.click(screen.getByRole("button", { name: "Add", exact: true }));

    await expect.element(screen.getByText("role = admin")).toBeVisible();
    await expect
      .element(screen.getByRole("gridcell", { name: "user10@example.com" }))
      .toBeVisible();
    expect(screen.getByRole("gridcell", { name: "user1@example.com" }).elements()).toHaveLength(0);
    await expect.element(screen.getByText("Rows 1–12")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Remove condition" }));
    await expect.element(screen.getByRole("gridcell", { name: "user1@example.com" })).toBeVisible();
    await expect.element(screen.getByText("Rows 1–100")).toBeVisible();
  });

  it("IS NULL のフィルタは値を入力せずに足せる", async () => {
    const screen = await openUsers();
    await userEvent.click(screen.getByRole("button", { name: "Add condition" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Column" }), "bio");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Operator" }), "isNull");
    expect(screen.getByRole("textbox", { name: "Value" }).elements()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Add", exact: true }));
    await expect.element(screen.getByText("bio IS NULL")).toBeVisible();
    await expect.element(screen.getByRole("gridcell", { name: "user5@example.com" })).toBeVisible();
    expect(screen.getByRole("gridcell", { name: "user3@example.com" }).elements()).toHaveLength(0);
    expect(screen.getByRole("gridcell", { name: "user4@example.com" }).elements()).toHaveLength(0);
  });

  it("WHERE の直接入力は DataSource にそのまま渡す", async () => {
    const dataSource = createDataSource();
    const fetchRows = vi.spyOn(dataSource, "fetchRows");
    const screen = await openUsers(dataSource);
    await userEvent.fill(screen.getByRole("textbox", { name: "WHERE clause" }), "id > 100");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await vi.waitFor(() => expect(fetchRows.mock.lastCall?.[1].rawWhere).toBe("id > 100"));
  });

  it("列ヘッダーを押すと サーバー側の並べ替えが 昇順 → 降順 → なし と切り替わる", async () => {
    const dataSource = createDataSource();
    const fetchRows = vi.spyOn(dataSource, "fetchRows");
    const screen = await openUsers(dataSource);
    const header = screen.getByRole("columnheader", { name: /^id/ });

    await userEvent.click(screen.getByRole("button", { name: /^id/ }));
    await expect.element(header).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: /^id/ }));
    await expect.element(header).toHaveAttribute("aria-sort", "descending");
    await vi.waitFor(() =>
      expect(fetchRows.mock.lastCall?.[1].sort).toEqual({ column: "id", direction: "desc" }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^id/ }));
    await expect.element(header).toHaveAttribute("aria-sort", "none");
    await vi.waitFor(() => expect(fetchRows.mock.lastCall?.[1].sort).toBeNull());
  });

  it("範囲を選んで Ctrl+C を押すと、列名なし・NULL は空の TSV をクリップボードへ送る", async () => {
    const writeText = stubClipboard();
    const screen = await openUsers();
    await userEvent.click(screen.getByRole("gridcell", { name: "user2@example.com" }));
    await userEvent.click(screen.getByRole("gridcell", { name: "member" }).nth(2), {
      modifiers: ["Shift"],
    });
    await expect.element(screen.getByText(/2 rows × 2 columns selected/)).toBeVisible();

    await userEvent.keyboard("{Control>}c{/Control}");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("user2@example.com\tmember\nuser3@example.com\tmember");
  });

  it("NULL と空文字を見分けられる（詳細パネルでも）", async () => {
    const screen = await openUsers();
    const nullCell = screen.getByRole("gridcell", { name: "NULL" }).first();
    await expect.element(nullCell).toBeVisible();
    await userEvent.click(nullCell);
    await expect
      .element(screen.getByRole("region", { name: "Cell details" }))
      .toHaveTextContent("NULL");

    const emptyCell = document.querySelector('[data-dbv-row="3"][data-dbv-col="3"]');
    expect(emptyCell?.textContent).toBe("");
    await userEvent.click(page.elementLocator(emptyCell as Element));
    await expect
      .element(screen.getByRole("region", { name: "Cell details" }))
      .toHaveTextContent("(empty string)");
  });
});

describe("切り詰めたセル", () => {
  it("末尾に「…」を付け、主キーのあるテーブルでは fetchCell で全体を取り直せる", async () => {
    const dataSource = createDataSource();
    const fetchCell = vi.spyOn(dataSource, "fetchCell");
    const screen = await openUsers(dataSource);
    const cell = screen.getByRole("gridcell", { name: LONG_VALUE.slice(0, 20) });
    expect(getComputedStyle(cell.element(), "::after").content).toContain("…");

    await userEvent.click(cell);
    const panel = screen.getByRole("region", { name: "Cell details" });
    await expect.element(panel).toHaveTextContent("only the first 20 characters are shown");
    await userEvent.click(screen.getByRole("button", { name: "Load full value" }));
    await expect.element(panel).toHaveTextContent(LONG_VALUE);
    expect(fetchCell).toHaveBeenCalledWith(
      "main",
      { schema: "public", name: "users" },
      { id: "3" },
      "bio",
    );
  });

  it("主キーのないテーブルでは、取り直さず「値の一部だけを表示しています」と出す", async () => {
    const screen = await render(<Viewer dataSource={createDataSource()} />);
    await userEvent.click(screen.getByRole("treeitem", { name: "logs", exact: true }));
    await userEvent.click(screen.getByRole("gridcell", { name: LONG_VALUE.slice(0, 20) }));
    const panel = screen.getByRole("region", { name: "Cell details" });
    await expect.element(panel).toHaveTextContent("Only part of the value is shown.");
    expect(screen.getByRole("button", { name: "Load full value" }).elements()).toHaveLength(0);
  });
});

describe("テーブルの詳細", () => {
  it("カラム・インデックス・DDL のタブを切り替えられる", async () => {
    const screen = await openUsers();
    await userEvent.click(screen.getByRole("tab", { name: "Columns" }));
    await expect.element(screen.getByRole("cell", { name: "email", exact: true })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Indexes" }));
    await expect.element(screen.getByRole("cell", { name: "users_pkey" })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Foreign keys" }));
    await expect.element(screen.getByText("No foreign keys")).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "DDL" }));
    await expect.element(screen.getByText("CREATE TABLE users (...);")).toBeVisible();
  });

  it("PostgreSQL の DDL のように近似のときは「近似」と示す", async () => {
    const base = createDataSource();
    const dataSource: DataSource = {
      ...base,
      getTableDetail: async (connection, table) => {
        const result = await base.getTableDetail(connection, table);
        return result.ok
          ? {
              ok: true,
              value: {
                ...result.value,
                ddl: { text: "CREATE TABLE users ();", approximate: true },
              },
            }
          : result;
      },
    };
    const screen = await openUsers(dataSource);
    await userEvent.click(screen.getByRole("tab", { name: "DDL" }));
    await expect.element(screen.getByText("Approximate")).toBeVisible();
  });
});

describe("古い応答", () => {
  it("先に選んだテーブルの応答が後から届いても、後に選んだテーブルの表を残す", async () => {
    const base = createDataSource();
    let releaseUsers: () => void = () => {};
    const usersGate = new Promise<void>((resolve) => {
      releaseUsers = resolve;
    });
    const dataSource: DataSource = {
      ...base,
      fetchRows: async (connection, query) => {
        if (query.table.name === "users") await usersGate;
        return base.fetchRows(connection, query);
      },
    };
    const screen = await render(<Viewer dataSource={dataSource} />);
    await userEvent.click(screen.getByRole("treeitem", { name: "users", exact: true }));
    await userEvent.click(screen.getByRole("treeitem", { name: "logs", exact: true }));
    await expect.element(screen.getByRole("gridcell", { name: "2026-11-14" })).toBeVisible();

    releaseUsers();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(screen.getByRole("grid", { name: "public.logs data" })).toBeVisible();
    expect(screen.getByRole("gridcell", { name: "user1@example.com" }).elements()).toHaveLength(0);
  });
});

describe("エラーと言語", () => {
  it("行を読み込めなかったら、エラーの枠にメッセージを出す", async () => {
    const base = createDataSource();
    const dataSource: DataSource = {
      ...base,
      fetchRows: async () => ({ ok: false, error: { kind: "unauthorized" } }),
    };
    const screen = await render(<Viewer dataSource={dataSource} />);
    await userEvent.click(screen.getByRole("treeitem", { name: "users", exact: true }));
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Could not load the data");
    await expect.element(screen.getByRole("alert")).toHaveTextContent("not authorized");
  });

  it("language を ja にすると、文言が日本語になる", async () => {
    const screen = await render(<Viewer dataSource={createDataSource()} language="ja" />);
    await userEvent.click(screen.getByRole("treeitem", { name: "users", exact: true }));
    await expect.element(screen.getByRole("button", { name: "条件を追加" })).toBeVisible();
    await expect.element(screen.getByText("読み取り専用")).toBeVisible();
    await expect.element(screen.getByText("1–100 行目")).toBeVisible();
  });
});
