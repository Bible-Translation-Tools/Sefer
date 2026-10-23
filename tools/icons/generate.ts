import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

// Every icon Sefer ships comes from ONE file, public/sefer.svg: the bare
// samekh, which the app bar also uses as a mask. This script puts it on a tile
// and hands each tile to `tauri icon`, which rasterises (no ImageMagick, no
// new dependency). Edit the glyph or a tile below and rerun; never edit a
// generated PNG, ICO or ICNS by hand.

const BLUE = "#0356D2";
const WHITE = "#fff";

const root = process.cwd();
const glyphFile = path.join(root, "public", "sefer.svg");
const tauriIcons = path.join(root, "src-tauri", "icons");

type Glyph = { readonly body: string; readonly side: number };

// The glyph's own colours are stripped so each tile can paint it.
const readGlyph = (): Glyph => {
  const text = readFileSync(glyphFile, "utf8");
  const viewBox = /viewBox="0 0 ([\d.]+) [\d.]+"/u.exec(text);
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/u.exec(text);
  if (viewBox?.[1] === undefined || body?.[1] === undefined) {
    throw new Error(`icons: cannot read a square viewBox and body from ${glyphFile}`);
  }
  return {
    body: body[1].replaceAll(/fill:[^;"]*;?/gu, "").replaceAll(/\sfill="[^"]*"/gu, ""),
    side: Number(viewBox[1]),
  };
};

type Tile = {
  readonly size: number;
  // Transparent margin around the tile: the macOS grid wants 100 of 1024.
  readonly inset: number;
  readonly radius: number;
  readonly tile: string;
  readonly glyph: string;
  // The share of the tile's side the glyph is drawn at.
  readonly share: number;
};

const tileSvg = (glyph: Glyph, { size, inset, radius, tile, glyph: ink, share }: Tile): string => {
  const body = size - 2 * inset;
  const drawn = body * share;
  const offset = inset + (body - drawn) / 2;
  const scale = drawn / glyph.side;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}">` +
    `<rect x="${String(inset)}" y="${String(inset)}" width="${String(body)}" height="${String(body)}" rx="${String(radius)}" fill="${tile}"/>` +
    `<g fill="${ink}" transform="translate(${String(offset)} ${String(offset)}) scale(${String(scale)})">${glyph.body}</g>` +
    `</svg>\n`
  );
};

// Full bleed: the platform (iOS, Android, a home-screen bookmark) rounds it.
const BLEED: Tile = { size: 1024, inset: 0, radius: 0, tile: BLUE, glyph: WHITE, share: 0.66 };

const tauriIcon = (args: readonly string[]): void => {
  const result = spawnSync("pnpm", ["exec", "tauri", "icon", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    throw new Error(`icons: tauri icon ${args.join(" ")} failed`);
  }
};

const main = (): void => {
  const glyph = readGlyph();
  const scratch = mkdtempSync(path.join(tmpdir(), "sefer-icons-"));
  const write = (name: string, svg: string): string => {
    const file = path.join(scratch, name);
    writeFileSync(file, svg);
    return file;
  };

  try {
    // The browser tab: one blue tile in every theme. A light/dark switch in the
    // SVG follows the OS appearance, not Chrome's own theme, so it misfired.
    writeFileSync(
      path.join(root, "public", "favicon.svg"),
      tileSvg(glyph, { ...BLEED, size: 32, radius: 7, share: 0.72 }),
    );

    // Desktop: a padded rounded tile, because macOS does not mask app icons.
    const desktop = write("desktop.svg", tileSvg(glyph, { ...BLEED, inset: 100, radius: 185 }));
    tauriIcon([desktop, "-o", tauriIcons]);

    const bleed = write("bleed.svg", tileSvg(glyph, BLEED));
    // Android adaptive icons crop the foreground to about its middle two
    // thirds, so the glyph there is drawn smaller, on its own layer.
    write("android-bg.svg", tileSvg(glyph, { ...BLEED, share: 0 }));
    write("android-fg.svg", tileSvg(glyph, { ...BLEED, tile: "none", share: 0.42 }));
    const manifest = write(
      "mobile.json",
      JSON.stringify({
        default: "bleed.svg",
        bg_color: BLUE,
        android_bg: "android-bg.svg",
        android_fg: "android-fg.svg",
      }),
    );
    const mobile = path.join(scratch, "mobile");
    tauriIcon([manifest, "-o", mobile]);
    for (const platform of ["ios", "android"]) {
      rmSync(path.join(tauriIcons, platform), { force: true, recursive: true });
      cpSync(path.join(mobile, platform), path.join(tauriIcons, platform), { recursive: true });
    }
    const touch = path.join(scratch, "touch");
    tauriIcon([bleed, "-o", touch, "-p", "180"]);
    cpSync(path.join(touch, "180x180.png"), path.join(root, "public", "apple-touch-icon.png"));

    // The .ico fallback, for browsers without SVG favicons (Safari).
    const ico = write("ico.svg", tileSvg(glyph, { ...BLEED, radius: 224 }));
    const web = path.join(scratch, "web");
    tauriIcon([ico, "-o", web]);
    cpSync(path.join(web, "icon.ico"), path.join(root, "public", "favicon.ico"));
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }

  process.stdout.write(
    "icons: public/favicon.svg, favicon.ico, apple-touch-icon.png and src-tauri/icons/ from public/sefer.svg\n",
  );
};

if (import.meta.main) main();
