# 12 — Bounded local observability

Status: proposed. Prerequisites: first real editor and I/O operations. Owns: diagnostic evidence, never document/persistence authority. Extends [the detailed observability idea](local-observability-and-agent-evidence.md).

## Outcome and increments

1. Emit compact synchronous events into a bounded sink at editor admission, policy verdict, canonical commit, analysis publication, and failure. Include operation/revision identities and duration categories; no manuscript text by default.
2. Expose recent N events with ordering, truncation/dropped counts, current revision, and active operation summaries. An agent can inspect its actions without a mandatory begin/end capture session. Optional marks/run IDs help correlation but do not enable basic observability.
3. Use Effect logging/spans around open, save, recovery, Git, and other asynchronous lifecycles. Carry context across Promise/IPC boundaries deliberately. Keep editor hot-path events cheap; do not wrap every rule or allocate per-event fibers.
4. Add local JSONL persistence with bounded queues, batch flushing, file size/count/age policy, and sanitized errors. Evaluate Effect's platform logger only against the selected version's actual API. Rust/startup/plugin logs may use tauri-plugin-log with compatible correlation fields and separately owned files.

## Contract and failures

A volume enum controls production and development logging. Diagnostic escalation must be available when chosen, with bounded storage; normal production makes no network export. A sink failure cannot break typing or become recursively logged without a limit. Trace completion does not prove durable save.

JSONL is queryable evidence; ordering, schema/build identity, dropped-event counts, and safe attributes make that evidence interpretable. Do not create a session manager merely to export it. Timestamps alone do not reliably order multiple writers.

## Useful proof

Drive one protected edit and one real save failure, then inspect the event sequence and saved state independently. Saturate a tiny buffer to prove bounds/dropped counts. Verify sanitization with sentinel text and a bounded flush timeout. Measure enabled versus disabled overhead in the real interaction meter.

## Open questions

Default volume and retention budget? Does existing FileSystem support make a platform logger sufficient, or is a smaller sink clearer? How are logs retrieved from each host? Can operation IDs correlate native evidence without full OTLP? Motel/OTLP is optional local diagnosis; rrweb, PubSub, remote LGTM, and required capture APIs remain unearned. See [24](v2-24-effect-filesystem-and-git-probe.md).
