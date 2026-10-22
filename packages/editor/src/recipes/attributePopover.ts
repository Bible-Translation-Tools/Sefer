import { type Extension, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";

import {
  type Attribute,
  type AttributedMarkup,
  activateMarkup,
  attributeChange,
  attributesAt,
} from "../core/attributes";
import { trusted } from "../core/kernel";

/**
 * The default UI over the attribute data (`core/attributes.ts`): a press on a
 * milestone's pip or an attributed word opens a small form beside it, one row
 * per attribute. Enter writes the values back as one Undo step; Escape, or a
 * press elsewhere, closes it. Read-only surfaces show the values only.
 *
 * Keys are locked, as the aligned-word popover this follows locked them
 * (removed in 00d397e3, its stylesheet kept): an attribute key is spec
 * vocabulary, and renaming one silently changes what alignment data means.
 * A key is changed in USFM mode. Values lose any backslash, line break or
 * quote, which would end the list or start markup.
 *
 * Opt-in by the mount (`BookEditorOptions.attributePopover`, on by default):
 * a host that wants its own UI turns it off and listens to `onActivate`.
 */
const openTarget = StateField.define<AttributedMarkup | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(activateMarkup)) return effect.value;
    if (value === null) return null;
    if (tr.docChanged && tr.annotation(trusted) !== "attributes") return null;
    return value;
  },
  provide: (field) =>
    showTooltip.compute([field], (state): Tooltip | null => {
      const target = state.field(field);
      if (target === null) return null;
      return {
        pos: target.from,
        above: true,
        create: (view) => ({ dom: form(view, target) }),
      };
    }),
});

const clean = (value: string): string => value.replace(/[\\\n\r"]/g, "");

function form(view: EditorView, target: AttributedMarkup): HTMLElement {
  const dom = document.createElement("div");
  // CodeMirror makes this element the tooltip box itself (`cm-tooltip`), painted by the
  // stylesheet's tooltip rule; `usfm-attrs` lays out what is inside it.
  dom.className = "usfm-attrs";
  const close = (): void => {
    view.dispatch({ effects: activateMarkup.of(null) });
    view.focus();
  };

  const head = document.createElement("div");
  head.className = "usfm-attrs-head";
  head.textContent =
    target.kind === "char"
      ? view.state.sliceDoc(target.from, target.listFrom).replace(/^\\\+?[\w-]+\s*/, "")
      : `\\${target.marker}`;
  dom.append(head);

  const editable = !view.state.readOnly;
  const values: HTMLInputElement[] = [];
  for (const attribute of target.attributes) {
    const row = document.createElement("label");
    row.className = "usfm-attr";
    const key = document.createElement("input");
    key.className = "usfm-attr-k";
    key.value = attribute.name ?? "default";
    key.readOnly = true;
    key.tabIndex = -1;
    key.title = "Keys are locked: change one in USFM mode";
    const value = document.createElement("input");
    value.className = "usfm-attr-v";
    value.value = attribute.value;
    value.readOnly = !editable;
    value.spellcheck = false;
    value.addEventListener("input", () => {
      const cleaned = clean(value.value);
      if (cleaned !== value.value) value.value = cleaned;
    });
    values.push(value);
    row.append(key, value);
    dom.append(row);
  }

  const foot = document.createElement("div");
  foot.className = "usfm-attrs-foot";
  foot.textContent =
    target.attributes.length === 0
      ? "No attributes. Add one in USFM mode."
      : editable
        ? "Enter saves · Esc closes"
        : "Read only";
  dom.append(foot);

  const commit = (): void => {
    const now = attributesAt(view.state, target.from);
    if (now === null) return close();
    const next: Attribute[] = now.attributes.map((attribute, at) => ({
      name: attribute.name,
      value: clean(values[at]?.value ?? attribute.value),
    }));
    if (next.every((attribute, at) => attribute.value === now.attributes[at]?.value))
      return close();
    view.dispatch({
      changes: attributeChange(now, next),
      annotations: trusted.of("attributes"),
      userEvent: "input.attributes",
    });
    close();
  };

  dom.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter" && editable) {
      event.preventDefault();
      commit();
    }
  });
  queueMicrotask(() => values[0]?.focus());
  return dom;
}

/** Closes the popover on a press anywhere in the editor that is not attributed markup. */
const closeOnPressElsewhere = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (view.state.field(openTarget) === null) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".usfm-pip, .usfm-word, .cm-attributes") !== null) return false;
    view.dispatch({ effects: activateMarkup.of(null) });
    return false;
  },
});

export const attributePopover = (): Extension => [openTarget, closeOnPressElsewhere];
