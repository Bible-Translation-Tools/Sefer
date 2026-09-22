# WACS proxy rollout: what is left, and it is not code

The client and the Worker both landed on 2026-09-22. Everything below needs an
account, a dashboard or a decision, so it is here rather than in a commit.

Replaces `planning/02-ready/git-proxy.md` and
`planning/01-discussing/rfc-wacs-proxy-2026-09-17.md`, both of which described
work that is now done. What those documents settled is recorded in
`documentation/architecture/configuration.md` and `git.md`; what they left open
is below.

## Before a deployed Sefer can reach WACS

1. **One 1Password item, `DevOps / wacs-proxy`, with four fields.**
   `cloudflare-api-token`, `cloudflare-account-id`, and the two allowlists:

   | field | value |
   | --- | --- |
   | `allowed-apps-prod` | `WA-Tool-Dovetail,sefer-prod,sefer-preview,sefer-dev,sefer-local` |
   | `allowed-apps-dev` | `WA-Tool-Dovetail,sefer-prod,sefer-preview,sefer-dev,sefer-local` |

   `WA-Tool-Dovetail` is scripture-editor-proto-2, the one other browser client
   through this proxy — its `.env` points at the Worker and sends that. A
   Workers secret cannot be read back, so confirm the live list with
   `node scripts/probeAllowedApps.mjs --endpoint <url>` in the proxy repo
   before pushing; `wrangler secret put` replaces rather than appends.

   The same four in both, deliberately. The endpoint is a setting, so any build
   can be pointed at either environment from `/settings` — a production build
   looking at dev WACS is an ordinary thing to want — and an allowlist that
   permitted only "its own" channel would turn that into a 403 nobody could
   diagnose. The environments are separated by the upstream pinning, which is
   the thing that actually separates them; the allowlist is for attribution and
   revocation, and neither wants the lists to differ.

   Desktop never touches a proxy and needs no identifier.

   Setting the secret REPLACES the allowlist rather than adding to it, so check
   what each environment currently holds first — as of 2026-09-22 the deployed
   value looked like `scripture-editor-web,scripture-editor-local`, and leaving
   an existing client out of the list is how it stops working.

   `pnpm deploy:prod` / `pnpm deploy:dev` push these on every deploy; the item
   has to exist before either will run. Nothing else in the chain works until
   it does, and everything fails with a clear 403 until then.

2. **The two custom domains.** `wrangler.toml` declares
   `wacs-proxy.bibletranslationtools.org` and `wacs-proxy.bttdev.org` as custom
   domains; the first deploy provisions them, and needs both zones in the
   Cloudflare account. `tools/deploy/channels.ts` already points the channels
   at those names, so nothing in Sefer changes when they come up.

3. **Do not put Cloudflare Access in front of either.** Confirmed 2026-09-22.
   Access answers with a login redirect, which to a browser `fetch` is an
   opaque CORS failure — the exact symptom this whole change removes — and it
   would make anonymous clone impossible. Access on the versioned
   `*.workers.dev` preview URLs is fine; those are for eyeballing a deploy.

## Decisions taken, worth not re-litigating

- **The CF rule on the content origin must NOT simply come off.** The RFC said
  it should, and that was written without knowing what it carries. The rule is
  `any(http.request.headers["x-requested-with"][*] contains "WA-Tool-")`, and
  it is how the whole server-side fleet gets past the RATE LIMITER: Orature,
  the BIEL frontend service worker, BIEL mobile, wacsTopicManager,
  SendAllReposToAPI, the gitea-dashboard ingest. None of those come through
  this proxy. Removing the rule breaks all of them.

  What can come off is whatever part of it lets a BROWSER past the managed
  challenge, if that is separable — which is a question for whoever owns the
  Cloudflare config, not an obvious yes. Measured on 2026-09-17 the rule also
  appeared to be skipping for everyone regardless of header, so working out
  what it actually matches comes first.
- **Rate limiting is a dashboard decision, not code.** The `api` class is cheap
  to call in a loop where `git` is self-limiting, so if a limit goes anywhere it
  goes there first. Worth being honest that the `git` class already permits
  anonymous full clone to anyone holding the app identifier, and that identifier
  ships in a public bundle — so a limit on both classes is what would actually
  deter bulk scraping. The scrapers discussed so far are meta-bot-class, which
  the Worker not being linked anywhere already handles.
- **No `UPSTREAM_ALLOWED_HOSTS_CSV`.** One pinned upstream per Worker is what
  makes an ENDPOINT mean exactly one content host. That is worth keeping on its
  own terms; it is not a statement about which build is allowed to reach what.

- **`preview` points at production content.** Preview is a release channel in
  the Zed sense — ahead of stable, but people doing real work in it — so
  pointing it at a copy of the content would be the surprise. `dev` is the
  channel that gets dev content: every push to master, carrying the design
  surface and the comment panel that swallows clicks. What keeps real
  translations safe is Gitea auth — a push needs a token with write access —
  and never was the build's compiled-in hostname.

## Still missing, and small

- **The Language API's DEV url.** Production and preview now carry
  `https://api.bibleineverylanguage.org/api/rest/consolidated-repos`, found in
  `scripture-editor-proto-2/.env.example` and already the shape
  `src/app/catalogue.ts` decodes. The dev deployment built against dev WACS has
  no URL written down anywhere, so `dev` stays on the sample catalogue —
  deliberately, because pointing it at the production catalogue would be worse
  than the sample: `attach` re-bases every row onto the dev endpoint, so each
  download would hunt for a production repository on the dev content host.

## How to know it worked

Not a unit test. Drive it: `pnpm verify:chrome` against a `dev` build, download
a translation from the Find Project catalogue **signed out** — that exercises
the endpoint, the re-based clone URL, the git route class and anonymous pull in
one click — then sign in and list repositories, which exercises the api class
and the `X-Requested-With` gate. `GET <endpoint>/__meta` answers whether the
endpoint and the identifier agree before any of that is worth trying.
