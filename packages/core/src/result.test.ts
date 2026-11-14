import { describe, expect, it, vi } from "vitest";
import { andThen, err, map, mapErr, match, ok, type Result, tryAsync, unwrapOr } from "./result";

describe("ok / err", () => {
  it("ok は成功値を、err は失敗値を ok フラグで判別できる形で持つ", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });
});

describe("map", () => {
  it("成功のときだけ値を変換する", () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
  });

  it("失敗はそのまま通し、変換関数を呼ばない", () => {
    const fn = vi.fn((n: number) => n * 10);
    const failed: Result<number, string> = err("no");
    expect(map(failed, fn)).toEqual(err("no"));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("mapErr", () => {
  it("失敗のときだけエラーを変換する", () => {
    const failed: Result<number, string> = err("no");
    expect(mapErr(failed, (e) => e.length)).toEqual(err(2));
  });

  it("成功はそのまま通し、変換関数を呼ばない", () => {
    const fn = vi.fn((e: string) => e.length);
    const succeeded: Result<number, string> = ok(1);
    expect(mapErr(succeeded, fn)).toEqual(ok(1));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("andThen", () => {
  const parse = (s: string): Result<number, string> => {
    const n = Number(s);
    return Number.isNaN(n) ? err(`not a number: ${s}`) : ok(n);
  };

  it("成功なら次の Result を返す関数をつなげる", () => {
    expect(andThen(ok("42"), parse)).toEqual(ok(42));
    expect(andThen(ok("x"), parse)).toEqual(err("not a number: x"));
  });

  it("失敗なら次の関数を呼ばずに失敗を返す", () => {
    const fn = vi.fn(parse);
    const failed: Result<string, string> = err("earlier");
    expect(andThen(failed, fn)).toEqual(err("earlier"));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("unwrapOr", () => {
  it("成功なら値を、失敗なら代わりの値を返す", () => {
    const succeeded: Result<number, string> = ok(1);
    const failed: Result<number, string> = err("no");
    expect(unwrapOr(succeeded, 0)).toBe(1);
    expect(unwrapOr(failed, 0)).toBe(0);
  });
});

describe("match", () => {
  it("成功と失敗でそれぞれの関数を呼んだ結果を返す", () => {
    const handlers = { ok: (n: number) => `ok:${n}`, err: (e: string) => `err:${e}` };
    const succeeded: Result<number, string> = ok(1);
    const failed: Result<number, string> = err("no");
    expect(match(succeeded, handlers)).toBe("ok:1");
    expect(match(failed, handlers)).toBe("err:no");
  });
});

describe("tryAsync", () => {
  const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : "unknown");

  it("解決した値を成功として返す", async () => {
    expect(await tryAsync(async () => 7, messageOf)).toEqual(ok(7));
  });

  it("reject を例外にせず、変換した失敗として返す", async () => {
    const result = await tryAsync(async () => {
      throw new Error("network down");
    }, messageOf);
    expect(result).toEqual(err("network down"));
  });

  it("関数が同期的に投げた例外も失敗として返す", async () => {
    const result = await tryAsync(() => {
      throw new Error("sync throw");
    }, messageOf);
    expect(result).toEqual(err("sync throw"));
  });
});
