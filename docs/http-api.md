# HTTP API And Remote MCP

Available in do-md 1.4.0. HTTP API version: **1**.

## Start The Service

```sh
do-md serve --root /workspace --host 0.0.0.0 --port 8080
```

`--root` must name an existing directory. The default listener is
`127.0.0.1:8080`; an explicit port `0` requests an OS-assigned port, printed to
stderr when ready. The service does not start when imported as a library.

| Option | Default | Meaning |
| --- | --- | --- |
| `--max-input-bytes` | 1048576 | Per-file UTF-8 input limit |
| `--timeout-ms` | 30000 | Command deadline; also bounds incomplete HTTP requests |
| `--max-body-bytes` | 1048576 | Maximum JSON request size |
| `--max-response-bytes` | 8388608 | Maximum serialized command response |
| `--max-concurrency` | 4 | Active calls, including requests still sending bodies |
| `--no-snippets` | off | Omit document snippets from diagnostics |

Limits must be positive integers. Requests can tighten input/deadline/snippet
settings but cannot increase server limits. Oversized results fail explicitly;
JSON is never silently truncated. SIGTERM/SIGINT stops admission, cancels owned
workers, closes connections, and exits. Status and template logs use stderr.

## Routes

- `GET /healthz`: `{ ok, version, apiVersion, requestId }`.
- `GET /v1/capabilities`: command names and strict JSON input schemas, package
  version, API version, and configured limits. Optional `?directory=...` verifies
  that a selected directory exists and is allowed.
- `POST /v1/commands/<name>`: execute a command with a JSON body.

Request example:

```json
{
  "directory": "project",
  "params": { "file": "notes.md", "template": "notes.md.template" },
  "limits": { "timeoutMs": 5000, "maxInputBytes": 65536, "noSnippets": true }
}
```

`directory` and `limits` are optional. If directory is omitted, use the server
root. Relative directories resolve against that root. Absolute directories must
be inside it. All paths within params resolve against the selected directory,
and must remain within **that directory**, not only the larger server root.

## Commands

| Name | JSON parameters |
| --- | --- |
| `validate` | `file`, `template`, optional `options` |
| `export` | `file`, `template`, optional `savePath`, `options` |
| `create` | `template`, `data` object; optional `file`, `force`, `options` |
| `set` | `file`, `template`, `key`/`value` and/or `patch` object; optional `out`, `dryRun`, `options` |
| `render` | `file`, `parseTemplate`, `renderTemplate`, `outFile`; optional `dryRun`, `options` |
| `match` | `file`, `templates` path/directory/glob; optional `all`, `options` |
| `query` | `file`, `template`; optional `all`, `options` |
| `reference` | optional `topic`, `format` (`json`, `markdown`, or `text`) |

Data and patch values are inline JSON, corresponding to CLI-loaded data/patch
files. `export` returns context inline and writes only when `savePath` is given.
`create` without a file returns generated Markdown without writing. `dryRun`
suppresses `set` and `render` writes. Existing atomic-write, conflict, and
overwrite behavior is preserved.

Responses contain the library Result fields `ok`, `exitCode`, `output`,
`context`, and `errors`, plus `apiVersion` and `requestId`. `match` and `query`
also contain `matches`; `reference` contains `reference`; mutating operations
include `wrote` when applicable.

```json
{
  "ok": true,
  "exitCode": 0,
  "output": null,
  "context": { "title": "Hello" },
  "errors": [],
  "apiVersion": 1,
  "requestId": "unique-request-id"
}
```

A completed command uses HTTP 200 even for a document parse failure. Check
`ok` and `exitCode`: 1 user error, 2 document mismatch, 3 template error, 4 I/O
or write conflict. Invalid JSON/envelopes/arguments use 400, unknown routes or
commands 404, wrong method 405, incomplete request timeout 408, excessive bodies 413, unsupported content type
415, overload 503, deadline/cancellation 504, and unexpected execution or
excessive-output errors 500. Error bodies include structured diagnostics.

## MCP Local And Remote Modes

```sh
# Local workers, local filesystem.
do-md-mcp --root /home/user/project

# HTTP workers, remote filesystem. Equivalent flags work with `do-md mcp`.
do-md-mcp --host do-md --port 8080 --root /workspace/project
do-md-mcp --url https://tools.example.com/do-md/ --root project
```

Host or port enables remote mode; the missing counterpart defaults to
`127.0.0.1` or `8080`. Host/port uses HTTP. `--url` supports HTTPS and a proxy
prefix, and cannot be combined with host/port. Redirects are not followed.
Remote mode requires no locally accessible root. Its startup checks remote
capabilities and the selected directory. Later failures are structured MCP
errors, with no local fallback. This is an HTTP execution proxy behind stdio
MCP, not a Streamable HTTP MCP endpoint.

MCP's existing per-tool response shapes are preserved. The reference tool and
both template-language resources are fetched remotely in dispatch mode. Limits
can be tightened with the existing `--max-input-bytes`, `--timeout-ms`, and
`--no-snippets` flags; `--max-response-bytes` bounds HTTP responses received by
the proxy. A transport grace period of five seconds follows the effective
server deadline.

Disconnects, cancellation, and deadlines terminate the owned worker. Commands
are never retried automatically: a write may have committed before a connection
or deadline failure. Cancellation does not promise rollback.

## Filesystem And Deployment

For a host path `/home/user/project` mounted in Docker at `/workspace/project`,
configure remote MCP `--root /workspace/project` and pass `file: "notes.md"`.
An MCP client without that local directory can operate on the same mounted
files. There is no upload, synchronization, or automatic path-prefix mapping.

Service-managed reads, writes, glob prefixes/candidates, and template I/O are
checked for directory containment, including symlinks and missing output files.
Templates are trusted JavaScript and can use Node APIs directly; these path
checks are not a JavaScript sandbox. Container mounts and process permissions
define the execution boundary. The default listener is local, no HTTP
authentication or CORS layer is installed, and private deployment uses the
surrounding network/proxy access controls.

## Docker

The optional image uses rolling `node:alpine`, installs production dependencies
from the lockfile, runs as the non-root `node` user, and has a health check on
port 8080. Files persist in the bind-mounted workspace; there is no database.
Match the configured UID/GID to workspace ownership and back up that directory.

```sh
docker build --pull --no-cache -t do-md .
```

For Compose, copy `compose.example.yaml` to the project, set `DO_MD_SOURCE` to
the source checkout and `DO_MD_WORKSPACE` to the shared directory, then run:

```sh
docker compose -f compose.example.yaml up -d --build
```

The example declares port 8080 only on its internal Compose network. Another
container on that network uses `--host do-md --port 8080`. For a host client,
explicitly configure a loopback port mapping (for example
`127.0.0.1:8080:8080`) or an existing private proxy route. The example also uses
an init process, bounded Docker logs, and a shutdown grace period. No active
Nestbox configuration is modified by installing this package.
