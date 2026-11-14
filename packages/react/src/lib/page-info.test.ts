import { describe, expect, it } from "vitest";
import { pageInfo } from "./page-info";

describe("pageInfo", () => {
  it("最初のページは 1 行目から始まり、前へは押せない", () => {
    expect(pageInfo({ page: 0, limit: 100, rowCount: 100, total: null })).toEqual({
      from: 1,
      to: 100,
      hasPrev: false,
      hasNext: true,
    });
  });

  it("件数が分からないときは、ページが満杯でなければ次はないものとして扱う", () => {
    expect(pageInfo({ page: 2, limit: 100, rowCount: 37, total: null })).toEqual({
      from: 201,
      to: 237,
      hasPrev: true,
      hasNext: false,
    });
  });

  it("件数が分かっているときは、残りがあるかどうかで次を決める", () => {
    expect(pageInfo({ page: 0, limit: 100, rowCount: 100, total: 100 }).hasNext).toBe(false);
    expect(pageInfo({ page: 0, limit: 100, rowCount: 100, total: 101 }).hasNext).toBe(true);
  });

  it("行がないページは from と to を null にする", () => {
    expect(pageInfo({ page: 0, limit: 100, rowCount: 0, total: null })).toEqual({
      from: null,
      to: null,
      hasPrev: false,
      hasNext: false,
    });
  });
});
