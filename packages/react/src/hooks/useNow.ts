import { useEffect, useState } from "react";

// active の間だけ、一定の間隔で現在時刻（ミリ秒）を返す。実行中の経過時間の表示に使う。
export const useNow = (active: boolean, intervalMs = 100): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
};
