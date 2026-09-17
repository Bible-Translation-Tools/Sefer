# RFC: one WACS proxy, not a public header (2026-09-17)

**Status:** proposed.
**Subject:** `~/Documents/Work/Code/wacs-isomorphic-git-proxy` (`wacs-browser-git-proxy`).
**Sefer side:** `src/core/remote/gitea.ts`, `src/platform/web/remote.ts`.
**Filed here** rather than in `tools/` because `tools/` is this repo's build scripts; move it if you'd rather it sat with them.

## The problem

`content.bibletranslationtools.org` sits behind Cloudflare. A browser hitting it
directly gets the managed challenge — `cf-mitigated: challenge`, the "Just a
moment…" interstitial — which to `fetch` is an opaque CORS failure. In Sefer
that surfaces as **"Failed to fetch"** immediately after a successful sign-in,
which reads like a credential problem and is not one.

Sefer talks to that host in **two** places, and only one of them is proxied:

| caller | route | today |
|---|---|---|
| `platform/web/remote.ts` | git smart-HTTP | through the Worker ✅ |
| `core/remote/gitea.ts` | `/api/v1/*` — sign in, list repos, create | **direct** ❌ |

`gitea.ts:244` builds `${host}${path}` and hands it to an injected `fetch`. Every
API read therefore hits the challenge.

## Why not the header rule

A Cloudflare skip rule on `http.request.headers["x-requested-with"][*] eq
"sefer"` makes the app work today. It is the wrong long-term shape, for the
reason Will named: **it is an infra bypass, and the key is public.** The header
ships in a client bundle; anyone who opens devtools has it, and from then on the
rule is a documented way for anything at all to skip bot protection on the whole
origin — not just Sefer, and not just the endpoints Sefer needs.

Measured while writing this, the rule is also currently skipping for everyone:
`/api/v1/version`, `/api/v1/repos/…`, `.git/info/refs` and `/` all answer **200
with no header at all**. Whatever it is matching, it is not the header.

The Worker is the right place because it already solves this correctly: the gate
(`ALLOWED_APPS_CSV`) lives **server-side**, and the header never has to be a
secret because the browser is not the thing being trusted — the Worker is.

## What changes

Generalise the Worker from "the git endpoints" to "the WACS surface Sefer
needs", keeping every property it already has.

Today, one route class, matched exactly:

```js
/^\/[^/]+\/[^/]+\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/
```

Proposed: **named route classes**, each with its own method and path rules,
resolved by the same `classify` step:

- **`git`** — unchanged, byte for byte. It is correct and it is load-bearing.
- **`api`** — `/api/v1/*`, on an explicit path allowlist, not a wildcard.

The allowlist for `api` is the point of the whole design and should be written
as a list, because Gitea's API is large and most of it is not ours:

| path | methods | what it is for |
|---|---|---|
| `/api/v1/version` | GET | reachability check |
| `/api/v1/user` | GET | who is signed in |
| `/api/v1/users/{u}/tokens` | GET, POST, DELETE | sign in / out |
| `/api/v1/user/repos` | GET | the repos a person can write |
| `/api/v1/repos/{owner}/{repo}` | GET, POST | one repo; create |

Everything else stays 404, exactly as a non-git path does today.

## What must NOT change

These are the properties that make the current Worker good, and the review
should check each one survives:

- **Upstream is pinned.** `buildUpstreamUrl` refuses a host that is not
  `UPSTREAM_GIT_BASE_URL`. Without that the Worker is an open relay, and a
  generic proxy is exactly where that mistake gets made. (The var wants renaming
  to `UPSTREAM_BASE_URL` once it is not only git.)
- **The app gate stays server-side.** `ALLOWED_APPS_CSV`, checked before
  anything is forwarded.
- **Headers stay allowlisted** in both directions. `authorization` is already
  forwarded, so the `api` class needs no new header.
- **`redirect: "manual"`.** A proxy that follows redirects can be walked off the
  pinned host.
- **Preflight stays strict.** `handlePreflight` validates the requested method
  against the route class; the `api` class needs its own method set rather than
  inheriting git's.

## Worth deciding while it is open

- **Rate limiting.** The git class is self-limiting — three endpoints, big
  payloads. `/api/v1/*` is cheap to call in a loop and worth a limit per app or
  per IP.
- **Does `X-Requested-With` still earn its place?** Once the Worker is the only
  door, the header is a label rather than a credential. Keep it for
  attribution — knowing which app made a request is genuinely useful in the
  logs — but stop describing it as access control.
- **The CF skip rule should come back off** once this lands, or the Worker's
  gate is decorative.

## Sefer side, once it lands

Small, because `gitea.ts` already has the two seams it needs: every call goes
through one `url()` helper and one injected `options.fetch`. The proxy prefix
goes in where `GiteaLive` is constructed — `src/app/services.ts` — beside the
`corsProxyUrl` the git side already reads from
`VITE_SEFER_GIT_CORS_PROXY_URL` (which then wants renaming too, to
`VITE_SEFER_WACS_PROXY_URL`).

Desktop does not change: `platform/tauri/remote.ts` talks to the host directly
and is not subject to browser CORS or to the challenge.

## What is NOT proposed

- **No third-party hosts.** One pinned upstream; the proxy never learns to
  forward anywhere a caller names.
- **No credential handling in the Worker.** It forwards `Authorization` and
  stores nothing. Tokens stay in Sefer's `Credentials` service.
- **No caching.** `no-store` stays; a proxy that caches authenticated Gitea
  reads is a cross-account leak waiting to happen.
