import type { Client } from "pg";
import type Cursor from "pg-cursor";

// pg と pg-cursor は optional な peerDependencies（ADR 001）。SQLite だけを使う利用者の import が
// 失敗しないよう、使う時点で読み込む。

export class DriverNotInstalledError extends Error {
  constructor(packageName: string) {
    super(`${packageName} is not installed. Run: npm install ${packageName}`);
    this.name = "DriverNotInstalledError";
  }
}

const load = async <T>(packageName: string, importPackage: () => Promise<T>): Promise<T> => {
  try {
    return await importPackage();
  } catch (cause) {
    const notFound =
      cause instanceof Error && "code" in cause && cause.code === "ERR_MODULE_NOT_FOUND";
    throw notFound ? new DriverNotInstalledError(packageName) : cause;
  }
};

// CommonJS の module.exports は default に入る（pg 8.15 以降の ESM 版は名前付きの export も持つ）
export const loadClient = async (): Promise<typeof Client> => {
  const pg = await load("pg", () => import("pg"));
  return (pg.default ?? pg).Client;
};

export const loadCursor = async (): Promise<typeof Cursor> => {
  const cursor = await load("pg-cursor", () => import("pg-cursor"));
  return cursor.default;
};
