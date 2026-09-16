# Build-time configuration

Every URL Sefer talks to is a Vite build-time variable read in exactly one
place, `src/app/env.ts`. The release workflow sets them per channel; a dev build
reads them from `.env.local`. An unset value is `null` and the feature that
needs it degrades visibly (a disabled panel, "not configured for this build")
rather than guessing a host. Names are `VITE_SEFER_`-prefixed so they cannot
collide with the v1 app's variables on one machine.

| variable | used by | meaning |
| --- | --- | --- |
| `VITE_SEFER_UPDATER_HOST` | desktop updater | updater worker base; the plugin appends `/{{target}}/{{current_version}}`, the version picker reads `/versions` and `/{{target}}/at/{{version}}` |
| `VITE_SEFER_GITEA_WEB_HOST` | Web remote sync | Gitea (WACS) base URL the Web build logs into and clones from |
| `VITE_SEFER_GITEA_DESKTOP_HOST` | desktop remote sync | Gitea base URL for the desktop build; may differ |
| `VITE_SEFER_GIT_CORS_PROXY_URL` | Web remote sync | CORS proxy in front of Gitea smart-HTTP for isomorphic-git |
| `VITE_SEFER_GIT_PROXY_X_REQUESTED_WITH` | Web remote sync | value the proxy expects in `X-Requested-With`; empty sends none |
| `VITE_SEFER_LANGUAGE_API_URL` | shell | language names and directions |
| `VITE_SEFER_OTLP_URL` | dev only | OTLP endpoint merged beside the observability ring; traces and logs only |
| `VITE_SEFER_OTLP_METRICS` | dev only | `1` to send OTLP metrics as well. Off by default — see below |
| `VITE_SEFER_LOG` / `SEFER_LOG` | dev only | the RAW sink: one JSONL line per event to stderr, under a Node-shaped host |
| `VITE_SEFER_STREAM` | dev only | console stream: `1` for every operation, or comma-separated name prefixes. A `!` prefix excludes: `!editor.selection` is everything except caret moves |

## Telemetry sends traces and logs, and metrics only when asked

`Otlp.layerJson` installs the logger, the metrics exporter and the tracer from
one call, which is convenient until a collector accepts two of the three.
motel, the collector we develop against, takes
`/v1/traces` and `/v1/logs` and answers `/v1/metrics` with nothing — so a build
that had asked for tracing got `POST /v1/metrics net::ERR_FAILED` on every
metrics interval, forever, in the console of somebody debugging something else.

So `composition.ts` installs the exporters one at a time and metrics are
opt-in. And the OTLP exporters get their own `fetch`, which warns ONCE and then
refuses every later export without a request: a collector that is not running
is the ordinary case in development, and the retry loop — not the first
failure — is what makes it unusable. Restarting the collector needs a page
reload, which is the right price for a console that stays readable.

The updater endpoint also has to reach `tauri.conf.json`, which cannot read the
environment. `tools/tauri/updaterConfig.ts` writes a config overlay from
`SEFER_UPDATER_HOST` (and the channel's product name and identifier), and the
Tauri build is invoked with `--config` pointing at it. See
[desktop host](desktop.md).

`.env*` files are never committed (this table is the reference; there is no `.env.example`). Do not add a second reader of
`import.meta.env`; add a field to `env.ts`.
