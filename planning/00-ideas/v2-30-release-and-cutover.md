# 30 — Packaging, offline operation, updates, and cutover

Status: proposed, grows from the first vertical slice. Prerequisites: relevant capability gates; retirement requires the full vision ledger. Owns: product availability and release evidence.

## Outcome and increments

1. Package an honest Web and Tauri preview with separate Sefer identity and isolated storage from v1. Verify assets/WASM/fonts load from the actual packaged paths and offline resources remain available.
2. Define supported browsers, operating systems, webviews, scripts/input methods, and accessibility expectations. Distinguish exploratory preview from supported release; a Web pass does not certify native filesystem or input behavior.
3. Carry forward desktop updates and restart behavior through a real host service. Dirty work must be recoverable across update/relaunch. Keep test-driver/debug access explicitly out of the production package.
4. Reconcile the original capability ledger against live v1 routes, commands, settings, imports, cloud flows, STET, Form workflows, metadata, and updater behavior. Every job is kept, redesigned, or explicitly de-scoped by the owner.
5. Decide migration only after inventorying actual stored data. Transfer meaningful target source/metadata/provenance as chosen; rebuild caches/findings. Keep v1 usable during preview and define rollback/support ownership.

## Contract and failures

Offline operation includes cold/restarted use, not just toggling network after the app is warm. A failed update must not delete projects or require an online recovery service. Application/schema version mismatch must be detected without silently rewriting user data. Standard target exports remain independent escape routes.

## Useful proof

One real packaged desktop open/edit/save/restart/recovery journey per supported host gate, a cold offline Web reopen, and an isolated upgrade-data fixture when schema migration exists. Confirm build identity and diagnostic retrieval. Do not duplicate every frontend test on every platform; cover the seams that differ.

## Open questions

What blocks preview versus v1 retirement? Which platforms can CI exercise, and what remains documented manual verification? Which v1 changes during the rewrite enter the parity ledger? Is automatic migration desirable at all? Signing, distribution, and updater credentials need their own selected release plan, not speculative setup in this docs-only phase.
