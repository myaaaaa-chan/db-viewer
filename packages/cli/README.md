# @myaaaaa_chan/db-viewer-cli

Browse tables, view data and run SQL on PostgreSQL or SQLite in your browser, with one command.
Part of db-viewer. See the repository README for the full guide.

```sh
# PostgreSQL. Prefer DATABASE_URL: command-line arguments stay in your shell history.
DATABASE_URL=postgres://user:pass@localhost:5432/app npx @myaaaaa_chan/db-viewer-cli

# SQLite
npx @myaaaaa_chan/db-viewer-cli ./app.db

# Several connections, named, with writes allowed
npx @myaaaaa_chan/db-viewer-cli --name main=postgres://... --name cache=./cache.sqlite --write
```

The command is `db-viewer`. It prints a URL such as `http://127.0.0.1:51234/#token=...` and opens it in your
browser. Stop it with Ctrl+C.

## Options

| Option                        | Description                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<target>...`                 | One or more targets. `postgres://` or `postgresql://` is PostgreSQL. A path ending in `.db`, `.sqlite` or `.sqlite3` is SQLite. Anything else is an error.              |
| `--name <name>=<target>`      | Give a target a name. Repeatable. Without it, the name is the database name (PostgreSQL) or the file name without its extension (SQLite). Duplicate names are an error. |
| `DATABASE_URL`                | Used when no target is given.                                                                                                                                           |
| `--write`                     | Allow writes on every connection. Read-only by default.                                                                                                                 |
| `--port <number>`             | Port to listen on. A free port by default.                                                                                                                              |
| `--no-open`                   | Do not open the browser.                                                                                                                                                |
| `-h, --help`, `-v, --version` |                                                                                                                                                                         |

Exit codes: `0` on a normal stop, `1` when it cannot start (cannot connect, port in use), `2` for wrong
arguments.

## Security

- It listens on `127.0.0.1` only.
- Each run creates a random token. The API rejects requests without it. The token travels in the URL fragment
  (`#token=...`), which browsers do not send to the server or in a `Referer`. The page removes it from the address
  bar as soon as it loads and keeps it in memory.
- Read-only is the default. `--write` is the only way to allow writes.
- Error messages never include the password of a connection string.
- Anyone who has the printed URL can run SQL with the privileges of the database user. Do not paste it into
  shared places, and connect as a database user that has only the privileges you need.
- SQLite is opened read-only without `--write`. A SQLite statement cannot be interrupted, so a heavy query blocks
  the process until it finishes (no statement timeout).

## Requirements

Node.js 20 or later. For PostgreSQL, the CLI starts with `SELECT 1` and stops with exit code `1` if it cannot
connect.
