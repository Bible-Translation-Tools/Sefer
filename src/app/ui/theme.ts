/**
 * Appearance: the preferences that are a fact about the DOCUMENT rather than
 * about a component — the colour scheme, the interface font size, the page
 * zoom, and the scripture surface's own size.
 *
 * They live here, outside any screen, because each is written onto the root
 * element and every route reads them by simply existing. `tokens.css`
 * swaps the semantic names under `[data-theme="dark"]` and under
 * `prefers-color-scheme: dark` when no theme is stamped, so "system" is the
 * ABSENCE of the attribute and never a computed value: a computed one would
 * stop following the OS the moment the OS changed.
 *
 * The values are mirrored into `localStorage` and re-applied at module load.
 * That is not a second source of truth — `Settings` is, and `/settings` writes
 * both — it is a cache that beats the first paint. `Settings` is only readable
 * once the composition has built, which is after the browser has painted, and
 * a page that flashes light before turning dark is the thing this avoids.
 */

const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export interface Appearance {
  readonly theme: Theme;
  /** Root font size in px; every `rem` in the interface scales with it. */
  readonly fontSize: number;
  /** Page zoom as a percentage. 100 is untouched. */
  readonly zoom: number;
}

const DEFAULT_APPEARANCE: Appearance = { theme: "system", fontSize: 16, zoom: 100 };

/** The bounds the widgets offer and the cache is clamped to. */
const FONT_SIZE_RANGE = { min: 12, max: 24 } as const;
const ZOOM_RANGE = { min: 50, max: 200 } as const;

/**
 * The scripture surface's own size, in px, and its bounds.
 *
 * Separate from the interface size on purpose: the chrome and the text being
 * translated are read at different distances, and a translator who wants
 * larger scripture does not want a larger toolbar. It is not part of
 * `Appearance` either, because `Appearance` is what `/settings` applies in one
 * call and this one is applied by whoever writes it — see `applyEditorFontSize`.
 */
export const EDITOR_FONT_SIZE_RANGE = { min: 14, max: 32 } as const;
export const DEFAULT_EDITOR_FONT_SIZE = 18;

const CACHE_KEY = "sefer.appearance";
const EDITOR_CACHE_KEY = "sefer.editorFontSize";

/**
 * A stored string is whatever was there last; only a known name is a theme.
 *
 * SAFETY: both assertions are guarded by the `includes` check on the line they
 * are on — widening `THEMES` to `readonly string[]` is what lets an arbitrary
 * string be compared against it at all, and `value` is narrowed to a member of
 * that tuple by the check succeeding.
 */
export const asTheme = (value: string): Theme =>
  (THEMES as readonly string[]).includes(value) ? (value as Theme) : "system";

const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low;

const asFontSize = (value: number): number =>
  clamp(value, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);

const asZoom = (value: number): number => clamp(value, ZOOM_RANGE.min, ZOOM_RANGE.max);

const asEditorFontSize = (value: number): number =>
  clamp(value, EDITOR_FONT_SIZE_RANGE.min, EDITOR_FONT_SIZE_RANGE.max);

/**
 * Writes `--editor-font-size` onto `<html>`, where `src/editor/editor.css`
 * reads it for `.cm-mode-regular .cm-content`.
 *
 * A custom property rather than a root font size: the scripture column is the
 * only thing that scales, and `rem` in the editor's own chrome must keep
 * following the interface size.
 */
export const applyEditorFontSize = (px: number): void => {
  if (typeof document === "undefined") return;
  const size = asEditorFontSize(px);
  document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
  try {
    globalThis.localStorage?.setItem(EDITOR_CACHE_KEY, String(size));
  } catch {
    /* A cache that cannot be written is a slower first paint, not a failure. */
  }
};

/** The cached scripture size, or the default. */
const cachedEditorFontSize = (): number => {
  try {
    const held = Number(globalThis.localStorage?.getItem(EDITOR_CACHE_KEY));
    return Number.isFinite(held) && held > 0 ? asEditorFontSize(held) : DEFAULT_EDITOR_FONT_SIZE;
  } catch {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
};

/**
 * Writes the appearance onto `<html>`.
 *
 * `system` REMOVES the attribute rather than writing a resolved value, which is
 * what keeps the media query in charge. Guarded for the production prerender,
 * which runs this module under Node with no document.
 */
export const applyAppearance = (appearance: Appearance): void => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (appearance.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", appearance.theme);
  root.style.fontSize = `${asFontSize(appearance.fontSize)}px`;
  const zoom = asZoom(appearance.zoom);
  if (zoom === 100) root.style.removeProperty("zoom");
  else root.style.setProperty("zoom", `${zoom}%`);
  cache(appearance);
};

/** Never throws: private-mode browsers refuse `localStorage` outright. */
const cache = (appearance: Appearance): void => {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(appearance));
  } catch {
    /* A cache that cannot be written is a slower first paint, not a failure. */
  }
};

/** The cached appearance, or the defaults. Shape is re-checked, not trusted. */
const cachedAppearance = (): Appearance => {
  try {
    const held: unknown = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? "null");
    if (typeof held !== "object" || held === null) return DEFAULT_APPEARANCE;
    // SAFETY: the line above rules out null and every primitive, so what
    // remains of a JSON.parse result is an object with string keys; each field
    // below is still type-checked before it is used.
    const record = held as Record<string, unknown>;
    return {
      theme: asTheme(typeof record.theme === "string" ? record.theme : ""),
      fontSize: asFontSize(typeof record.fontSize === "number" ? record.fontSize : 16),
      zoom: asZoom(typeof record.zoom === "number" ? record.zoom : 100),
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
};

// Applied at import so the first paint is already in the right scheme. The
// settings screen re-applies from `Settings` once the composition is up, which
// is the authoritative read; this one only has to be fast.
applyAppearance(cachedAppearance());
applyEditorFontSize(cachedEditorFontSize());
