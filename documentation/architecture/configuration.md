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
| `VITE_SEFER_OTLP_URL` | dev only | OTLP endpoint merged beside the observability ring |

The updater endpoint also has to reach `tauri.conf.json`, which cannot read the
environment. `tools/tauri/updaterConfig.ts` writes a config overlay from
`SEFER_UPDATER_HOST` (and the channel's product name and identifier), and the
Tauri build is invoked with `--config` pointing at it. See
[desktop host](desktop.md).

`.env*` files are never committed (this table is the reference; there is no `.env.example`). Do not add a second reader of
`import.meta.env`; add a field to `env.ts`.
