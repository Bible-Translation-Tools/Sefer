# WACS proxy rollout

Client and Worker both landed 2026-09-22. What is left needs an account, a
dashboard or a decision rather than a commit.

Replaces `planning/02-ready/git-proxy.md` and the WACS proxy RFC, both of which
described work now done. The design is in
`documentation/architecture/configuration.md` and `git.md`.

## Before a deployed Sefer can reach WACS

1. **Deploy the two Workers.** `pnpm deploy:dev` then `pnpm deploy:prod` in
   `../wacs-isomorphic-git-proxy`. Each pushes its allowlist from 1Password and
   provisions its custom domain. Dev does not exist yet; production is live and
   serves another team's app, so clone through it once afterwards.

2. **Do not put Cloudflare Access in front of either.** Confirmed 2026-09-22.
   Access answers with a login redirect, which to a browser `fetch` is an
   opaque CORS failure — the symptom this whole change removes — and it would
   make anonymous clone impossible. Access on the versioned `*.workers.dev`
   preview URLs is fine.

## Decisions taken, worth not re-litigating

- **`preview` points at production content.** It is a release channel in the
  Zed sense, not a staging environment, so a preview user opening their own
  translations is the ordinary case. `dev` is the channel that gets dev
  content. What protects real translations is Gitea auth, not the build's
  compiled-in hostname.
- **Any build can be repointed** from the Network card of `/settings`, so a
  production build can look at dev WACS without a special build.
- **One pinned upstream per Worker**, so an endpoint means exactly one content
  host. Not a statement about which build may reach what.
- **The Cloudflare rule on the content origin stays.** An earlier draft of this
  plan said to remove it once the Worker landed. That was written without
  knowing what depends on it, and removing it would break several server-side
  tools that never touch this proxy. Ask whoever owns the Cloudflare config
  before changing anything there.
- **Rate limiting is a dashboard decision, not code.**

## Still missing

- **The Language API's dev URL.** Production and preview carry theirs. The dev
  deployment built against dev WACS has no URL written down, so `dev` stays on
  the sample catalogue — deliberately, because pointing it at the production
  catalogue would be worse: `attach` re-bases every row onto the build's
  endpoint, so each download would hunt a production repository on the dev
  content host.

## How to know it worked

Drive it, not a unit test. Against a `dev` build: download a translation from
the Find Project catalogue **signed out** — that exercises the endpoint, the
re-based clone URL, the git route class and anonymous pull in one click — then
sign in and list repositories for the API half. `GET <endpoint>/__meta` says
whether the endpoint and the identifier agree before any of it is worth trying.
