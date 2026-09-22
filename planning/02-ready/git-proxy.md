# Handoff: the browser git proxy, and what Sefer needs from it

**For a fresh agent.** Self-contained. Prompt at the bottom.

## What this is, and what it is not

A browser cannot speak git smart-HTTP to Gitea directly — CORS, and auth
headers Gitea will not accept cross-origin. A small Cloudflare Worker sits in
front and proxies it.

That worker already exists, is already deployed, and is **not Sefer's**:

```
../wacs-isomorphic-git-proxy/        →  worker name: wacs-browser-git-proxy
```

It serves every browser client of WACS. Do **not** copy it into this
repository. If it moves, it moves to its own home as a shared service; that is
a separate decision from anything here.

## What it requires of a client

From its README:

* Call it with the upstream host as the first path segment.
* Send `X-Requested-With: <identifier>`, where the identifier is in the
  worker's `ALLOWED_APPS_CSV` secret. Today that is
  `scripture-editor-web,scripture-editor-local` — **Sefer is not in the list**.
* `UPSTREAM_GIT_BASE_URL` is per-environment: production points at
  `content.bibletranslationtools.org`, its `dev` env at `content.wacsdev.org`.

## So the work splits in two

### In the proxy repo (not here)

1. Add Sefer's identifiers to `ALLOWED_APPS_CSV` — suggest `sefer-web` and
   `sefer-local`, matching the existing convention. It is a secret, so
   `wrangler secret put ALLOWED_APPS_CSV [--env dev]`, not a code change.
2. Decide whether Sefer's `dev`/`preview` channels point at the proxy's `dev`
   env (`content.wacsdev.org`) or at production. They almost certainly want
   dev — a designer clicking around should not be pushing at real content.

### In this repository

`src/platform/web/git.ts` is the Web answer to the `Git` port and is the only
file here that knows isomorphic-git exists. **It has no proxy wiring at all
today** — no `corsProxy`, no `http` client, no `X-Requested-With`. Nothing
here currently talks to a remote over HTTP from the browser.

So this is new work, not a patch:

1. Give isomorphic-git an `http` client and route remote calls through the
   proxy URL.
2. Send the `X-Requested-With` identifier on every request.
3. Take the proxy base from configuration, not a literal — see
   `documentation/architecture/configuration.md` for how this repository does
   hosts (`VITE_SEFER_*`, read once, no fallback URLs). The pattern to copy is
   `VITE_SEFER_GITEA_WEB_HOST`, which the cloud screen already reports as "not
   configured" when absent rather than guessing.
4. Desktop does not need the proxy — Tauri is not a browser origin — so this
   belongs behind the Web host's Layer only, exactly like the `Buffer` shim
   already in that file.

Read `documentation/architecture/git.md` and `documentation/architecture/sync.md`
before starting. The `Remote` port and the nine sync states already exist; this
is the transport under them, not a new concept.

## Done when

- [ ] Sefer's identifiers are allowed by the proxy's `dev` env at least
- [ ] `src/platform/web/git.ts` routes remote traffic through the configured proxy with the identifier header
- [ ] The proxy base is configuration, with an honest "not configured" state, no fallback literal
- [ ] `pnpm boundaries` still passes — core must not learn the proxy exists
- [ ] A real clone from `content.wacsdev.org` works in a browser, proved by driving it (`pnpm verify:chrome`), not by unit test

## Prompt

> Wire Sefer's web host to the existing browser git proxy. Read
> `planning/02-ready/git-proxy.md` first, then
> `documentation/architecture/git.md` and `configuration.md`. The proxy lives
> in `../wacs-isomorphic-git-proxy` and must NOT be copied into this repo —
> the work here is client-side only, in `src/platform/web/git.ts`, plus taking
> the proxy base from configuration. Prove it with a real clone against
> `content.wacsdev.org` driven in a browser, not with a mock.
