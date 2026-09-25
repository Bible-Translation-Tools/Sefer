# Configuration

Every URL Sefer talks to, and every dev telemetry switch, enters through a
Vite build-time variable read in exactly one place, `src/app/env.ts`. `tools/deploy/channels.ts` sets them per
channel; a dev build reads them from `.env.local`. An unset value is `null` and
the feature that needs it degrades visibly (a disabled panel, "not configured
for this build") rather than guessing a host. Names are `VITE_SEFER_`-prefixed
so they cannot collide with the v1 app's variables on one machine.

## Three network concepts, three values

Which servers Sefer talks to is three separate questions, and each has one value:

- **Content host** — the Gitea a project comes from and publishes to (`https://content.bibletranslationtools.org`, `https://content.wacsdev.org`). It is the IDENTITY: what the UI prints, what `.git/config` stores as `origin`, what a saved sign-in is filed under. The same on the Web and on desktop.
- **Web transport** — how a browser reaches each content host: the proxy in front of it, which answers on Gitea's own paths because Gitea sends no CORS headers. Applied inside the HTTP clients at request time (`src/platform/web/remote.ts` for git, `webFetch` in `src/app/services.ts` for the Gitea API), never stored, never shown outside Advanced settings. Desktop has none: git2 is not a browser origin. Each proxy is pinned to one upstream, which is why this is a table of `host=proxy` pairs (`src/core/remote/transport.ts`) and not a free-text proxy URL.
- **Catalogue** — the Language API's GraphQL endpoint, which lists the repositories this app can open and each one's git URL. A row names its OWN server, so a catalogue can list repositories on more than one content host — the dev catalogue lists production repositories too — and the transport routes each. Reading and writing are separate layers: the catalogue decides what you can download, the content host where you sign in and publish.

The `X-Requested-With` app id the proxies gate on is not configured: `appIdFor` in `src/app/endpoints.ts` derives it from the channel the build already names (`sefer-prod`, `sefer-preview`, `sefer-dev`, `sefer-local` under the dev server).

## All three can be overridden at runtime

The build's values are DEFAULTS. Somebody testing a deployed build has to be able to point it at the dev content host, and a self-hoster at their own, without either waiting for a release — so all three are preferences too, on the Network card of `/settings`, which is drawn only when Advanced is showing. The transport is editable there only because a flags screen is where somebody debugging a proxy goes; a wrong pair breaks every transfer to that host.

The one-reader rule survives the change rather than being bent by it. `env.ts` is the one reader of every endpoint in `import.meta.env`; `src/app/endpoints.ts` is the only reader of the override, and resolves `preference ?? build ?? null`. Nothing else reads either, and there is no fallback literal in `src`: every hostname arrives from `tools/deploy/channels.ts` or an `.env` file. An endpoint nobody configured is `null` and says so.

Empty is not a value. A stored override of `""` means "use this build's", which is what makes clearing the box an answer rather than a way to break the application.

An override reaches the SCREENS immediately — they call `contentHostFor(settings)` each time — and the SERVICES not at all, because `composeApplication()` runs once and the transfer Layers close over the values they were handed. The composition records what it built with (`rememberBootEndpoints`); the Gitea fetch, which is built before `Settings` exists, reads the recorded transport per request (`bootTransport`) so the API and git never disagree; and the Network card offers a Reload exactly when `endpointsChangedSinceBoot` says a preference has drifted.

**No migration.** Sefer is alpha with no users to carry, so there is no shim: a Web project cloned before this change keeps a proxy `origin` until it is cloned again, and the old preferences (`network.wacsUrl`, `network.languageApiUrl`) are simply not read.

| variable                       | used by           | meaning                                                                                                                                                |
| ------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_SEFER_UPDATER_HOST`      | desktop updater   | updater worker base; the plugin appends `/{{target}}/{{current_version}}`, the version picker reads `/versions` and `/{{target}}/at/{{version}}`       |
| `VITE_SEFER_CONTENT_HOST`      | remote sync, both | the content host, WITH its scheme (`https://…`): a bare host becomes a clone URL isomorphic-git cannot parse. Overridable in Settings                  |
| `VITE_SEFER_WEB_TRANSPORT`     | Web remote sync   | `host=proxy,host=proxy`: how a browser reaches each content host. Every pair, not only this build's host. Overridable in Settings (Advanced)           |
| `VITE_SEFER_CATALOGUE_URL`     | projects page     | the Language API's GraphQL endpoint (`…/v1/graphql`). Overridable in Settings                                                                          |
| `VITE_SEFER_OTLP_URL`          | dev only          | OTLP endpoint merged beside the observability ring; traces and logs only                                                                               |
| `VITE_SEFER_OTLP_METRICS`      | dev only          | `1` to send OTLP metrics as well. Off by default — see below                                                                                           |
| `VITE_SEFER_LOG` / `SEFER_LOG` | dev only          | the RAW sink: one JSONL line per event to stderr, under a Node-shaped host                                                                             |
| `VITE_SEFER_STREAM`            | dev only          | console stream: `1` for every operation, or comma-separated name prefixes. A `!` prefix excludes: `!editor.selection` is everything except caret moves |

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

## A host and a proxy again — but only one of them is configured

There used to be two variables for WACS on the Web, a Gitea host and a CORS proxy in front of it; then one, the proxy, because it answers on Gitea's own paths and so could stand in for the host. That made the proxy the server's IDENTITY: it was printed on screen, stored as `origin`, and used as the credential key, and a project cloned in a browser named a URL desktop could not use.

The host and the proxy are apart again, and the difference from the first version is that the pairing is not something anyone keeps in sync by hand. The content host is the identity; the transport is a table that maps each host to its proxy and is applied at request time. isomorphic-git's `corsProxy` option stays unused — its URL shape (`/{host}/{owner}/{repo}.git/...`) is not the proxy's. See the proxy's own README in `wacs-isomorphic-git-proxy`.

`.env*` files are never committed (this table is the reference; there is no `.env.example`). Do not add a second reader of a
`VITE_SEFER_*` variable; add a field to `env.ts`. That includes the dev-only
observability switches (`VITE_SEFER_OTLP_URL`, `VITE_SEFER_OTLP_METRICS`,
`VITE_SEFER_LOG`, `VITE_SEFER_STREAM`): composition passes them to
`src/platform/observability.ts`, which never reads the environment itself.
`import.meta.env.DEV` is different: it is a build-time constant Vite folds so
dev-only code is dropped from production, and it belongs wherever that branch
is. Do not read a network preference anywhere but `endpoints.ts`.
