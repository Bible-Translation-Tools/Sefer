/**
 * Appearance: the three preferences that are a fact about the DOCUMENT rather
 * than about a component — the colour scheme, the interface font size, and the
 * page zoom.
 *
 * They live here, outside any screen, because all three are written onto the
 * root element and every route reads them by simply existing. `tokens.css`
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

export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export interface Appearance {
  readonly theme: Theme;
  /** Root font size in px; every `rem` in the interface scales with it. */
  readonly fontSize: number;
  /** Page zoom as a percentage. 100 is untouched. */
  readonly zoom: number;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", fontSize: 16, zoom: 100 };

/** The bounds the widgets offer and the cache is clamped to. */
export const FONT_SIZE_RANGE = { min: 12, max: 24 } as const;
export const ZOOM_RANGE = { min: 50, max: 200 } as const;

const CACHE_KEY = "sefer.appearance";

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

export const asFontSize = (value: number): number =>
  clamp(value, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);

export const asZoom = (value: number): number => clamp(value, ZOOM_RANGE.min, ZOOM_RANGE.max);

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
export const cachedAppearance = (): Appearance => {
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
