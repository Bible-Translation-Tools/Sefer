# Configuration

Every URL Sefer talks to, and every dev telemetry switch, enters through a
Vite build-time variable read in exactly one place, `src/app/env.ts`. `tools/deploy/channels.ts` sets them per
channel; a dev build reads them from `.env.local`. An unset value is `null` and
the feature that needs it degrades visibly (a disabled panel, "not configured
for this build") rather than guessing a host. Names are `VITE_SEFER_`-prefixed
so they cannot collide with the v1 app's variables on one machine.

## The two network endpoints can be overridden at runtime

The build's values are DEFAULTS for the WACS endpoint and the Language API.
Somebody testing a deployed build has to be able to point it at the dev content
host, and a self-hoster at their own, without either waiting for a release — so
both are also preferences, on the Network card of `/settings`.

The one-reader rule survives the change rather than being bent by it.
`env.ts` is the one reader of every endpoint in `import.meta.env`;
`src/app/endpoints.ts` is the only reader of the override, and resolves `preference ?? build ?? null`.
Nothing else reads either, and there is still no fallback literal anywhere: an
endpoint nobody configured is `null` and says so.

Empty is not a value. A stored override of `""` means "use this build's",
which is what makes clearing the box an answer rather than a way to break the
application.

An override reaches the SCREENS immediately — they call `wacsUrlFor(settings,
host)` each time — and the SERVICES not at all, because `composeApplication()`
runs once and the transfer Layers close over the string they were handed. The
composition records the endpoints it built with (`rememberBootEndpoints`), and
the settings page's Network card offers a Reload exactly when
`endpointsChangedSinceBoot` says the preference has drifted from them. `endpoints.ts` carries a dated TODO
for making the endpoint live instead.

| variable                       | used by             | meaning                                                                                                                                                                                           |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SEFER_UPDATER_HOST`      | desktop updater     | updater worker base; the plugin appends `/{{target}}/{{current_version}}`, the version picker reads `/versions` and `/{{target}}/at/{{version}}`                                                  |
| `VITE_SEFER_WACS_WEB_URL`      | Web remote sync     | the ONE endpoint a browser build uses, for transfers and the Gitea API alike, WITH its scheme (`https://…`): a bare host becomes a clone URL isomorphic-git cannot parse. Overridable in Settings |
| `VITE_SEFER_WACS_DESKTOP_URL`  | desktop remote sync | the same for desktop, which needs no proxy and so is normally Gitea itself                                                                                                                        |
| `VITE_SEFER_WACS_APP_ID`       | Web remote sync     | what the proxy expects in `X-Requested-With`; empty sends none                                                                                                                                    |
| `VITE_SEFER_LANGUAGE_API_URL`  | shell               | language names and directions. Overridable in Settings                                                                                                                                            |
| `VITE_SEFER_OTLP_URL`          | dev only            | OTLP endpoint merged beside the observability ring; traces and logs only                                                                                                                          |
| `VITE_SEFER_OTLP_METRICS`      | dev only            | `1` to send OTLP metrics as well. Off by default — see below                                                                                                                                      |
| `VITE_SEFER_LOG` / `SEFER_LOG` | dev only            | the RAW sink: one JSONL line per event to stderr, under a Node-shaped host                                                                                                                        |
| `VITE_SEFER_STREAM`            | dev only            | console stream: `1` for every operation, or comma-separated name prefixes. A `!` prefix excludes: `!editor.selection` is everything except caret moves                                            |

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

## One endpoint, not a host and a proxy

There used to be two variables for WACS on the Web: a Gitea host and, in front
of it, a CORS proxy. They had to name the same content or every transfer failed
at the proxy, and nothing checked that they did.

There is one now, because the proxy is route-transparent — it answers on
Gitea's own paths — so the endpoint is simply the base of every URL and the
application cannot tell which of the two it is talking to. A deployment with
nothing in front of it gets its own URL here; one behind Cloudflare gets the
proxy's. isomorphic-git's `corsProxy` option is deliberately unused: its URL
shape (`/{host}/{owner}/{repo}.git/...`) is what forced the two variables
apart in the first place.

There is likewise no "which upstream should the proxy use" setting. Each proxy
deployment is pinned to one content host, so choosing the endpoint already
chose the content — one URL, one unambiguous answer to "what am I looking at".
Which is also why any build can be pointed at any environment from the Network
card: a production build that needs to look at dev WACS types the dev proxy's
URL, and does not need a special build to do it. See the proxy's own README in
`wacs-isomorphic-git-proxy`.

`.env*` files are never committed (this table is the reference; there is no `.env.example`). Do not add a second reader of a
`VITE_SEFER_*` variable; add a field to `env.ts`. That includes the dev-only
observability switches (`VITE_SEFER_OTLP_URL`, `VITE_SEFER_OTLP_METRICS`,
`VITE_SEFER_LOG`, `VITE_SEFER_STREAM`): composition passes them to
`src/platform/observability.ts`, which never reads the environment itself.
`import.meta.env.DEV` is different: it is a build-time constant Vite folds so
dev-only code is dropped from production, and it belongs wherever that branch
is. Do not read a network preference anywhere but `endpoints.ts`.
