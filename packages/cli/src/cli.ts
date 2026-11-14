import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type CliConfig, parseArgs } from "./args";
import { openBrowser } from "./open-browser";
import { startServer } from "./server";

export const HELP = `db-viewer - browse tables and run SQL on PostgreSQL or SQLite in your browser

Usage:
  db-viewer <target>... [options]
  DATABASE_URL=postgres://... db-viewer [options]

Targets:
  postgres://... or postgresql://...   PostgreSQL
  a path ending in .db, .sqlite or .sqlite3   SQLite file

Options:
  --name <name>=<target>   Name a connection (repeatable)
  --write                  Allow writes (read-only by default)
  --port <number>          Port to listen on (default: a free port)
  --no-open                Do not open the browser
  -h, --help               Show this help
  -v, --version            Show the version

Prefer DATABASE_URL over a target argument for PostgreSQL: arguments stay in your shell history.
`;

export type Io = {
  readonly out: (text: string) => void;
  readonly error: (text: string) => void;
  readonly env: { readonly DATABASE_URL?: string | undefined };
  readonly open: (url: string) => void;
  // 終了の合図（SIGINT / SIGTERM）が来たら解決する
  readonly interrupted: Promise<void>;
};

const readVersion = (): string => {
  const path = fileURLToPath(new URL("../package.json", import.meta.url));
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version;
};

const uiDirectory = () => fileURLToPath(new URL("./ui", import.meta.url));

const describeMode = (config: CliConfig) =>
  config.write ? "write access enabled (--write)" : "read-only";

/** 戻り値は終了コード。 */
export const runCli = async (argv: ReadonlyArray<string>, io: Io): Promise<number> => {
  const parsed = parseArgs(argv, io.env);
  if (!parsed.ok) {
    io.error(`db-viewer: ${parsed.error.message}\nRun \`db-viewer --help\` for usage.\n`);
    return 2;
  }
  const command = parsed.value;
  if (command.kind === "help") {
    io.out(HELP);
    return 0;
  }
  if (command.kind === "version") {
    io.out(`${readVersion()}\n`);
    return 0;
  }

  const { config } = command;
  let running: Awaited<ReturnType<typeof startServer>>;
  try {
    running = await startServer(config, uiDirectory());
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown error";
    io.error(`db-viewer: ${message}\n`);
    return 1;
  }

  const url = `${running.url}#token=${running.token}`;
  io.out(`db-viewer is running (${describeMode(config)})\n${url}\n`);
  if (config.open) io.open(url);

  await io.interrupted;
  io.out("\nShutting down...\n");
  await running.close();
  return 0;
};

export const defaultIo = (): Io => ({
  out: (text) => process.stdout.write(text),
  error: (text) => process.stderr.write(text),
  env: process.env,
  open: openBrowser,
  interrupted: new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  }),
});
