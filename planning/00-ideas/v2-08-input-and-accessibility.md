# 08 — Real input, accessibility, and writing systems

Status: proposed, editor viability gate. Prerequisites: a mounted editor from [07](v2-07-visual-and-chapter-views.md); repeat relevant checks after [17](v2-17-editable-satellites.md). Owns: usable human interaction and host-specific evidence.

## Outcome and increments

1. Choose representative user writing systems and input methods with the product owner. Include RTL/mixed direction, combining sequences, astral characters, and a real composition-based keyboard.
2. Verify caret movement, deletion, selection, clipboard, and Undo in source and visual modes. Include protected boundaries, multi-line notes, and chapter edges.
3. Establish keyboard-only navigation, visible focus, labels, dialogs, and a real screen-reader reading/editing pass. Decorative chrome must not become incoherent spoken content.
4. Repeat the high-risk interactions in actual supported Tauri webviews. Touch behavior is an explicit support decision, not automatically covered by desktop mouse events.

## Contract and failures

Composition must not be repeatedly destroyed by canonical fan-out or source reconfiguration. A view must not lose typed text because another surface updates. Unsupported input/platform combinations must be classified honestly before preview claims; source-mode fallback is a product decision, not an automatic waiver of visual editing requirements.

## Useful proof

Automate deterministic selection and clipboard behavior in a real browser where supported. Record a short reproducible manual/agent-assisted scenario for actual IME and assistive technology that automation cannot drive authentically. Synthetic composition events are useful focused tests but do not certify native IME compatibility. Keep evidence tied to OS, input method, browser/webview, and build.

## Open questions

Which platforms and languages block initial preview versus retirement? How are typography, script fonts, and bidirectional UI handled offline? What is acceptable apparatus focus behavior? If a core interaction fails, first isolate canonical synchronization versus rendering; do not initiate a framework rewrite without a failed, reproducible gate.
