# 17 — Editable satellites and apparatus

Status: proposed, separately gated. Prerequisites: [06](v2-06-transactions-and-undo.md), [08](v2-08-input-and-accessibility.md), [16](v2-16-readonly-surfaces.md). Owns: a second editing surface over canonical content.

## Outcome and increments

1. Prove one editable same-book result surface with local selection and shared canonical history. Use the donor's single host recipe as evidence, not an excuse to maintain another synchronization host.
2. Map local submission to canonical coordinates, enforce its writable source region, and synchronously fan the accepted result back. Rewritten edits must remain within the originating capability.
3. Exercise composition while another surface changes source. Specify conflict/reconfiguration behavior and preserve or deliberately end composition according to proven platform behavior.
4. Only after the gate, consider a footnote/cross-reference apparatus or editable search/STET card. Those are separate product choices sharing this proven mechanism.

## Contract and failures

Local selections are independent; canonical content/history is not. Stale submissions refuse or recompute under the canonical contract. A surface showing hidden text is not universally trusted. A deleted/moved source region invalidates or remaps the surface instead of leaving an editable detached copy.

## Useful proof

Two real browser views: alternate edits, Undo from each, delete the satellite's region, paste at its edge, then repeat a representative native IME interaction. Assert canonical source and both views. Include a protection rewrite whose expanded range could escape the clip. Synthetic events alone cannot close the composition gate.

## Open questions

Are full-book mirrored states cheap enough at the actual result count? If not, what measured cost justifies a mini-document protocol? What should an apparatus do when its note moves or disappears? If the gate fails, preserve read-only cards and navigate to the canonical editor; that fallback retains the job while the editable enhancement stays deferred.
