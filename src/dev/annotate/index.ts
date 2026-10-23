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
import {
  asHotkey,
  describeHotkey,
  hotkeyFrom,
  hotkeyMatches,
  readSavedHotkey,
  saveHotkey,
  type Hotkey,
} from "./hotkey.ts";
import { ON, OFF, currentVariant, isOn, readTweak, withTweak, withVariant } from "./state.ts";
import { PAGE_STYLES, PANEL_STYLES } from "./styles.ts";
import {
  CORNERS,
  type Annotator,
  type AnnotatorOptions,
  type Comment,
  type Corner,
  type Mode,
  type Target,
  type Tweak,
  type Variant,
  type Verbosity,
} from "./types.ts";

const HOST_ATTRIBUTE = "data-sefer-annotate";
const MODE_ATTRIBUTE = "data-sefer-annotate-mode";

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

interface Placed {
  readonly target: Target;
  readonly element: Element;
}

const place = (element: Element): Placed => ({
  element,
  target: {
    id: newId(),
    source: sourceOf(element),
    selector: selectorOf(element),
    nearby: nearbyTextOf(element),
    data: dataAttributesOf(element),
  },
});

export const mountAnnotator = (options: AnnotatorOptions): Annotator => {
  let settings = options;
  let mode: Mode = "interact";
  let corner: Corner = options.corner ?? "bottom-right";
  let verbosity: Verbosity = options.verbosity ?? "brief";
  let minimised = options.minimised ?? false;
  let menuOpen = false;
  let comments = readComments();
  let pending: Placed[] = [];
  let composing: readonly Placed[] | null = null;
  let recording = false;
  let status = "";

  const placed = new Map<string, Element>();

  const host = el("div", { [HOST_ATTRIBUTE]: "" });
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483000";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("style", {}, [PANEL_STYLES]));
  const pins = el("div", { class: "pins" });
  shadow.append(pins);
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

  const namespace = (): string => settings.namespace ?? "";
  const variants = (): readonly Variant[] => settings.variants ?? [];
  const sharedTweaks = (): readonly Tweak[] => settings.tweaks ?? [];
  const showing = (): Variant | undefined =>
    currentVariant(namespace(), variants(), settings.state.read());

  const setTweak = (variantId: string | null, tweak: Tweak, value: string): void => {
    settings.state.write(withTweak(settings.state.read(), namespace(), variantId, tweak, value));
    render();
  };

  const isOurs = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (host.contains(target) || target === host || host.shadowRoot?.contains(target) === true);

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

  const swallow = (event: Event): void => {
    if (mode !== "comment" || isOurs(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "click" && event instanceof MouseEvent) {
      const element = elementAt(event);
      if (element === null) return;
      const chosen = place(element);
      placed.set(chosen.target.id, element);

      if (event.shiftKey) {
        pending = [...pending, chosen];
        drawOutline(element);
        render();
        return;
      }

      composing = [...pending, chosen];
      pending = [];
      minimised = false;
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

  const hotkey = (): Hotkey | null => {
    const saved = readSavedHotkey();
    if (saved !== undefined) return saved;
    return asHotkey(settings.hotkey === undefined ? "c" : settings.hotkey);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (recording) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        recording = false;
        render();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        saveHotkey(null);
        recording = false;
        flash("Hotkey cleared.");
        return;
      }
      const chord = hotkeyFrom(event);
      if (chord === null) return;
      saveHotkey(chord);
      recording = false;
      flash(`Hotkey is ${describeHotkey(chord)}.`);
      return;
    }

    if (event.key === "Escape" && menuOpen) {
      event.preventDefault();
      menuOpen = false;
      render();
      return;
    }

    if (event.key === "Escape" && mode === "comment") {
      event.preventDefault();
      if (composing !== null) {
        composing = null;
        render();
        return;
      }
      if (pending.length > 0) {
        pending = [];
        hideOutline();
        render();
        return;
      }
      setMode("interact");
      return;
    }

    const chord = hotkey();
    if (chord === null || !hotkeyMatches(event, chord)) return;
    const bare = !chord.alt && !chord.ctrl && !chord.meta;
    if (bare && isTyping(event)) return;
    event.preventDefault();
    setMode(mode === "comment" ? "interact" : "comment");
  };

  const setMode = (next: Mode): void => {
    mode = next;
    composing = null;
    pending = [];
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
    if (composing === null || composing.length === 0 || text.trim() === "") return;
    const comment: Comment = {
      id: newId(),
      text: text.trim(),
      targets: composing.map((held) => held.target),
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

  const saveAndCopy = (text: string): void => {
    saveComment(text);
    copyBatch();
  };

  let statusTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const flash = (message: string): void => {
    status = message;
    globalThis.clearTimeout(statusTimer);
    statusTimer = globalThis.setTimeout(() => {
      status = "";
      render();
    }, 2600);
    render();
  };

  const copyBatch = (): void => {
    if (comments.length === 0) return;
    const text = renderMarkdown(comments, verbosity, settings.context?.() ?? {});
    void copyText(text).then((ok) => {
      if (ok) {
        archiveComments();
        comments = readComments();
        placed.clear();
      }
      flash(ok ? "Copied. Paste into Claude." : "Could not reach the clipboard.");
    });
  };

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
    const close = el("button", { type: "button", class: "ghost icon", title: "Close" }, ["×"]);
    on(close, "click", () => {
      menuOpen = false;
      render();
    });
    menu.append(
      el("div", { class: "menu-head" }, [el("div", { class: "legend title" }, ["Panel"]), close]),
    );
    for (const where of CORNERS) {
      const button = el("button", { type: "button" }, [where.replace("-", " ")]);
      on(button, "click", () => {
        corner = where;
        menuOpen = false;
        render();
      });
      menu.append(button);
    }
    const record = el("button", { type: "button" }, [
      recording ? "press a key…" : `hotkey: ${describeHotkey(hotkey())}`,
    ]);
    on(record, "click", () => {
      recording = true;
      status = "Press the keys you want. Esc cancels, ⌫ clears.";
      globalThis.clearTimeout(statusTimer);
      render();
    });
    menu.append(record);
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
      if (event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      saveAndCopy(area.value);
    });
    const held = composing ?? [];
    const numbers = numbering();
    const where = el("div", { class: "hint" });
    for (const one of held) {
      where.append(
        el("div", {}, [
          `[${String(numbers.get(one.target.id) ?? 0)}] ${one.target.source ?? one.target.selector}`,
        ]),
      );
    }
    const section = el("div", { class: "section" }, [
      el("div", { class: "legend" }, [
        held.length > 1 ? `Comment on ${String(held.length)}` : "Comment",
      ]),
      where,
      area,
      el("div", { class: "row" }, [copy, save, cancel]),
    ]);
    globalThis.requestAnimationFrame(() => {
      area.focus();
    });
    return section;
  };

  const rows = (): { target: Target; n: number; text: string | null }[] => {
    const all: { target: Target; n: number; text: string | null }[] = [];
    let n = 0;
    for (const comment of comments) {
      for (const target of comment.targets) {
        n += 1;
        all.push({ target, n, text: comment.text });
      }
    }
    for (const held of [...pending, ...(composing ?? [])]) {
      n += 1;
      all.push({ target: held.target, n, text: null });
    }
    return all;
  };

  const numbering = (): Map<string, number> => new Map(rows().map((row) => [row.target.id, row.n]));

  const renderPins = (): void => {
    pins.replaceChildren();
    if (mode !== "comment") return;
    for (const row of rows()) {
      const element = placed.get(row.target.id);
      if (element === undefined || !element.isConnected) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const pin = el(
        "div",
        { class: "pin", ...(row.text === null ? { "data-pending": "true" } : {}) },
        [String(row.n)],
      );
      pin.style.left = `${String(box.right)}px`;
      pin.style.top = `${String(box.top)}px`;
      pin.append(
        el("div", { class: "bubble" }, [
          el("div", { class: "where" }, [row.target.source ?? row.target.selector]),
          row.text ?? "Waiting for a sentence.",
        ]),
      );
      pins.append(pin);
    }
  };

  const commentList = (): HTMLElement => {
    const list = el("div", { class: "comments" });
    const numbers = numbering();
    for (const comment of comments) {
      const drop = el("button", { type: "button", class: "ghost icon", title: "Remove" }, ["×"]);
      on(drop, "click", () => {
        for (const target of comment.targets) placed.delete(target.id);
        comments = removeComment(comment.id);
        render();
      });
      const where = el("div", { class: "where" });
      for (const target of comment.targets) {
        where.append(
          el("div", {}, [
            `[${String(numbers.get(target.id) ?? 0)}] ${target.source ?? target.selector}`,
          ]),
        );
      }
      list.append(
        el("div", { class: "comment" }, [
          el("div", {}, [where, el("div", { class: "what" }, [comment.text])]),
          drop,
        ]),
      );
    }
    return list;
  };

  function render(): void {
    root.replaceChildren();
    root.setAttribute("data-corner", corner);
    renderPins();

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

    const chord = hotkey();
    const press = chord === null ? "" : ` (${describeHotkey(chord)})`;
    body.append(
      el("div", { class: "section" }, [
        segmented(
          [
            { value: "interact", label: "Interact", title: `Use the application${press}` },
            { value: "comment", label: "Comment", title: `Point at things${press}` },
          ],
          mode,
          (value) => {
            setMode(value === "comment" ? "comment" : "interact");
          },
        ),
      ]),
    );

    if (composing !== null) body.append(composer());
    else if (pending.length > 0) {
      const write = el("button", { type: "button", class: "primary" }, [
        `Comment on ${String(pending.length)}`,
      ]);
      on(write, "click", () => {
        composing = pending;
        pending = [];
        render();
      });
      const clear = el("button", { type: "button", class: "ghost" }, ["Clear"]);
      on(clear, "click", () => {
        pending = [];
        hideOutline();
        render();
      });
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "legend" }, [`${String(pending.length)} selected`]),
          el("div", { class: "hint" }, ["Shift+click to add another, or click one without Shift."]),
          el("div", { class: "row" }, [write, clear]),
        ]),
      );
    }

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
      const detail = segmented(
        [
          { value: "brief", label: "Brief", title: "Location and words" },
          { value: "full", label: "Full", title: "Adds selector, viewport and theme" },
        ],
        verbosity,
        (value) => {
          verbosity = value === "full" ? "full" : "brief";
          render();
        },
      );
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "legend" }, ["Comments"]),
          commentList(),
          el("div", { class: "row" }, [copy, detail]),
        ]),
      );
    } else if (mode === "comment") {
      body.append(
        el("div", { class: "section" }, [
          el("div", { class: "hint" }, [
            "Click anything to comment on it. Shift+click to gather several into one comment. Esc to stop.",
          ]),
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

  let frame = 0;
  const repaint = (): void => {
    if (frame !== 0) return;
    frame = globalThis.requestAnimationFrame(() => {
      frame = 0;
      renderPins();
    });
  };

  for (const type of SWALLOWED) document.addEventListener(type, swallow, true);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("scroll", repaint, true);
  globalThis.addEventListener("resize", repaint);
  const unsubscribe = settings.state.subscribe?.(() => {
    render();
  });

  render();

  return {
    sync: render,
    update: (next) => {
      settings = { ...settings, ...next };
      if (next.minimised !== undefined) minimised = next.minimised;
      render();
    },
    comments: () => comments,
    drain: () => {
      const held = comments;
      archiveComments();
      comments = readComments();
      placed.clear();
      render();
      return held;
    },
    mode: () => mode,
    setMode,
    destroy: () => {
      for (const type of SWALLOWED) document.removeEventListener(type, swallow, true);
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", repaint, true);
      globalThis.removeEventListener("resize", repaint);
      globalThis.clearTimeout(statusTimer);
      unsubscribe?.();
      document.documentElement.removeAttribute(MODE_ATTRIBUTE);
      host.remove();
      outline.remove();
      edge.remove();
      pageStyle.remove();
    },
  };
};

export type { Annotator, AnnotatorOptions, StateAdapter, Tweak, Variant } from "./types.ts";
