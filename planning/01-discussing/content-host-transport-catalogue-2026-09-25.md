# Content host, transport, catalogue: untangling the network configuration

**Status:** discussing, 2026-09-25. Agreed in outline with Will; nothing built. Sequenced AFTER PR #1 (`sidebar-update`) merges, because that PR rewrites `src/app/catalogue.ts` and the landing screens, and doing this first would hand the designer conflicts in plumbing he never touches.

## The smell

One decision causes every symptom: **the proxy URL is treated as the server's identity.** `VITE_SEFER_WACS_WEB_URL` is `https://wacs-proxy.…`, and because it is the one value anybody configures, it is also:

- what the UI prints: production shows "Clone a repository you can write from https://wacs-proxy.bttdev.org." (`ImportHub.tsx:410`). Nobody should ever see that a proxy exists.
- what a Web clone writes into `.git/config` as `origin` (`src/platform/web/remote.ts`, `onEndpoint` runs before `git.clone`). A project cloned in a browser says it came from the proxy, and that remote is useless on desktop, where git2 needs the content host.
- what saved credentials are keyed by (`credentials.get(hostOf(url))`), so a sign-in is filed under the proxy host rather than the Gitea it belongs to.

The env vars grew around it: a `WEB`/`DESKTOP` pair that only differ because one is the proxy, an app id nobody needs to choose, and four dead names still in local `.env` files.

## Three concepts, three layers

**1. Content host — the identity.** A Gitea base URL: `https://content.bibletranslationtools.org` (prod) or `https://content.wacsdev.org` (dev). It is what the UI shows, what `.git/config` stores, what credentials are keyed by, and where sign-in and publishing go by default. ONE value for both hosts; the web/desktop split disappears.

**2. Transport — Web only, never shown.** A fixed table in code (an infrastructure fact, like `tools/deploy/channels.ts`), not an env var:

| content host                        | Web transport                                  |
| ----------------------------------- | ---------------------------------------------- |
| `content.bibletranslationtools.org` | `https://wacs-proxy.bibletranslationtools.org` |
| `content.wacsdev.org`               | `https://wacs-proxy.bttdev.org`                |

The Web git `http` client and the Gitea fetch rewrite origin → proxy **at request time**; nothing stores the rewritten URL. Each proxy is pinned to one upstream, which is exactly why a per-host table is correct and a free-text proxy field is not. Desktop never consults it: git2 is not a browser origin. A host not in the table (GitHub, a self-hoster) is tried directly; on the Web that likely fails CORS, and the error says "this host can't be reached from a browser" rather than a bare network failure.

The `X-Requested-With` app id is derived from the build channel (`sefer-dev` / `sefer-preview` / `sefer-prod`; `sefer-local` under `pnpm dev`). Verified 2026-09-25: the prod proxy answers a clone of `rbnswartz/merged-abz` with 200 for either `sefer-dev` or `sefer-prod`, 403 with no header, and CORS is `*` (so `sefer-dev.bttdev.org` and the `*.workers.dev` branch aliases both work).

**3. Catalogue — where in the outside world repos live.** Contract: a list of languages, each with a `gitUrl`. Rename `cloneUrl` → `gitUrl` on `CatalogueEntry`: the catalogue says where a repo lives, not how we fetch it. No zip variant until something serves zips; adding `{ kind: "zip" }` later is local.

Bake GraphQL in. The REST path we use today is Hasura's REST wrapper over the same `vw_consolidated_repos` view; both deployments serve GraphQL at `/v1/graphql`, so the setting becomes the API base and the query lives in `catalogue.ts`. That also lets us ask for fields the table lacks (`updated_at`) without anyone publishing a new REST endpoint.

- prod: `https://api.bibleineverylanguage.org/v1/graphql` (561 rows, all on the prod content host)
- dev: `https://api-biel-dev.walink.org/v1/graphql` (47 rows, verified 2026-09-25)

The dev catalogue lists repos on BOTH `content.bibletranslationtools.org` and `content.wacsdev.org`. That settles the worry that the catalogue is "tied to" a WACS: it is tied by DATA, not by configuration. Each row carries an absolute URL and the transport table routes it. Swapping the catalogue alone is coherent, and so is writing somewhere else — read and write really are separate layers.

## Env vars after

```
VITE_SEFER_CONTENT_HOST=https://content.bibletranslationtools.org
VITE_SEFER_CATALOGUE_URL=https://api.bibleineverylanguage.org/v1/graphql
VITE_SEFER_STREAM='!editor.selection'        # dev-only switches unchanged
```

| today                                   | after                                                              |
| --------------------------------------- | ------------------------------------------------------------------ |
| `VITE_SEFER_WACS_WEB_URL`               | `VITE_SEFER_CONTENT_HOST` (the Gitea, not the proxy)               |
| `VITE_SEFER_WACS_DESKTOP_URL`           | merged into `VITE_SEFER_CONTENT_HOST`                              |
| `VITE_SEFER_WACS_APP_ID`                | derived from the channel; gone                                     |
| `VITE_SEFER_LANGUAGE_API_URL`           | `VITE_SEFER_CATALOGUE_URL` (it lists repos, not language names)    |
| `VITE_SEFER_GITEA_WEB_HOST`             | already read nowhere — delete from `.env`                          |
| `VITE_SEFER_GIT_CORS_PROXY_URL`         | already read nowhere — delete                                      |
| `VITE_SEFER_GIT_PROXY_X_REQUESTED_WITH` | already read nowhere — delete                                      |
| `VITE_SEFER_GITEA_DESKTOP_HOST`         | only a stale comment in `src/platform/tauri/remote.ts:48` — delete |

## Defaults and settings

- **Channel defaults** (`tools/deploy/channels.ts`): production and preview → prod content host, prod catalogue. dev → dev content host, dev catalogue — which, because the dev catalogue lists prod repos too, stops the dev channel falling back to the sample catalogue. The sample catalogue stays for a build given no catalogue URL at all.
- **Settings, Network card → Advanced (hidden by default)** shows all three:
  - Content host (sign-in and publishing) — editable.
  - Catalogue — editable.
  - Transport — read-only, one line per mapped host ("Web requests to content.bibletranslationtools.org go through wacs-proxy.bibletranslationtools.org"). Useful for debugging; the only place the word proxy appears in the product.
  - Reading from the dev catalogue while publishing to prod is just two fields set differently.

## Migration

- Web projects already cloned have the proxy as `origin`. On open, reverse-map through the table (proxy → content host) and rewrite `origin` once.
- A stored `wacsUrl` preference holding a proxy URL reverse-maps the same way; a `languageApiUrl` preference holding the REST URL maps to the `/v1/graphql` base of the same host.
- Credentials filed under a proxy host: re-key on first read, or accept one fresh sign-in. Decide when building; one sign-in is probably proportionate.

## Touches

`src/app/env.ts`, `src/app/endpoints.ts`, `tools/deploy/channels.ts` (+ `channelEnv.ts` output), `src/platform/web/remote.ts` (drop `onEndpoint` at clone/attach; rewrite in the http client), the Web Gitea fetch in `src/app/services.ts`, `src/app/catalogue.ts` (GraphQL, `gitUrl`), the Settings Network card, the copy in `ImportHub.tsx` / `commands.ts`, and a rewrite of `documentation/architecture/configuration.md` (its "One endpoint, not a host and a proxy" section is the decision this reverses — the host and the proxy come back apart, but the proxy is now derived, never configured). Existing tests updated; no new ones, per the build-out rule.

## Open

- Does anything besides the table need to know a host is "WACS" (e.g. the Cloud panel's sign-in wording)? Probably not; the content host's hostname is enough to print.
- Unmapped host on the Web: try direct and explain the failure (proposed), or refuse up front? Trying direct keeps an unprotected Gitea with CORS working.
