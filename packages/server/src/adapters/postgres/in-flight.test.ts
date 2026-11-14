import { queryId } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it, vi } from "vitest";
import { createInFlightRegistry } from "./in-flight";

const id = queryId("q-1");

// deliver を、テストが好きなときに終わらせられる形にする
const deferredDeliver = () => {
  let settle: (result: boolean | Error) => void = () => {};
  const deliver = vi.fn(
    (_pid: number) =>
      new Promise<boolean>((resolve, reject) => {
        settle = (result) => (result instanceof Error ? reject(result) : resolve(result));
      }),
  );
  return { deliver, settle: (result: boolean | Error) => settle(result) };
};

describe("createInFlightRegistry: 中断の依頼", () => {
  it("実行中でない ID の中断は false で、DB には何も送らない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = createInFlightRegistry(deliver);
    expect(await registry.cancel(id)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("文を送っている間の中断は、backend の pid に届けて、その結果を返す", async () => {
    const deliver = vi.fn(async (_pid: number) => true);
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    expect(request.startStatement(4242)).toBe("go");
    expect(await registry.cancel(id)).toBe(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(4242);
    expect(request.cancelRequested()).toBe(true);
  });

  it("DB が「止める対象がなかった」と返したら false で、中断を依頼した印も戻す", async () => {
    const registry = createInFlightRegistry(async () => false);
    const request = registry.begin(id);
    request.startStatement(1);
    expect(await registry.cancel(id)).toBe(false);
    expect(request.cancelRequested()).toBe(false);
  });

  it("届ける途中で失敗したら、中断を依頼した印を戻したうえで、失敗を伝える", async () => {
    const registry = createInFlightRegistry(async () => {
      throw new Error("too many clients");
    });
    const request = registry.begin(id);
    request.startStatement(1);
    await expect(registry.cancel(id)).rejects.toThrow("too many clients");
    expect(request.cancelRequested()).toBe(false);
  });

  it("同じ ID の中断が重なっても、DB への依頼は 1 回で、同じ結果を返す", async () => {
    const { deliver, settle } = deferredDeliver();
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    request.startStatement(7);
    const first = registry.cancel(id);
    const second = registry.cancel(id);
    settle(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

describe("createInFlightRegistry: 文を送る前（R5）", () => {
  it("接続を待っている間・準備の間の中断は、DB には送らず、文を送らないことにする", async () => {
    const deliver = vi.fn(async () => true);
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    expect(await registry.cancel(id)).toBe(true);
    expect(request.startStatement(9)).toBe("cancelled");
    expect(request.cancelRequested()).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("createInFlightRegistry: 文が終わった後（R5）", () => {
  it("文が終わってからの中断は、同じ接続の次のクエリを止めないよう、DB に送らない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    request.startStatement(5);
    await request.finishStatement();
    expect(await registry.cancel(id)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
    expect(request.cancelRequested()).toBe(false);
  });

  it("終わったら（end）、その ID は中断できない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    request.startStatement(5);
    await request.finishStatement();
    request.end();
    expect(await registry.cancel(id)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("中断を届けている最中は、届け終わるまで文の終了（接続を戻す前の段階）を待たせる", async () => {
    const { deliver, settle } = deferredDeliver();
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    request.startStatement(5);
    const cancelling = registry.cancel(id);
    let finished = false;
    const finishing = request.finishStatement().then(() => {
      finished = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    settle(true);
    await finishing;
    expect(finished).toBe(true);
    expect(await cancelling).toBe(true);
  });

  it("届けるのに失敗していても、文の終了は待たされたままにならない", async () => {
    const { deliver, settle } = deferredDeliver();
    const registry = createInFlightRegistry(deliver);
    const request = registry.begin(id);
    request.startStatement(5);
    const cancelling = registry.cancel(id);
    const finishing = request.finishStatement();
    settle(new Error("connection refused"));
    await expect(cancelling).rejects.toThrow("connection refused");
    await expect(finishing).resolves.toBeUndefined();
  });
});

describe("createInFlightRegistry: 同じ ID の入れ替わり", () => {
  it("古い実行の end が、同じ ID で後から始めた実行の印を消さない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = createInFlightRegistry(deliver);
    const first = registry.begin(id);
    const second = registry.begin(id);
    second.startStatement(22);
    first.end();
    expect(await registry.cancel(id)).toBe(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(22);
  });
});
