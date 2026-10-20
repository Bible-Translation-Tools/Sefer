const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

const DIFF_PALETTES = ["standard", "blue-orange"] as const;
export type DiffPalette = (typeof DIFF_PALETTES)[number];
const DIFF_REMOVED_MARKS = ["strike", "underline", "none"] as const;
export type DiffRemovedMark = (typeof DIFF_REMOVED_MARKS)[number];

export interface Appearance {
  readonly theme: Theme;
  readonly fontSize: number;
  readonly zoom: number;
  readonly diffPalette: DiffPalette;
  readonly diffRemoved: DiffRemovedMark;
}

const DEFAULT_APPEARANCE: Appearance = {
  theme: "system",
  fontSize: 16,
  zoom: 100,
  diffPalette: "standard",
  diffRemoved: "strike",
};

const FONT_SIZE_RANGE = { min: 12, max: 24 } as const;
const ZOOM_RANGE = { min: 50, max: 200 } as const;

export const EDITOR_FONT_SIZE_RANGE = { min: 14, max: 32 } as const;
export const DEFAULT_EDITOR_FONT_SIZE = 18;

const CACHE_KEY = "sefer.appearance";
const EDITOR_CACHE_KEY = "sefer.editorFontSize";

const THEME_NAMES: ReadonlySet<string> = new Set(THEMES);
const DIFF_PALETTE_NAMES: ReadonlySet<string> = new Set(DIFF_PALETTES);
const DIFF_REMOVED_NAMES: ReadonlySet<string> = new Set(DIFF_REMOVED_MARKS);

const isTheme = (value: string): value is Theme => THEME_NAMES.has(value);
const isDiffPalette = (value: string): value is DiffPalette => DIFF_PALETTE_NAMES.has(value);
const isDiffRemoved = (value: string): value is DiffRemovedMark => DIFF_REMOVED_NAMES.has(value);

export const parseTheme = (value: string): Theme => (isTheme(value) ? value : "system");

export const parseDiffPalette = (value: string): DiffPalette =>
  isDiffPalette(value) ? value : "standard";

export const parseDiffRemoved = (value: string): DiffRemovedMark =>
  isDiffRemoved(value) ? value : "strike";

const clamp = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : low;

const asFontSize = (value: number): number =>
  clamp(value, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max);

const asZoom = (value: number): number => clamp(value, ZOOM_RANGE.min, ZOOM_RANGE.max);

const asEditorFontSize = (value: number): number =>
  clamp(value, EDITOR_FONT_SIZE_RANGE.min, EDITOR_FONT_SIZE_RANGE.max);

export const applyEditorFontSize = (pixels: number): void => {
  if (typeof document === "undefined") return;
  const size = asEditorFontSize(pixels);
  document.documentElement.style.setProperty("--editor-font-size", `${size}px`);
  try {
    globalThis.localStorage?.setItem(EDITOR_CACHE_KEY, String(size));
  } catch {}
};

const cachedEditorFontSize = (): number => {
  try {
    const held = Number(globalThis.localStorage?.getItem(EDITOR_CACHE_KEY));
    return Number.isFinite(held) && held > 0 ? asEditorFontSize(held) : DEFAULT_EDITOR_FONT_SIZE;
  } catch {
    return DEFAULT_EDITOR_FONT_SIZE;
  }
};

export const applyAppearance = (appearance: Appearance): void => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (appearance.theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", appearance.theme);
  root.style.fontSize = `${asFontSize(appearance.fontSize)}px`;
  const zoom = asZoom(appearance.zoom);
  if (zoom === 100) root.style.removeProperty("zoom");
  else root.style.setProperty("zoom", `${zoom}%`);
  if (appearance.diffPalette === "standard") root.removeAttribute("data-diff-palette");
  else root.setAttribute("data-diff-palette", appearance.diffPalette);
  if (appearance.diffRemoved === "strike") root.removeAttribute("data-diff-removed");
  else root.setAttribute("data-diff-removed", appearance.diffRemoved);
  cache(appearance);
};

const cache = (appearance: Appearance): void => {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(appearance));
  } catch {}
};

const cachedAppearance = (): Appearance => {
  try {
    const held: unknown = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? "null");
    if (typeof held !== "object" || held === null) return DEFAULT_APPEARANCE;
    // SAFETY: the line above rules out null and every primitive, so what remains of a JSON.parse result is an object with string keys; each field below is still type-checked before it is used.
    const record = held as Record<string, unknown>;
    return {
      theme: parseTheme(typeof record.theme === "string" ? record.theme : ""),
      fontSize: asFontSize(typeof record.fontSize === "number" ? record.fontSize : 16),
      zoom: asZoom(typeof record.zoom === "number" ? record.zoom : 100),
      diffPalette: parseDiffPalette(
        typeof record.diffPalette === "string" ? record.diffPalette : "",
      ),
      diffRemoved: parseDiffRemoved(
        typeof record.diffRemoved === "string" ? record.diffRemoved : "",
      ),
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
};

applyAppearance(cachedAppearance());
applyEditorFontSize(cachedEditorFontSize());
