# Release: draft, then publish only when every platform built (2026-10-01)

From the first `v0.1.0-1` run. macOS failed (Apple's developer agreement had
expired, notarization 403), Windows and Linux succeeded — and the GitHub
prerelease went out anyway with their installers and a `latest.json` that
has no macOS entry.

Why: each `build-desktop` leg uploads straight into a PUBLISHED release
(`tauri-action` with `releaseDraft: false`, `.github/workflows/release.yml`).
There is no point where the run says "all three or none".

Will's question: should the updater and the desktop builds succeed and fail
together?

The proposal: yes, but join them at the RELEASE, not at the updater deploy.

1. A job before the matrix creates the release as a draft (or the first leg
   does, `releaseDraft: true`).
2. Every leg uploads into that draft.
3. A final `publish-release` job, `needs: build-desktop`, flips it to
   published only if every leg succeeded. A failed leg leaves a draft
   nobody's updater can see, and a re-run of the failed leg fills it in.
4. Optionally `deploy-updater` moves to `needs: publish-release`, so the
   updater is never deployed for a release that did not publish. The worker
   only reads releases, so this is about one story per run, not safety.

Web stays independent: `deploy-web` should not wait on a twenty-minute
desktop matrix.
