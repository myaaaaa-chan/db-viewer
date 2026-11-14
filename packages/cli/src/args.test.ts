import { describe, expect, it } from "vitest";
import { type CliConfig, parseArgs } from "./args";

const run = (argv: ReadonlyArray<string>, env: Record<string, string | undefined> = {}) =>
  parseArgs(argv, env);

const config = (argv: ReadonlyArray<string>, env: Record<string, string | undefined> = {}) => {
  const result = run(argv, env);
  if (!result.ok || result.value.kind !== "run") {
    throw new Error(`run の設定になるはず: ${JSON.stringify(result)}`);
  }
  return result.value.config;
};

const message = (argv: ReadonlyArray<string>, env: Record<string, string | undefined> = {}) => {
  const result = run(argv, env);
  if (result.ok) throw new Error("エラーになるはず");
  return result.error.message;
};

describe("parseArgs: 接続先の種類", () => {
  it("postgres:// と postgresql:// は PostgreSQL として扱い、DB 名を名前にする", () => {
    const c = config(["postgres://u:p@localhost:5432/app", "postgresql://u@h/other"]);
    expect(c.connections).toEqual([
      { name: "app", target: { kind: "postgres", url: "postgres://u:p@localhost:5432/app" } },
      { name: "other", target: { kind: "postgres", url: "postgresql://u@h/other" } },
    ]);
  });

  it(".db .sqlite .sqlite3 は SQLite として扱い、拡張子を除いたファイル名を名前にする", () => {
    const c = config(["./a.db", "/x/b.sqlite", "c.sqlite3"]);
    expect(c.connections.map((x) => [x.name, x.target])).toEqual([
      ["a", { kind: "sqlite", path: "./a.db" }],
      ["b", { kind: "sqlite", path: "/x/b.sqlite" }],
      ["c", { kind: "sqlite", path: "c.sqlite3" }],
    ]);
  });

  it("どちらでもない接続先はエラーにする", () => {
    expect(message(["mysql://x/y"])).toContain("mysql://x/y");
  });

  it("エラーの文面に接続文字列のパスワードを出さない", () => {
    const text = message(["mysql://user:secret@host/db"]);
    expect(text).not.toContain("secret");
  });
});

describe("parseArgs: --name", () => {
  it("--name 名前=接続先 で名前を付ける。= の後ろの = は接続先に含める", () => {
    const c = config(["--name", "main=postgres://u:p@h/db?x=1", "--name=cache=./c.sqlite"]);
    expect(c.connections).toEqual([
      { name: "main", target: { kind: "postgres", url: "postgres://u:p@h/db?x=1" } },
      { name: "cache", target: { kind: "sqlite", path: "./c.sqlite" } },
    ]);
  });

  it("名前が空、= がない、値がない場合はエラーにする", () => {
    expect(message(["--name", "=./a.db"])).toContain("--name");
    expect(message(["--name", "./a.db"])).toContain("--name");
    expect(message(["--name"])).toContain("--name");
  });

  it("名前が重複したら --name で指定するよう案内する", () => {
    const text = message(["./a/app.db", "./b/app.sqlite"]);
    expect(text).toContain("app");
    expect(text).toContain("--name");
  });

  it("名前を決められない接続先（DB 名がない URL）は --name を案内する", () => {
    expect(message(["postgres://u@h"])).toContain("--name");
  });
});

describe("parseArgs: DATABASE_URL", () => {
  it("接続先の引数がないときだけ使う", () => {
    expect(config([], { DATABASE_URL: "postgres://u:p@h/app" }).connections).toEqual([
      { name: "app", target: { kind: "postgres", url: "postgres://u:p@h/app" } },
    ]);
    expect(config(["./a.db"], { DATABASE_URL: "postgres://u:p@h/app" }).connections).toHaveLength(
      1,
    );
  });

  it("接続先がなく DATABASE_URL もなければエラーにする", () => {
    expect(message([])).toContain("DATABASE_URL");
    expect(message([], { DATABASE_URL: "" })).toContain("DATABASE_URL");
  });

  it("DATABASE_URL が不正でも、その値をエラーの文面に出さない", () => {
    expect(message([], { DATABASE_URL: "oracle://u:secret@h/x" })).not.toContain("secret");
  });
});

describe("parseArgs: オプション", () => {
  const base: CliConfig = {
    connections: [{ name: "a", target: { kind: "sqlite", path: "a.db" } }],
    write: false,
    port: undefined,
    open: true,
  };

  it("初期値は読み取り専用、ポート指定なし、ブラウザを開く", () => {
    expect(config(["a.db"])).toEqual(base);
  });

  it("--write と --no-open", () => {
    expect(config(["a.db", "--write", "--no-open"])).toEqual({
      ...base,
      write: true,
      open: false,
    });
  });

  it("--port は 0 から 65535 の整数だけ受け付ける", () => {
    expect(config(["a.db", "--port", "8080"]).port).toBe(8080);
    expect(config(["a.db", "--port=0"]).port).toBe(0);
    for (const bad of ["abc", "-1", "65536", "1.5", ""]) {
      expect(message(["a.db", `--port=${bad}`])).toContain("--port");
    }
    expect(message(["a.db", "--port"])).toContain("--port");
  });

  it("知らないオプションはエラーにする", () => {
    expect(message(["a.db", "--wirte"])).toContain("--wirte");
  });

  it("--help と --version は接続先がなくても通る", () => {
    expect(run(["--help"])).toEqual({ ok: true, value: { kind: "help" } });
    expect(run(["--version"])).toEqual({ ok: true, value: { kind: "version" } });
    expect(run(["-h"])).toEqual({ ok: true, value: { kind: "help" } });
  });
});
