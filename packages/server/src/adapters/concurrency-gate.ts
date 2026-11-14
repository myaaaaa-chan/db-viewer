import { type DbResult, err } from "@myaaaaa_chan/db-viewer-core";
import type { Limits } from "../limits";

export type Release = () => void;

// 接続ごと（アダプターごと）に 1 つ持つ。実行中のクエリの数を数えるだけで、待たせない。
export const createConcurrencyGate = () => {
  let active = 0;
  return {
    tryAcquire: (max: number): Release | null => {
      if (active >= max) return null;
      active++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
      };
    },
  };
};
export type ConcurrencyGate = ReturnType<typeof createConcurrencyGate>;

// 上限を超えていたら busy を返し、そうでなければ実行して、終わったら（例外でも）解放する。
export const runGated = async <T>(
  gate: ConcurrencyGate,
  limits: Limits,
  run: () => Promise<DbResult<T>>,
): Promise<DbResult<T>> => {
  const release = gate.tryAcquire(limits.maxConcurrentQueries);
  if (release === null) {
    return err({ kind: "busy", maxConcurrentQueries: limits.maxConcurrentQueries });
  }
  try {
    return await run();
  } finally {
    release();
  }
};
