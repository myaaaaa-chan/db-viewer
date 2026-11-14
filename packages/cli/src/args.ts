import { basename, extname } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { err, ok, type Result } from "@myaaaaa_chan/db-viewer-core";

export type ConnectionTarget =
  | { readonly kind: "postgres"; readonly url: string }
  | { readonly kind: "sqlite"; readonly path: string };

export type ConnectionSpec = { readonly name: string; readonly target: ConnectionTarget };

export type CliConfig = {
  readonly connections: ReadonlyArray<ConnectionSpec>;
  readonly write: boolean;
  // undefined なら空いているポートを使う
  readonly port: number | undefined;
  readonly open: boolean;
};

export type CliCommand =
  | { readonly kind: "run"; readonly config: CliConfig }
  | { readonly kind: "help" }
  | { readonly kind: "version" };

export type CliError = { readonly message: string };

const SQLITE_EXTENSIONS = [".db", ".sqlite", ".sqlite3"];

const fail = (message: string): Result<never, CliError> => err({ message });

// エラーの文面に出す接続先から、URL のパスワード部分を隠す。
export const redactTarget = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.password === "") return value;
    url.password = "***";
    return url.toString();
  } catch {
    return value;
  }
};

const isPostgresUrl = (value: string) => /^postgres(ql)?:\/\//i.test(value);

const targetOf = (value: string): ConnectionTarget | null => {
  if (isPostgresUrl(value)) return { kind: "postgres", url: value };
  if (SQLITE_EXTENSIONS.includes(extname(value).toLowerCase())) {
    return { kind: "sqlite", path: value };
  }
  return null;
};

const defaultNameOf = (target: ConnectionTarget): string => {
  if (target.kind === "sqlite") return basename(target.path, extname(target.path));
  try {
    return decodeURIComponent(new URL(target.url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
};

type Raw = { readonly name: string | undefined; readonly value: string };

const specOf = ({ name, value }: Raw): Result<ConnectionSpec, CliError> => {
  const target = targetOf(value);
  if (target === null) {
    return fail(
      `Unsupported connection target: ${redactTarget(value)}\n` +
        "Use postgres://... or postgresql://... for PostgreSQL, or a path ending in .db, .sqlite or .sqlite3 for SQLite.",
    );
  }
  const resolved = name ?? defaultNameOf(target);
  if (resolved === "") {
    return fail(
      `Cannot derive a connection name from ${redactTarget(value)}. Give one with --name <name>=<target>.`,
    );
  }
  return ok({ name: resolved, target });
};

const splitNamed = (entry: string): Result<Raw, CliError> => {
  const at = entry.indexOf("=");
  if (at <= 0 || at === entry.length - 1) {
    return fail("--name expects <name>=<target>, for example --name main=./app.db.");
  }
  return ok({ name: entry.slice(0, at), value: entry.slice(at + 1) });
};

const parsePort = (value: string): Result<number, CliError> => {
  const port = Number(value);
  if (value === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
    return fail("--port expects an integer from 0 to 65535.");
  }
  return ok(port);
};

const collect = <T>(items: ReadonlyArray<T>, convert: (item: T) => Result<Raw, CliError>) => {
  const raws: Array<Raw> = [];
  for (const item of items) {
    const raw = convert(item);
    if (!raw.ok) return raw;
    raws.push(raw.value);
  }
  return ok(raws);
};

const toSpecs = (raws: ReadonlyArray<Raw>): Result<ReadonlyArray<ConnectionSpec>, CliError> => {
  const specs: Array<ConnectionSpec> = [];
  for (const raw of raws) {
    const spec = specOf(raw);
    if (!spec.ok) return spec;
    if (specs.some((existing) => existing.name === spec.value.name)) {
      return fail(
        `The connection name "${spec.value.name}" is used more than once. Give each one a name with --name <name>=<target>.`,
      );
    }
    specs.push(spec.value);
  }
  return ok(specs);
};

/**
 * 05_CLI §2。argv は process.argv.slice(2)、env は process.env を渡す。
 * エラーの文面に、接続文字列のパスワードは含めない。
 */
export const parseArgs = (
  argv: ReadonlyArray<string>,
  env: { readonly DATABASE_URL?: string | undefined },
): Result<CliCommand, CliError> => {
  let parsed: ReturnType<typeof parseNodeArgs<ParseConfig>>;
  try {
    parsed = parseNodeArgs({ args: [...argv], ...PARSE_CONFIG });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "Invalid arguments.");
  }
  const { values, positionals } = parsed;
  if (values.help) return ok({ kind: "help" });
  if (values.version) return ok({ kind: "version" });

  let port: number | undefined;
  if (values.port !== undefined) {
    const result = parsePort(values.port);
    if (!result.ok) return result;
    port = result.value;
  }

  const named = collect(values.name ?? [], splitNamed);
  if (!named.ok) return named;
  const positional = collect(positionals, (value) => ok({ name: undefined, value }));
  if (!positional.ok) return positional;
  const fromEnv =
    positional.value.length + named.value.length === 0 && env.DATABASE_URL
      ? [{ name: undefined, value: env.DATABASE_URL }]
      : [];
  const raws = [...positional.value, ...named.value, ...fromEnv];
  if (raws.length === 0) {
    return fail(
      "No connection target. Pass a target, for example `db-viewer ./app.db`, or set DATABASE_URL.",
    );
  }

  const connections = toSpecs(raws);
  if (!connections.ok) return connections;
  return ok({
    kind: "run",
    config: {
      connections: connections.value,
      write: values.write === true,
      port,
      open: values["no-open"] !== true,
    },
  });
};

const PARSE_CONFIG = {
  allowPositionals: true,
  strict: true,
  options: {
    name: { type: "string", multiple: true },
    write: { type: "boolean" },
    port: { type: "string" },
    "no-open": { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
} as const;

type ParseConfig = typeof PARSE_CONFIG;
