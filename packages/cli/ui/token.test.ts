import { describe, expect, it, vi } from "vitest";
import { takeToken } from "./token";

const env = (hash: string, search = "") => {
  const replaceState = vi.fn();
  const location = { hash, search, pathname: "/" } as Location;
  return { location, history: { replaceState } as unknown as History, replaceState };
};

describe("takeToken", () => {
  it("フラグメントからトークンを読み、URL からフラグメントを消す", () => {
    const { location, history, replaceState } = env("#token=abc_-123", "?a=1");
    expect(takeToken(location, history)).toBe("abc_-123");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?a=1");
  });

  it("トークンがなければ null を返し、URL には触れない", () => {
    const { location, history, replaceState } = env("");
    expect(takeToken(location, history)).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("空のトークンは null として扱う", () => {
    const { location, history } = env("#token=");
    expect(takeToken(location, history)).toBeNull();
  });
});
