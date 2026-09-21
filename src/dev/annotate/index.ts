/**
 * Point and prompt: a floating panel that drives a prototype's variants and
 * tweaks, and turns "this padding is wrong" into something an agent can act on.
 *
 * ```ts
 * const annotator = mountAnnotator({
 *   namespace: "onboarding",
 *   variants: [{ id: "a", label: "Cards", tweaks: [...] }, { id: "b", label: "Table" }],
 *   tweaks: [{ key: "density", label: "Density", kind: "choice", options: ["cosy", "tight"] }],
 *   state: { read: () => search(), write: (next) => navigate({ search: next }) },
 *   context: () => ({ build: buildId }),
 * });
 * ```
 *
 * Everything about it is a corner of the screen and a `StateAdapter`. It knows
 * nothing about Solid, about the router, or about Sefer — `pnpm boundaries`
 * runs `src/core`'s rule set over this folder, so an accidental `solid-js`
 * import fails the build rather than quietly welding the tool to one app.
 *
 * ## The two modes
 *
 * `interact` is the application, untouched. `comment` takes every event in the
 * CAPTURE phase, so while it is on the application cannot be operated at all —
 * a click selects the element under the pointer instead of pressing it. A
 * half-mode where some clicks fall through is how somebody ends up filing a
 * bug about the app being broken, so the mode is total, loudly signposted (a
 * crosshair and a tinted viewport edge), and `Escape` always leaves it.
 *
 * ## What a comment carries
 *
 * The `data-loc` stamp from the JSX-location transform, when one is running —
 * that is the difference between a note an agent can act on and a note it has
 * to grep for. Without it, a short selector and the nearby words, so this
 * module is still useful dropped into a project that has not set that up.
 */

import {
  addComment,
  archiveComments,
  copyText,
  readComments,
  readLastBatch,
  removeComment,
  renderMarkdown,
  restoreLastBatch,
} from "./batch.ts";
import {
  dataAttributesOf,
  nearbyTextOf,
  selectorOf,
  sourceOf,
  themeOf,
  viewportOf,
} from "./describe.ts";
import { el, newId, on } from "./dom.ts";
import { ON, OFF, currentVariant, isOn, readTweak, withTweak, withVariant } from "./state.ts";
import { PAGE_STYLES, PANEL_STYLES } from "./styles.ts";
import {
  CORNERS,
  type Annotator,
  type AnnotatorOptions,
  type Comment,
  type Corner,
  type Mode,
  type Tweak,
  type Variant,
  type Verbosity,
} from "./types.ts";

const HOST_ATTRIBUTE = "data-sefer-annotate";
const MODE_ATTRIBUTE = "data-sefer-annotate-mode";

/**
 * Is somebody typing right now? Asked of `composedPath()[0]`, not of
 * `event.target`, and that distinction is the whole function.
 *
 * A keydown that starts inside a shadow root is RETARGETED on its way out: by
 * the time a listener on `document` sees it, `event.target` is the shadow
 * HOST, not the field being typed into. The annotator's own composer lives in
 * its shadow root, so a guard written against `event.target` cannot ever see
 * it — and the single-letter hotkey fires on the first `c` somebody types into
 * a comment. `composedPath()[0]` is the real element, inside or outside.
 *
 * The same applies to any host that puts an editor in a shadow root, which is
 * why this checks the path rather than special-casing our own panel.
 */
const isTyping = (event: KeyboardEvent): boolean => {
  const actual = event.composedPath()[0] ?? event.target;
  if (!(actual instanceof HTMLElement)) return false;
  return (
    actual.isContentEditable ||
    actual instanceof HTMLInputElement ||
    actual instanceof HTMLTextAreaElement ||
    actual.closest("[contenteditable='true']") !== null
  );
};

export const mountAnnotator = (options: AnnotatorOptions): Annotator => {
  let settings = options;
  let mode: Mode = "interact";
  let corner: Corner = options.corner ?? "bottom-right";
  let verbosity: Verbosity = "brief";
  let minimised = false;
  let menuOpen = false;
  let comments = readComments();
  let composing: { element: Element; x: number; y: number } | null = null;
  let status = "";

  // ---- the tool's own DOM, sealed off from the page ------------------------

  const host = el("div", { [HOST_ATTRIBUTE]: "" });
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483000";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("style", {}, [PANEL_STYLES]));
  const root = el("div", { class: "root" });
  root.style.pointerEvents = "auto";
  shadow.append(root);

  const pageStyle = el("style", { [HOST_ATTRIBUTE]: "page" }, [PAGE_STYLES]);
  document.head.append(pageStyle);
  document.body.append(host);

  const outline = el("div", { class: "sefer-annotate-outline" });
  outline.style.display = "none";
  document.body.append(outline);
  const edge = el("div", { class: "sefer-annotate-edge" });
  edge.style.display = "none";
  document.body.append(edge);

  // ---- state helpers -------------------------------------------------------

  const namespace = (): string => settings.namespace ?? "";
  const variants = (): readonly Variant[] => settings.variants ?? [];
  const sharedTweaks = (): readonly Tweak[] => settings.tweaks ?? [];
  const showing = (): Variant | undefined =>
    currentVariant(namespace(), variants(), settings.state.read());

  const setTweak = (variantId: string | null, tweak: Tweak, value: string): void => {
    settings.state.write(withTweak(settings.state.read(), namespace(), variantId, tweak, value));
    render();
  };

  /** Is this event ours? Anything inside the panel must keep working in comment mode. */
  const isOurs = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (host.contains(target) || target === host || host.shadowRoot?.contains(target) === true);

  // ---- comment mode --------------------------------------------------------

  const hideOutline = (): void => {
    outline.style.display = "none";
  };

  const drawOutline = (element: Element): void => {
    const box = element.getBoundingClientRect();
    outline.style.display = "block";
    outline.style.left = `${String(box.left)}px`;
    outline.style.top = `${String(box.top)}px`;
    outline.style.width = `${String(box.width)}px`;
    outline.style.height = `${String(box.height)}px`;
  };

  const elementAt = (event: MouseEvent): Element | null => {
    // `composedPath` first so a click inside somebody else's shadow tree still
    // resolves to the real element rather than to its host.
    const first = event.composedPath()[0];
    if (first instanceof Element && !isOurs(first)) return first;
    const found = document.elementFromPoint(event.clientX, event.clientY);
    return found !== null && !isOurs(found) ? found : null;
  };

  const onMove = (event: MouseEvent): void => {
    if (mode !== "comment" || composing !== null) return;
    const element = elementAt(event);
    if (element === null) hideOutline();
    else drawOutline(element);
  };

  /**
   * One handler for every interactive event, in the capture phase. Swallowing
   * `pointerdown`/`mousedown` as well as `click` matters: CodeMirror and most
   * drag handles act on the former and would otherwise run before the click
   * they never see.
   */
  const swallow = (event: Event): void => {
    if (mode !== "comment" || isOurs(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "click" && event instanceof MouseEvent) {
      const element = elementAt(event);
      if (element === null) return;
      composing = { element, x: event.clientX, y: event.clientY };
      drawOutline(element);
      render();
    }
  };

  const SWALLOWED = [
    "click",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "dblclick",
    "submit",
  ] as const;

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && mode === "comment") {
      event.preventDefault();
      if (composing !== null) {
        composing = null;
        render();
        return;
      }
      setMode("interact");
      return;
    }
    const hotkey = settings.hotkey === undefined ? "c" : settings.hotkey;
    if (hotkey === null || event.key !== hotkey) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event)) return;
    setMode(mode === "comment" ? "interact" : "comment");
  };

  const setMode = (next: Mode): void => {
    mode = next;
    composing = null;
    if (next === "comment") {
      document.documentElement.setAttribute(MODE_ATTRIBUTE, "comment");
      edge.style.display = "block";
    } else {
      document.documentElement.removeAttribute(MODE_ATTRIBUTE);
      edge.style.display = "none";
      hideOutline();
    }
    render();
  };

  const saveComment = (text: string): void => {
    if (composing === null || text.trim() === "") return;
    const { element } = composing;
    const comment: Comment = {
      id: newId(),
      text: text.trim(),
      source: sourceOf(element),
      selector: selectorOf(element),
      nearby: nearbyTextOf(element),
      data: dataAttributesOf(element),
      url: location.href,
      viewport: viewportOf(),
      theme: themeOf(),
      at: Date.now(),
    };
    comments = addComment(comment);
    composing = null;
    hideOutline();
    render();
  };

  /**
   * The one-comment path: write it, press Enter, it is on the clipboard.
   *
   * Worth its own function because the ordinary flow — "Add comment", then find
   * and press "Copy" — is two deliberate actions for what is usually one
   * thought. Enter is a genuine user gesture, so the clipboard write is allowed
   * to ride on it, and the whole round trip becomes: click the thing, say what
   * is wrong, Enter, paste.
   *
   * Batching is still there and still deliberate: "Add comment" adds without
   * copying, so a sweep of eight notes is eight Enters' worth of typing and one
   * Copy at the end. Shift+Enter is a newline, because some comments are two
   * sentences.
   */
  const saveAndCopy = (text: string): void => {
    saveComment(text);
    copyBatch();
  };

  const copyBatch = (): void => {
    if (comments.length === 0) return;
    const text = renderMarkdown(comments, verbosity, settings.context?.() ?? {});
    void copyText(text).then((ok) => {
      if (ok) {
        archiveComments();
        comments = readComments();
        status = "Copied. Paste into Claude.";
      } else {
        status = "Could not reach the clipboard.";
      }
      render();
      globalThis.setTimeout(() => {
        status = "";
        render();
      }, 2600);
    });
  };

  // ---- rendering -----------------------------------------------------------

  const segmented = (
    items: readonly { readonly value: string; readonly label: string; readonly title?: string }[],
    active: string,
    choose: (value: string) => void,
  ): HTMLElement => {
    const group = el("div", { class: "segmented", role: "group" });
    for (const item of items) {
      const button = el(
        "button",
        {
          type: "button",
          "aria-pressed": item.value === active ? "true" : "false",
          ...(item.title === undefined ? {} : { title: item.title }),
        },
        [item.label],
      );
      on(button, "click", () => {
        choose(item.value);
      });
      group.append(button);
    }
    return group;
  };

  const tweakField = (variantId: string | null, tweak: Tweak): HTMLElement => {
    const value = readTweak(namespace(), variantId, tweak, settings.state.read());
    if (tweak.kind === "toggle") {
      const box = el("input", { type: "checkbox", ...(isOn(value) ? { checked: true } : {}) });
      on(box, "change", () => {
        setTweak(variantId, tweak, box.checked ? ON : OFF);
      });
      return el("label", { class: "field" }, [el("span", {}, [tweak.label]), box]);
    }
    const select = el("select", {});
    for (const option of tweak.options ?? []) {
      select.append(
        el("option", { value: option, ...(option === value ? { selected: true } : {}) }, [option]),
      );
    }
    on(select, "change", () => {
      setTweak(variantId, tweak, select.value);
    });
    return el("label", { class: "field" }, [el("span", {}, [tweak.label]), select]);
  };

  const cornerMenu = (): HTMLElement => {
    const menu = el("div", { class: "menu" });
    for (const where of CORNERS) {
      const button = el("button", { type: "button" }, [where.replace("-", " ")]);
      on(button, "click", () => {
        corner = where;
        menuOpen = false;
        render();
      });
      menu.append(button);
    }
    const reset = el("button", { type: "button" }, [
      verbosity === "brief" ? "verbosity: brief" : "verbosity: full",
    ]);
    on(reset, "click", () => {
      verbosity = verbosity === "brief" ? "full" : "brief";
      menuOpen = false;
      render();
    });
    menu.append(reset);
    if (readLastBatch().length > 0) {
      const restore = el("button", { type: "button" }, ["restore last batch"]);
      on(restore, "click", () => {
        comments = restoreLastBatch();
        menuOpen = false;
        render();
      });
      menu.append(restore);
    }
    return menu;
  };

  const composer = (): HTMLElement => {
    const area = el("textarea", {
      placeholder: "Describe the issue or suggestion…  ⏎ to copy, ⇧⏎ for a new line",
    });
    const copy = el("button", { type: "button", class: "primary" }, ["Copy ⏎"]);
    const save = el("button", { type: "button" }, ["Add to batch"]);
    const cancel = el("button", { type: "button", class: "ghost" }, ["Cancel"]);
    on(copy, "click", () => {
      saveAndCopy(area.value);
    });
    on(save, "click", () => {
      saveComment(area.value);
    });
    on(cancel, "click", () => {
      composing = null;
      render();
    });
    on(area, "keydown", (event) => {
      if (event.key !== "Enter") return;
      // Shift is the newline; everything else finishes the comment. The plain
      // Enter is the point — it is a user gesture, so the clipboard write is
      // permitted to ride on it and the whole loop is click, type, Enter, paste.
      if (event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      saveAndCopy(area.value);
    });
    const where =
      composing === null ? "" : (sourceOf(composing.element) ?? selectorOf(composing.element));
    const section = el("div", { class: "section" }, [
      el("div", { class: "legend" }, ["Comment"]),
      el("div", { class: "hint" }, [where]),
      area,
      el("div", { class: "row" }, [copy, save, cancel]),
    ]);
    globalThis.requestAnimationFrame(() => {
      area.focus();
    });
    return section;
  };

  const commentList = (): HTMLElement => {
    const list = el("div", { class: "comments" });
    for (const comment of comments) {
      const drop = el("button", { type: "button", class: "ghost icon", title: "Remove" }, ["×"]);
      on(drop, "click", () => {
        comments = removeComment(comment.id);
        render();
      });
      list.append(
        el("div", { class: "comment" }, [
          el("div", {}, [
            el("div", { class: "where" }, [comment.source ?? comment.selector]),
            el("div", { class: "what" }, [comment.text]),
          ]),
          drop,
        ]),
      );
    }
    return list;
  };

  function render(): void {
    root.replaceChildren();
    root.setAttribute("data-corner", corner);

    if (minimised) {
      const puck = el("div", { class: "puck", "data-mode": mode, title: "Open the design panel" }, [
        comments.length > 0 ? String(comments.length) : "◆",
      ]);
      on(puck, "click", () => {
        minimised = false;
        render();
      });
      root.append(puck);
      return;
    }

    const kebab = el("button", { type: "button", class: "ghost icon", title: "Panel options" }, [
      "⋯",
    ]);
    on(kebab, "click", () => {
      menuOpen = !menuOpen;
      render();
    });
    const shrink = el("button", { type: "button", class: "ghost icon", title: "Minimise" }, ["–"]);
    on(shrink, "click", () => {
      minimised = true;
      menuOpen = false;
      render();
    });

    const body = el("div", { class: "body" });

    body.append(
      el("div", { class: "section" }, [
        segmented(
          [
            { value: "interact", label: "Interact", title: "Use the application (c)" },
            { value: "comment", label: "Comment", title: "Point at things (c)" },
          ],
          mode,
          (value) => {
            setMode(value === "comment" ? "comment" : "interact");
          },
        ),
      ]),
    );

    if (composing !== null) body.append(composer());

    const nav = settings.nav;
    if (nav !== undefined && nav.items.length > 1) {
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "legend" }, [nav.label]),
          segmented(nav.items, nav.active, nav.choose),
        ]),
      );
    }

    const list = variants();
    if (list.length > 1) {
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "legend" }, ["Variant"]),
          segmented(
            list.map((variant) => ({ value: variant.id, label: variant.label })),
            showing()?.id ?? "",
            (value) => {
              settings.state.write(withVariant(settings.state.read(), namespace(), list, value));
              render();
            },
          ),
        ]),
      );
    }

    const own = showing()?.tweaks ?? [];
    const shared = sharedTweaks();
    if (own.length > 0 || shared.length > 0) {
      const section = el("div", { class: "section" }, [el("div", { class: "legend" }, ["Tweaks"])]);
      for (const tweak of shared) section.append(tweakField(null, tweak));
      for (const tweak of own) section.append(tweakField(showing()?.id ?? null, tweak));
      body.append(section);
    }

    if (comments.length > 0) {
      const copy = el("button", { type: "button", class: "primary" }, [
        `Copy ${String(comments.length)} comment${comments.length === 1 ? "" : "s"}`,
      ]);
      on(copy, "click", copyBatch);
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "legend" }, ["Comments"]),
          commentList(),
          el("div", { class: "row" }, [copy]),
        ]),
      );
    } else if (mode === "comment") {
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "hint" }, ["Click anything to comment on it. Esc to stop."]),
        ]),
      );
    }

    if (status !== "") body.append(el("div", { class: "hint" }, [status]));

    const panel = el("div", { class: "panel" }, [
      el("div", { class: "head" }, [el("div", { class: "title" }, ["Design"]), kebab, shrink]),
      body,
    ]);
    root.append(panel);
    if (menuOpen) root.append(cornerMenu());
  }

  // ---- wiring --------------------------------------------------------------

  for (const type of SWALLOWED) document.addEventListener(type, swallow, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  const unsubscribe = settings.state.subscribe?.(() => {
    render();
  });

  render();

  return {
    sync: render,
    update: (next) => {
      settings = { ...settings, ...next };
      render();
    },
    destroy: () => {
      for (const type of SWALLOWED) document.removeEventListener(type, swallow, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      unsubscribe?.();
      document.documentElement.removeAttribute(MODE_ATTRIBUTE);
      host.remove();
      outline.remove();
      edge.remove();
      pageStyle.remove();
    },
  };
};

export type {
  Annotator,
  AnnotatorOptions,
  Comment,
  Corner,
  Mode,
  StateAdapter,
  Tweak,
  Variant,
} from "./types.ts";
