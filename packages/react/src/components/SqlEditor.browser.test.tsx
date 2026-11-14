import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { type DataSource, ok, type QueryOutcome } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { connection, createDataSource, Viewer } from "../../test/browser/fixtures";
import { DbViewerProvider } from "./DbViewerProvider";
import { SqlEditor } from "./SqlEditor";

const view = (): EditorView => {
  const dom = document.querySelector<HTMLElement>(".cm-editor");
  const found = dom ? EditorView.findFromDOM(dom) : null;
  if (!found) throw new Error("エディタが見つからない");
  return found;
};

const setEditor = (text: string, anchor = text.length, head = anchor) => {
  const editor = view();
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
    selection: { anchor, head },
  });
  editor.focus();
};

// 補完の候補を、ポップアップを開かずに、言語が登録している補完の元から直接集める
const completionLabels = async (): Promise<ReadonlyArray<string>> => {
  const { state } = view();
  const pos = state.selection.main.head;
  const sources = state.languageDataAt<CompletionSource>("autocomplete", pos);
  const results = await Promise.all(
    sources.map((source) => source(new CompletionContext(state, pos, true))),
  );
  return results.flatMap((result) => result?.options.map((option) => option.label) ?? []);
};

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control";
const runWithKeyboard = () => userEvent.keyboard(`{${MOD}>}{Enter}{/${MOD}}`);

const openSql = async (dataSource: DataSource = createDataSource()) => {
  const screen = await render(<Viewer dataSource={dataSource} />);
  await userEvent.click(screen.getByRole("tab", { name: "SQL" }));
  await expect.element(screen.getByRole("textbox", { name: "SQL" })).toBeVisible();
  return screen;
};

describe("SQL の実行", () => {
  it("Cmd/Ctrl+Enter で、カーソル位置にある 1 文だけを実行して結果を表に出す", async () => {
    const dataSource = createDataSource();
    const executeQuery = vi.spyOn(dataSource, "executeQuery");
    const screen = await openSql(dataSource);
    setEditor("SELECT 1;\nSELECT 2;", 14);
    await runWithKeyboard();

    await expect.element(screen.getByRole("grid", { name: "SQL result" })).toBeVisible();
    await expect.element(screen.getByRole("gridcell", { name: "2", exact: true })).toBeVisible();
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0]?.[1]).toBe("SELECT 2");
    await expect.element(screen.getByText("1 row · 1 column")).toBeVisible();
    await expect.element(screen.getByText("5 ms")).toBeVisible();
  });

  it("実行した範囲を一瞬ハイライトし、すぐに消す", async () => {
    const screen = await openSql();
    setEditor("SELECT 1;\nSELECT 2;", 14);
    await runWithKeyboard();
    await expect.element(screen.getByRole("grid", { name: "SQL result" })).toBeVisible();
    expect(document.querySelectorAll(".dbv-run-line")).toHaveLength(1);
    await vi.waitFor(() => expect(document.querySelectorAll(".dbv-run-line")).toHaveLength(0), {
      timeout: 3000,
    });
  });

  it("実行ボタンでも同じ文を実行する", async () => {
    const dataSource = createDataSource();
    const executeQuery = vi.spyOn(dataSource, "executeQuery");
    const screen = await openSql(dataSource);
    setEditor("SELECT 1;\nSELECT 2;", 3);
    await userEvent.click(screen.getByRole("button", { name: "Run the statement at the cursor" }));
    await expect.element(screen.getByRole("gridcell", { name: "1", exact: true })).toBeVisible();
    expect(executeQuery.mock.calls[0]?.[1]).toBe("SELECT 1");
  });

  it("選択範囲が 1 文なら、カーソルの位置に関わらず選択範囲を実行する", async () => {
    const dataSource = createDataSource();
    const executeQuery = vi.spyOn(dataSource, "executeQuery");
    const screen = await openSql(dataSource);
    setEditor("SELECT 1;\nSELECT 2;", 0, 8);
    await runWithKeyboard();
    await expect.element(screen.getByRole("gridcell", { name: "1", exact: true })).toBeVisible();
    expect(executeQuery.mock.calls[0]?.[1]).toBe("SELECT 1");
  });

  it("文字列とドル引用の中の ; では文を区切らない（方言に合わせる）", async () => {
    const dataSource = createDataSource();
    const executeQuery = vi.spyOn(dataSource, "executeQuery");
    const screen = await openSql(dataSource);
    setEditor("SELECT $$a;b$$, ';'", 12);
    await runWithKeyboard();
    await expect.element(screen.getByRole("grid", { name: "SQL result" })).toBeVisible();
    expect(executeQuery.mock.calls[0]?.[1]).toBe("SELECT $$a;b$$, ';'");
  });

  it("文がなければ「文がありません」と出し、実行しない", async () => {
    const dataSource = createDataSource();
    const executeQuery = vi.spyOn(dataSource, "executeQuery");
    const screen = await openSql(dataSource);
    setEditor("-- コメントだけ");
    await runWithKeyboard();
    await expect.element(screen.getByText("No statement to run")).toBeVisible();
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("結果が上限で打ち切られていたら、その旨を出す", async () => {
    const base = createDataSource();
    const dataSource: DataSource = {
      ...base,
      executeQuery: async () =>
        ok<QueryOutcome>({
          kind: "rows",
          columns: [{ name: "n", dbType: "int4" }],
          rows: [["1"], ["2"]],
          truncated: true,
          truncatedCells: [],
          elapsedMs: 1200,
        }),
    };
    const screen = await openSql(dataSource);
    setEditor("SELECT n");
    await runWithKeyboard();
    await expect
      .element(screen.getByText("Limit reached. Showing only the first 2 rows."))
      .toBeVisible();
    await expect.element(screen.getByText("1,200 ms")).toBeVisible();
  });

  it("行を返さない文は、影響した行数と経過時間を出す", async () => {
    const screen = await openSql();
    setEditor("DELETE FROM users");
    await runWithKeyboard();
    await expect.element(screen.getByText("3 rows affected")).toBeVisible();
    await expect.element(screen.getByText("4 ms")).toBeVisible();
  });
});

describe("SQL のエラー", () => {
  const runBad = async (screen: Awaited<ReturnType<typeof openSql>>) => {
    setEditor("-- 一覧\nSELECT id, bad, email\nFROM users", 14);
    await runWithKeyboard();
    await expect.element(screen.getByRole("alert")).toBeVisible();
  };

  it("DB のメッセージをそのまま表示し、SQLSTATE と行・桁を添える", async () => {
    const screen = await openSql();
    await runBad(screen);
    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent('column "bad" does not exist');
    await expect.element(alert).toHaveTextContent("SQLSTATE 42703");
    await expect.element(alert).toHaveTextContent("Line 2, column 12");
    await expect.element(screen.getByText(/Failed · \d+ ms/)).toBeVisible();
  });

  it("エラーの位置にある語に下線を引き、文を編集したら下線を消す", async () => {
    const screen = await openSql();
    await runBad(screen);
    await vi.waitFor(() => expect(document.querySelector(".dbv-err")?.textContent).toBe("bad"));

    view().dispatch({ changes: { from: 0, insert: " " } });
    await vi.waitFor(() => expect(document.querySelector(".dbv-err")).toBeNull());
  });

  it("「エラーの位置へ移動」でカーソルをエラーの位置へ動かす", async () => {
    const screen = await openSql();
    await runBad(screen);
    await userEvent.click(screen.getByRole("button", { name: "Go to the error position" }));
    expect(view().state.selection.main.head).toBe("-- 一覧\nSELECT id, ".length);
  });

  it("ほかの種類のエラーも、同じ枠に理由を出す（複数の文）", async () => {
    const base = createDataSource();
    const dataSource: DataSource = {
      ...base,
      executeQuery: async () => ({ ok: false, error: { kind: "multipleStatements" } }),
    };
    const screen = await openSql(dataSource);
    setEditor("SELECT 1; SELECT 2", 0, 18);
    await runWithKeyboard();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Only one statement can be run at a time.");
  });
});

describe("停止と読み取り専用", () => {
  it("停止ボタンは cancel に対応する接続でだけ出る", async () => {
    const without = await openSql();
    expect(without.getByRole("button", { name: "Stop" }).elements()).toHaveLength(0);
    await without.unmount();

    const withCancel = await openSql(createDataSource([connection("main", { cancel: true })]));
    await expect.element(withCancel.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("実行中に停止を押すと cancelQuery を、実行と同じ queryId で呼ぶ", async () => {
    const base = createDataSource([connection("main", { cancel: true })]);
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const dataSource: DataSource = {
      ...base,
      executeQuery: async (...args) => {
        await gate;
        return base.executeQuery(...args);
      },
    };
    const executeQuery = vi.spyOn(dataSource, "executeQuery");
    const cancelQuery = vi.spyOn(dataSource, "cancelQuery");
    const screen = await openSql(dataSource);
    setEditor("SELECT 1");
    await runWithKeyboard();
    await expect.element(screen.getByText(/Running… /)).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
    await expect
      .element(screen.getByRole("button", { name: "Run the statement at the cursor" }))
      .toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(cancelQuery).toHaveBeenCalledTimes(1);
    expect(cancelQuery.mock.calls[0]?.[1]).toBe(executeQuery.mock.calls[0]?.[2]);

    finish();
    await expect.element(screen.getByRole("grid", { name: "SQL result" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("接続が読み取り専用なら、バッジを出す", async () => {
    const screen = await openSql();
    await expect.element(screen.getByText("Read-only").last()).toBeVisible();
  });
});

describe("エディタの内容と補完", () => {
  it("データとSQLを切り替えても、エディタの内容を保つ", async () => {
    const screen = await openSql();
    setEditor("SELECT 42");
    await userEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("textbox", { name: "SQL" }).elements()).toHaveLength(0);
    await userEvent.click(screen.getByRole("tab", { name: "SQL" }));
    await expect
      .element(screen.getByRole("textbox", { name: "SQL" }))
      .toHaveTextContent("SELECT 42");
  });

  it("読み込み済みのテーブル名を補完し、書かれたテーブルのカラムは getTableDetail で補う", async () => {
    const dataSource = createDataSource();
    const getTableDetail = vi.spyOn(dataSource, "getTableDetail");
    await openSql(dataSource);

    setEditor("SELECT * FROM us");
    await vi.waitFor(async () => expect(await completionLabels()).toContain("users"));

    setEditor("SELECT users.");
    await vi.waitFor(() => expect(getTableDetail).toHaveBeenCalled());
    await vi.waitFor(async () => expect(await completionLabels()).toContain("email"));
  });
});

describe("単独で使う", () => {
  it("<DbViewerProvider> の中に置けば、<SqlEditor> だけでも実行できる", async () => {
    const dataSource = createDataSource();
    const screen = await render(
      <DbViewerProvider dataSource={dataSource}>
        <div style={{ width: 900, height: 600, display: "flex" }}>
          <SqlEditor />
        </div>
      </DbViewerProvider>,
    );
    await expect.element(screen.getByRole("textbox", { name: "SQL" })).toBeVisible();
    setEditor("SELECT 1");
    await runWithKeyboard();
    await expect.element(screen.getByRole("grid", { name: "SQL result" })).toBeVisible();
  });
});
