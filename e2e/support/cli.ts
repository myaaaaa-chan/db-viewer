import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../../packages/cli/dist/bin.js", import.meta.url));

export type RunningCli = {
  // フラグメント（トークン）付きの URL。ブラウザで開く
  readonly url: string;
  readonly origin: string;
  readonly token: string;
  readonly stop: () => Promise<number | null>;
  readonly output: () => string;
};

export type ExitedCli = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

const spawnCli = (args: ReadonlyArray<string>, env: Record<string, string>): ChildProcess => {
  if (!existsSync(BIN)) {
    throw new Error(`${BIN} がありません。先に pnpm build を実行してください。`);
  }
  return spawn(process.execPath, [BIN, ...args], {
    env: { ...process.env, DATABASE_URL: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
};

const exited = (child: ChildProcess) =>
  new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) resolve(child.exitCode);
    else child.once("exit", (code) => resolve(code));
  });

/** CLI を起動し、URL を表示するところまで待つ。 */
export const startCli = async (
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
): Promise<RunningCli> => {
  const child = spawnCli(["--no-open", ...args], env);
  let stdout = "";
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const url = await new Promise<string>((resolve, reject) => {
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      const found = /^(http:\/\/127\.0\.0\.1:\d+\/#token=\S+)$/m.exec(stdout);
      if (found?.[1] !== undefined) resolve(found[1]);
    });
    child.once("exit", (code) =>
      reject(new Error(`CLI が URL を出す前に終了した (code ${code})\n${stdout}\n${stderr}`)),
    );
  });

  const parsed = new URL(url);
  return {
    url,
    origin: parsed.origin,
    token: parsed.hash.replace("#token=", ""),
    output: () => stdout + stderr,
    stop: async () => {
      if (child.exitCode === null) child.kill("SIGINT");
      return exited(child);
    },
  };
};

/** 起動に失敗する（または --help のようにすぐ終わる）使い方を試す。 */
export const runCliToExit = async (
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
): Promise<ExitedCli> => {
  const child = spawnCli(args, env);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await exited(child);
  return { code, stdout, stderr };
};
