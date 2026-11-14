import { describe, expect, it } from "vitest";
import { scrubSecrets } from "./connections";

const pg = (url: string) => ({ name: "x", target: { kind: "postgres", url } }) as const;

describe("scrubSecrets", () => {
  it("接続文字列のパスワードを、メッセージから隠す", () => {
    const text = scrubSecrets("password authentication failed for hunter2 (hunter2)", [
      pg("postgres://u:hunter2@h/db"),
    ]);
    expect(text).toBe("password authentication failed for *** (***)");
  });

  it("パーセントエンコードされたパスワードは、デコードした形でも隠す", () => {
    expect(scrubSecrets("bad p@ss", [pg("postgres://u:p%40ss@h/db")])).toBe("bad ***");
  });

  it("パスワードがない接続や SQLite はそのまま返す", () => {
    expect(
      scrubSecrets("boom", [
        pg("postgres://u@h/db"),
        { name: "y", target: { kind: "sqlite", path: "a.db" } },
      ]),
    ).toBe("boom");
  });
});
