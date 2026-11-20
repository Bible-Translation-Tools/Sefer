# A local WACS

A WACS of our own to drive Sefer against: Forgejo as WACS runs it (15.0.6, MariaDB, valkey), the
browser git proxy in front of it (`wacs-browser-git-proxy`, the same Worker production uses, under
`wrangler dev`), and a handful of seeded repos. Nothing here touches a real server.

Use it when a change needs a server to prove: publish, fork, suggestions, sync, sign-in, a 401. It
is not part of `pnpm check` or CI.

## Commands

| Command                                  | What it does                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm wacs:up`                           | Starts it in Docker and seeds it; safe to re-run. The first run clones the proxy and builds its image (a minute or two). Prints one JSON line. |
| `pnpm wacs:up --reset`                   | Throws everything away (database, repos) and starts again.                                                                                     |
| `pnpm wacs:check`                        | Proves it is whole, through Sefer's own Web code (below). Run it before driving the app against it.                                            |
| `pnpm dev:wacs`                          | The dev server, built to use it. Arguments go to Vite (`pnpm dev:wacs --port 3100`).                                                           |
| Settings → Network → Servers: Local WACS | The same on an already running dev server (`pnpm dev` only; a deployed build does not offer it).                                               |
| `pnpm wacs:down`                         | Stops it; the data stays for next time.                                                                                                        |

Docker must be running. The proxy's source is a private repo: `wacs:up` clones it into
`tools/wacs/.proxy` (gitignored) with your own GitHub sign-in (`gh`, else `git` over SSH). To run a
checkout you are changing instead, set `WACS_PROXY_SRC=../wacs-isomorphic-git-proxy`.

## Where it answers

|                  | Address                 | Notes                                                                           |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------- |
| Forgejo          | `http://127.0.0.1:3410` | The content host Sefer names. Desktop (git2) talks to it directly.              |
| Proxy            | `http://127.0.0.1:8790` | What the browser talks to. Pinned to the Forgejo above; lets in `sefer-*` apps. |
| Language catalog | dev's                   | Not local: the catalogue is a separate read-only service.                       |

The addresses are written once, as `LOCAL_WACS` in `src/core/remote/channels.ts`. Its ports are not
the dashboard's (3400, 8787), so both copies can run at once.

## Who and what is in it

| Account     | Password          | Has                                                                                       |
| ----------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `alice`     | `alice-local`     | `en_small-nt` (small-nt's books, two commits), `empty`, `kpass_tmf_3jn_text_reg` (Writer) |
| `bob`       | `bob-local`       | `en_small-nt`, a fork of Alice's with a suggestion open on it; `bahasatech…_3jn_text_reg` |
| `wacsadmin` | `wacsadmin-local` | Site admin. Seeding, and cleaning up after the check.                                     |

`wa-local/en_shared` is an organisation's project both Alice and Bob can write to: the shared way of
working, beside the fork-and-suggest one. The passwords are not secrets; the server listens on
127.0.0.1 only and holds nothing but fixtures.

## What the check proves

`tools/wacs/check.wacs.test.ts`, as Bob, all through the proxy with Sefer's app header and Sefer's
own `GiteaLive`, `SuggestionsLive` and `WebRemoteLive`: Forgejo answers; the proxy answers a
preflight and refuses an unknown app; Bob signs in (a token is minted); he reads Alice's open
suggestions, clones his fork, pushes a branch, suggests it to Alice and takes it back; he publishes a
new project and its branch is on the server. The repos and branches it makes are deleted after; its
closed suggestions stay, since Forgejo cannot delete one.

It is a smoke check, not a suite. A flow gets its own test here when a bug turns up in it.

## What it cannot show

Cloudflare: production's challenges and its 100 MB request limit sit in front of the proxy and are
not here. Turnstile captcha is off. Every account is local; there is no WA sign-in.
