import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ja } from "./ja";
import { mergeMessages } from "./messages";

const leafPaths = (value: unknown, prefix = ""): ReadonlyArray<string> =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, child]) => leafPaths(child, `${prefix}${key}.`))
    : [prefix.slice(0, -1)];

describe("mergeMessages", () => {
  it("override の葉だけを base の上に重ねる（深い結合）", () => {
    const merged = mergeMessages({ a: { x: "1", y: "2" }, b: "3" }, { a: { y: "Y" } });
    expect(merged).toEqual({ a: { x: "1", y: "Y" }, b: "3" });
  });

  it("入力のオブジェクトを書き換えない", () => {
    const base = { a: { x: "1" } };
    mergeMessages(base, { a: { x: "X" } });
    expect(base).toEqual({ a: { x: "1" } });
  });

  it("override がなければ base をそのまま返す", () => {
    const base = { a: "1" };
    expect(mergeMessages(base, undefined)).toBe(base);
  });

  it("base にないキーも足す", () => {
    expect(mergeMessages({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" });
  });
});

describe("同梱の辞書", () => {
  it("ja は en と同じキーをすべて持つ", () => {
    expect([...leafPaths(ja)].sort()).toEqual([...leafPaths(en)].sort());
  });

  it("どの文言も空ではない", () => {
    for (const path of leafPaths(en)) {
      const read = (root: unknown) =>
        path
          .split(".")
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root);
      expect(read(en), `en ${path}`).not.toBe("");
      expect(read(ja), `ja ${path}`).not.toBe("");
    }
  });
});
