import { err, ok } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { idle, type Remote, request, settle, shownValue } from "./remote";

describe("request / settle", () => {
  it("要求した番号の応答だけを反映する", () => {
    const loading = request<string>(idle, 1);
    expect(settle(loading, 1, ok("a"))).toEqual({ status: "ready", value: "a" });
  });

  it("古い要求の応答は捨てる", () => {
    const second = request<string>(request<string>(idle, 1), 2);
    expect(settle(second, 1, ok("old"))).toBe(second);
    expect(settle(second, 2, ok("new"))).toEqual({ status: "ready", value: "new" });
  });

  it("要求していない状態に届いた応答は捨てる", () => {
    expect(settle(idle as Remote<string>, 1, ok("x"))).toEqual({ status: "idle" });
  });

  it("失敗はエラーを持つ状態にする", () => {
    const failed = settle(request<string>(idle, 1), 1, err({ kind: "unauthorized" } as const));
    expect(failed).toEqual({ status: "failed", error: { kind: "unauthorized" } });
  });

  it("読み込み中は直前の値を持ち続ける（ページ送りで表を空にしない）", () => {
    const ready: Remote<string> = { status: "ready", value: "page 1" };
    const next = request(ready, 2);
    expect(shownValue(next)).toBe("page 1");
    expect(shownValue(request(next, 3))).toBe("page 1");
  });

  it("失敗の後に再要求しても、前の値は戻らない", () => {
    const failed: Remote<string> = { status: "failed", error: { kind: "cancelled" } };
    expect(shownValue(request(failed, 2))).toBeNull();
  });

  it("値のない状態では null を返す", () => {
    expect(shownValue(idle)).toBeNull();
  });
});
