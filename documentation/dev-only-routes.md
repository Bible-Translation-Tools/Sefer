# Dev-only routes

Every route that is not in a production build, what it is for, and where to find it. Keep this page current in the usual documentation passes: a route that gains or loses a gate changes a row here in the same change.

## The check

```sh
git grep -n -E "__SEFER_DESIGN__|import.meta.env.DEV" -- src/routes
```

Every file that prints belongs in the table below, and nothing else does.

Two gates, and the difference is where a route can be seen:

- **`__SEFER_DESIGN__`**, the switch `/design` introduced: on under `pnpm dev` AND in `--mode dev` builds, which are the deployed `dev` channel (`https://sefer-dev.bttdev.org`, every push to master) and every CloudflarePreview branch URL (`pnpm branch:preview`). This is the gate for anything to be shown to a product owner. `pnpm verify:design` proves each such surface is absent from production and present in the dev build. A new one adds a sentinel to its page and a row to `SURFACES` in `tools/verify/designBundle.ts`.
- **`import.meta.env.DEV`**: on only under a local `pnpm dev`. For harnesses agents and scripts drive, not for showing anyone.

[The design surface](architecture/design.md) explains why the switch is a Vite `define` and never an env variable. Channels: [release channels](../agents/skills/release-channels/SKILL.md).

## The routes

| Route                       | Gate                  | For                                                                                                                                                                                              | Show the PO?                                        | Deployed URL (`dev` channel)                                                                                                                                                                           |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/design`                   | `__SEFER_DESIGN__`    | The designer's prototype screens, variants and tweaks                                                                                                                                            | Yes, it exists to be shown                          | <https://sefer-dev.bttdev.org/design>                                                                                                                                                                  |
| `/project/$slug/playground` | `__SEFER_DESIGN__`    | UI experiments on a real project's text: the diff and excerpt card work                                                                                                                          | Yes                                                 | Open <https://sefer-dev.bttdev.org/projects?fixture=1>, choose Open Project on `small-nt`, then change the address's `/book/…` to `/playground`                                                        |
| `/playground/history-diff`  | `__SEFER_DESIGN__`    | The book-history prototype: a slide per change to a book, as changed-passage cards. It also proves out the read-side history pieces (the raw-tree walker, the pack cache, the book-change index) | Yes, as a thought experiment. The UI is not decided | <https://sefer-dev.bttdev.org/playground/history-diff>, after bringing a project WITH Git history into this browser (a WACS download, or Import → Clone from cloud); the `?fixture=1` project has none |
| `/dev/fixture`              | `import.meta.env.DEV` | The seeded in-memory `fixtures/small-nt/` for agents and `pnpm verify:launch`                                                                                                                    | No                                                  | None: local `pnpm dev` only. The dev channel's equivalent for a person is `?fixture=1`                                                                                                                 |

A `$slug` route cannot be opened cold from a link: a slug is known once the project has been opened in that browser, and an unknown one draws the blank no-project area. That is why the playground row goes through Open Project.

Not routes, but also only in `--mode dev` builds: the floating comment panel and the `data-loc` JSX stamps (both `__SEFER_DESIGN__`), and `?fixture=1`.
