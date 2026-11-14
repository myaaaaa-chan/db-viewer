import { queryId } from "@myaaaaa_chan/db-viewer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelTimeoutError } from "./errors";
import { createInFlightRegistry, type InFlightRequest } from "./in-flight";

const id = queryId("q-1");
const DELIVERY_TIMEOUT_MS = 1_000;

const registryOf = (deliver: (pid: number) => Promise<boolean>) =>
  createInFlightRegistry(deliver, { deliveryTimeoutMs: DELIVERY_TIMEOUT_MS });

// 同じ ID が使用中でなければ、必ず登録できる
const beginOf = (registry: ReturnType<typeof registryOf>, queryId_ = id): InFlightRequest => {
  const request = registry.begin(queryId_);
  if (request === null) throw new Error("expected the queryId to be free");
  return request;
};

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
    const registry = registryOf(deliver);
    expect(await registry.cancel(id)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("文を送っている間の中断は、backend の pid に届けて、その結果を返す", async () => {
    const deliver = vi.fn(async (_pid: number) => true);
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    expect(request.startStatement(4242)).toBe("go");
    expect(await registry.cancel(id)).toBe(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(4242);
    expect(request.cancelRequested()).toBe(true);
  });

  it("DB が「止める対象がなかった」と返したら false で、中断を依頼した印も戻す", async () => {
    const registry = registryOf(async () => false);
    const request = beginOf(registry);
    request.startStatement(1);
    expect(await registry.cancel(id)).toBe(false);
    expect(request.cancelRequested()).toBe(false);
  });

  it("届ける途中で失敗したら、中断を依頼した印を戻したうえで、失敗を伝える", async () => {
    const registry = registryOf(async () => {
      throw new Error("too many clients");
    });
    const request = beginOf(registry);
    request.startStatement(1);
    await expect(registry.cancel(id)).rejects.toThrow("too many clients");
    expect(request.cancelRequested()).toBe(false);
  });

  it("同じ ID の中断が重なっても、DB への依頼は 1 回で、同じ結果を返す", async () => {
    const { deliver, settle } = deferredDeliver();
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    request.startStatement(7);
    const first = registry.cancel(id);
    const second = registry.cancel(id);
    settle(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

describe("createInFlightRegistry: 文を送る前", () => {
  it("接続を待っている間・準備の間の中断は、DB には送らず、文を送らないことにする", async () => {
    const deliver = vi.fn(async () => true);
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    expect(await registry.cancel(id)).toBe(true);
    expect(request.startStatement(9)).toBe("cancelled");
    expect(request.cancelRequested()).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("準備の間に中断が来たら、接続を待っている側にすぐ知らせる。文を送り始めた後の中断では知らせない", async () => {
    const registry = registryOf(async () => true);
    const waiting = beginOf(registry, queryId("waiting"));
    let notified = false;
    void waiting.whenCancelRequested.then(() => {
      notified = true;
    });
    await Promise.resolve();
    expect(notified).toBe(false);
    await registry.cancel(queryId("waiting"));
    await Promise.resolve();
    expect(notified).toBe(true);

    const running = beginOf(registry, queryId("running"));
    running.startStatement(1);
    let runningNotified = false;
    void running.whenCancelRequested.then(() => {
      runningNotified = true;
    });
    await registry.cancel(queryId("running"));
    await Promise.resolve();
    expect(runningNotified).toBe(false);
  });
});

describe("createInFlightRegistry: 文が終わった後", () => {
  it("文が終わってからの中断は、同じ接続の次のクエリを止めないよう、DB に送らない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    request.startStatement(5);
    await request.finishStatement();
    expect(await registry.cancel(id)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
    expect(request.cancelRequested()).toBe(false);
  });

  it("終わったら（end）、その ID は中断できない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    request.startStatement(5);
    await request.finishStatement();
    request.end();
    expect(await registry.cancel(id)).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("中断を届けている最中は、届け終わるまで文の終了（接続を戻す前の段階）を待たせる", async () => {
    const { deliver, settle } = deferredDeliver();
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    request.startStatement(5);
    const cancelling = registry.cancel(id);
    let finished = false;
    const finishing = request.finishStatement().then((outcome) => {
      finished = true;
      return outcome;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(finished).toBe(false);
    settle(true);
    expect(await finishing).toBe("clean");
    expect(await cancelling).toBe(true);
  });

  it("届けるのに失敗していても、文の終了は待たされたままにならない", async () => {
    const { deliver, settle } = deferredDeliver();
    const registry = registryOf(deliver);
    const request = beginOf(registry);
    request.startStatement(5);
    const cancelling = registry.cancel(id);
    const finishing = request.finishStatement();
    settle(new Error("connection refused"));
    await expect(cancelling).rejects.toThrow("connection refused");
    await expect(finishing).resolves.toBe("clean");
  });
});

describe("createInFlightRegistry: 中断の依頼が届かないとき", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("時間内に終わらなければ、中断は失敗として返り、文の終了は abandoned を返して待つのをやめる", async () => {
    const registry = registryOf(() => new Promise<boolean>(() => {}));
    const request = beginOf(registry);
    request.startStatement(5);
    const cancelling = registry.cancel(id);
    const outcome = request.finishStatement();
    const rejected = expect(cancelling).rejects.toBeInstanceOf(CancelTimeoutError);
    await vi.advanceTimersByTimeAsync(DELIVERY_TIMEOUT_MS);
    await rejected;
    // 後から届くかもしれないので、その接続は Pool に戻してはいけない（呼び出し側が捨てる）
    expect(await outcome).toBe("abandoned");
    expect(request.cancelRequested()).toBe(false);
  });

  it("時間内に終われば、タイマーは残らない", async () => {
    const registry = registryOf(async () => true);
    const request = beginOf(registry);
    request.startStatement(5);
    expect(await registry.cancel(id)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(await request.finishStatement()).toBe("clean");
  });
});

describe("createInFlightRegistry: 同じ ID", () => {
  it("使用中の ID は、2 つめを登録させない。終われば、また使える", () => {
    const registry = registryOf(async () => true);
    const first = beginOf(registry);
    expect(registry.begin(id)).toBeNull();
    first.end();
    expect(registry.begin(id)).not.toBeNull();
  });

  it("終わった実行の end は、同じ ID で後から始まった実行の印を消さない", async () => {
    const deliver = vi.fn(async () => true);
    const registry = registryOf(deliver);
    const first = beginOf(registry);
    first.end();
    const second = beginOf(registry);
    second.startStatement(22);
    first.end();
    expect(await registry.cancel(id)).toBe(true);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(22);
  });
});
