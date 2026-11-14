import { useCallback, useRef } from "react";

// 非同期の取得ごとに振る番号。応答に同じ番号を持たせ、reducer が古い応答を捨てる。
export const useRequestIds = (): (() => number) => {
  const last = useRef(0);
  return useCallback(() => {
    last.current += 1;
    return last.current;
  }, []);
};
