// Packs the publishable packages and checks them the way a consumer would use them.
//   node scripts/consumer-check.mjs pack   <dir>
//   node scripts/consumer-check.mjs smoke  <dir>
//   node scripts/consumer-check.mjs types  <dir> <typescript-version>
//   node scripts/consumer-check.mjs types-sqlite <dir> <typescript-version>
//     (pg, pg-cursor and @types/pg are not installed: the types of a SQLite-only consumer)
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [mode, dirArg, tsVersion] = process.argv.slice(2);
if (!mode || !dirArg) {
  console.error("usage: consumer-check.mjs <pack|smoke|types|types-sqlite> <tarball-dir> [typescript-version]");
  process.exit(2);
}
const tarballDir = resolve(dirArg);

const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: process.env });

const publishable = () =>
  readdirSync(join(root, "packages"))
    .map((d) => join(root, "packages", d))
    .filter((d) => {
      try {
        return JSON.parse(readFileSync(join(d, "package.json"), "utf8")).private !== true;
      } catch {
        return false;
      }
    });

const pack = () => {
  mkdirSync(tarballDir, { recursive: true });
  for (const dir of publishable()) run("pnpm", ["pack", "--pack-destination", tarballDir], dir);
};

const tarballs = () => {
  const files = readdirSync(tarballDir).filter((f) => f.endsWith(".tgz"));
  const byName = {};
  for (const f of files) {
    const short = f.replace(/^myaaaaa_chan-db-viewer-/, "").replace(/-\d.*\.tgz$/, "");
    byName[`@myaaaaa_chan/db-viewer-${short}`] = join(tarballDir, f);
  }
  if (Object.keys(byName).length === 0) throw new Error(`no tarballs in ${tarballDir}`);
  return byName;
};

const peers = {
  "@hono/node-server": "^2.1.8",
  "@types/better-sqlite3": "^9.6.0",
  "@types/node": "^20.19.0",
  "@types/pg": "^8.23.1",
  "@types/react": "^19.3.0",
  "@types/react-dom": "^19.3.0",
  // better-sqlite3 13 needs Node 22 or later (it crashes on Node 20), so Node 20 uses 12
  "better-sqlite3": Number(process.versions.node.split(".")[0]) < 22 ? "^12.0.0" : "^13.1.1",
  hono: "^4.13.18",
  pg: "^8.23.1",
  "pg-cursor": "^2.22.1",
  react: "^19.3.1",
  "react-dom": "^19.3.1",
};

const postgresPackages = ["pg", "pg-cursor", "@types/pg"];

const consumer = (extra, { withPostgres = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "dbv-consumer-"));
  const installedPeers = Object.fromEntries(
    Object.entries(peers).filter(([name]) => withPostgres || !postgresPackages.includes(name)),
  );
  const files = tarballs();
  const fileDeps = Object.fromEntries(Object.entries(files).map(([n, p]) => [n, `file:${p}`]));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "consumer",
        private: true,
        type: "module",
        dependencies: { ...fileDeps, ...installedPeers, ...extra },
        overrides: fileDeps,
      },
      null,
      2,
    ),
  );
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir);
  return dir;
};

const smoke = () => {
  const dir = consumer({});
  writeFileSync(
    join(dir, "smoke.mjs"),
    `import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as core from "@myaaaaa_chan/db-viewer-core";
import * as react from "@myaaaaa_chan/db-viewer-react";
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";
import { toNodeHandler } from "@myaaaaa_chan/db-viewer-server/node";
assert.equal(typeof core.createHttpDataSource, "function");
assert.equal(typeof react.DbViewer, "function");
assert.equal(typeof toNodeHandler, "function");
const db = new Database(":memory:");
db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, 'a')");
const handler = createHandler({ connections: { main: sqliteAdapter(db) }, authorize: () => true });
const post = (body) => handler(new Request("http://x/rpc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const res = await post({ op: "listConnections" });
assert.equal(res.status, 200);
assert.equal((await res.json()).ok, true);
assert.equal((await handler(new Request("http://x/rpc"))).status, 405);
console.log("smoke ok on node", process.version);
`,
  );
  run("node", ["smoke.mjs"], dir);
};

const typeCheck = (dir, source) => {
  writeFileSync(join(dir, "use.ts"), source);
  for (const moduleResolution of ["Bundler", "NodeNext"]) {
    const module = moduleResolution === "NodeNext" ? "NodeNext" : "ESNext";
    writeFileSync(
      join(dir, `tsconfig.${moduleResolution}.json`),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          module,
          moduleResolution,
          target: "ES2022",
          lib: ["ES2023", "DOM"],
          jsx: "react-jsx",
          types: ["node"],
        },
        files: ["use.ts"],
      }),
    );
    console.log(`tsc ${tsVersion} (${moduleResolution})`);
    run("npx", ["tsc", "-p", `tsconfig.${moduleResolution}.json`], dir);
  }
};

const types = () => {
  if (!tsVersion) throw new Error("typescript version is required");
  typeCheck(
    consumer({ typescript: tsVersion }),
    `import { createHttpDataSource, DbViewer, type DataSource } from "@myaaaaa_chan/db-viewer-react";
import { createHandler, postgresAdapter, sqliteAdapter, type DbAdapter } from "@myaaaaa_chan/db-viewer-server";
import { toNodeHandler } from "@myaaaaa_chan/db-viewer-server/node";
import { columnName } from "@myaaaaa_chan/db-viewer-core";
import { createElement } from "react";

export const ds: DataSource = createHttpDataSource({ endpoint: "/db" });
export const element = createElement(DbViewer, { dataSource: ds, language: "ja", theme: "dark" });
export const handler = createHandler({ connections: {}, authorize: () => true });
export const node = toNodeHandler(handler);
export const adapters: ReadonlyArray<(...a: never[]) => DbAdapter> = [postgresAdapter, sqliteAdapter];
export const col = columnName;
`,
  );
};

// pg and @types/pg are optional peers. A SQLite-only consumer does not install them, so the
// published declarations must not import "pg" (skipLibCheck is false).
const typesSqlite = () => {
  if (!tsVersion) throw new Error("typescript version is required");
  typeCheck(
    consumer({ typescript: tsVersion }, { withPostgres: false }),
    `import Database from "better-sqlite3";
import { createHandler, sqliteAdapter } from "@myaaaaa_chan/db-viewer-server";
import { toNodeHandler } from "@myaaaaa_chan/db-viewer-server/node";

export const handler = createHandler({
  connections: { main: sqliteAdapter(new Database(":memory:")) },
  authorize: () => true,
});
export const node = toNodeHandler(handler);
`,
  );
};

const modes = { pack, smoke, types, "types-sqlite": typesSqlite };
const selected = modes[mode];
if (!selected) throw new Error(`unknown mode ${mode}`);
selected();
