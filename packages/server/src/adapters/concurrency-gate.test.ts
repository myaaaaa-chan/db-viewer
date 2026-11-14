import type { DbResult } from "@myaaaaa_chan/db-viewer-core";
import { describe, expect, it } from "vitest";
import { resolveLimits } from "../limits";
import { createConcurrencyGate, runGated } from "./concurrency-gate";

describe("createConcurrencyGate", () => {
  it("上限までは取得でき、超えたら null を返す（待たせない）", () => {
    const gate = createConcurrencyGate();
    const first = gate.tryAcquire(2);
    const second = gate.tryAcquire(2);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(gate.tryAcquire(2)).toBeNull();
  });

  it("解放すると、その分だけ新しく取得できる", () => {
    const gate = createConcurrencyGate();
    const first = gate.tryAcquire(1);
    expect(gate.tryAcquire(1)).toBeNull();
    first?.();
    expect(gate.tryAcquire(1)).not.toBeNull();
  });

  it("同じ解放を 2 回呼んでも、数え間違えない", () => {
    const gate = createConcurrencyGate();
    const a = gate.tryAcquire(2);
    gate.tryAcquire(2);
    a?.();
    a?.();
    expect(gate.tryAcquire(2)).not.toBeNull();
    expect(gate.tryAcquire(2)).toBeNull();
  });
});

describe("runGated", () => {
  const limits = resolveLimits({ maxConcurrentQueries: 1 });

  it("実行中にもう 1 本来たら、待たずに busy を返す", async () => {
    const gate = createConcurrencyGate();
    let finish: () => void = () => {};
    const running = runGated(
      gate,
      limits,
      () =>
        new Promise<DbResult<string>>((resolve) => {
          finish = () => resolve({ ok: true, value: "first" });
        }),
    );
    const rejected = await runGated(gate, limits, async () => ({ ok: true, value: "second" }));
    expect(rejected).toEqual({ ok: false, error: { kind: "busy", maxConcurrentQueries: 1 } });
    finish();
    expect(await running).toEqual({ ok: true, value: "first" });
  });

  it("終わったら（失敗しても）次のクエリを受け付ける", async () => {
    const gate = createConcurrencyGate();
    await expect(
      runGated(gate, limits, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await runGated(gate, limits, async () => ({ ok: true, value: 1 }))).toEqual({
      ok: true,
      value: 1,
    });
  });
});
