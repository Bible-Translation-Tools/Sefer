/**
 * Tauri updater manifest endpoint, backed by the GitHub Releases API.
 *
 * Routes (path-based; this worker only ever receives traffic on the
 * `updater.sefer*` hostnames configured in wrangler.toml):
 *
 *   /{target}/{current_version}       Auto-check. Returns 204 if the latest
 *                                     release is not newer; manifest JSON
 *                                     otherwise.
 *   /versions                         List recent releases for the manual
 *                                     downgrade picker.
 *   /{target}/at/{specific_version}   Manifest for an exact version (manual
 *                                     downgrade / pinning).
 *
 * Target strings follow Tauri's convention: e.g. darwin-aarch64,
 * darwin-x86_64, linux-x86_64, windows-x86_64.
 *
 * Manifest lookups are edge-cached for 60s to absorb update-check stampedes.
 *
 * ## Channels, and how this differs from the worker it was ported from
 *
 * Zephyr separated stable from nightly by TAG PREFIX — `v*` against
 * `nightly-*` — so each environment filtered on a different string. Sefer's
 * channels both tag `v*` and differ by SEMVER PRE-RELEASE instead
 * (`v0.3.0` against `v0.3.0-1`), so filtering by prefix cannot tell them
 * apart and `CHANNEL` does the work:
 *
 *   stable   only final releases. A stable user is never offered a candidate.
 *   preview  candidates AND finals. This is deliberate: when 0.3.0 ships,
 *            somebody sitting on 0.3.0-1 should roll onto it rather than be
 *            stranded until the next candidate. Semver already orders it
 *            that way — 0.3.0 > 0.3.0-1 — so `isNewer` needs no special case.
 *
 * ## Version format, and a Windows constraint worth knowing
 *
 * Manifests carry stripped semver: `0.3.0`, not `v0.3.0`.
 *
 * A pre-release identifier must be SINGLE and NUMERIC — `0.3.0-1`, not
 * `0.3.0-rc.1`. Tauri's MSI bundler accepts only a single-identifier
 * pre-release (numeric, <= 65535); multi-identifier forms break the Windows
 * build. This worker does not care either way — `semverGt` handles both — but
 * the tag format does, so it is written down here as well as in
 * `agents/skills/release-channels/SKILL.md`.
 *
 *   - isNewer relies on `semver.gt` so 0.10.0 > 0.9.0 (string sort fails this).
 */

import { gt as semverGt, valid as semverValid } from "semver";

type Env = {
  GH_REPO: string;
  GH_TAG_PREFIX: string;
  /** "stable" serves finals only; anything else also serves candidates. */
  CHANNEL: string;
  GH_TOKEN?: string;
};

type GhAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GhRelease = {
  tag_name: string;
  draft?: boolean;
  name: string;
  published_at: string;
  prerelease: boolean;
  body: string;
  assets: GhAsset[];
};

type TauriManifest = {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
};

const CACHE_TTL_SECONDS = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cache = caches.default;
    const cacheKey = new Request(url.toString());
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const path = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    let response: Response;

    if (path.length === 1 && path[0] === "versions") {
      response = await listVersions(env);
    } else if (path.length === 2) {
      response = await latestManifest(path[0], path[1], env);
    } else if (path.length === 3 && path[1] === "at") {
      response = await manifestAtVersion(path[0], path[2], env);
    } else {
      response = new Response("not found", { status: 404 });
    }

    if (response.ok || response.status === 204) {
      const cacheable = response.clone();
      cacheable.headers.set("cache-control", `public, max-age=${CACHE_TTL_SECONDS}`);
      await cache.put(cacheKey, cacheable);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;

async function listVersions(env: Env): Promise<Response> {
  const releases = await fetchReleases(env);
  const versions = releases.map((r) => ({
    version: stripTagPrefix(r.tag_name, env.GH_TAG_PREFIX),
    tag: r.tag_name,
    published_at: r.published_at,
    prerelease: r.prerelease,
  }));
  return json(versions);
}

async function latestManifest(target: string, currentVersion: string, env: Env): Promise<Response> {
  const releases = await fetchReleases(env);
  const latest = releases[0];
  if (!latest) return new Response("no releases", { status: 404 });

  const latestVersion = stripTagPrefix(latest.tag_name, env.GH_TAG_PREFIX);
  if (!isNewer(latestVersion, currentVersion)) {
    return new Response(null, { status: 204 });
  }

  const manifest = await buildManifest(target, latest, env);
  if (!manifest) {
    return new Response(`no asset for target ${target}`, { status: 404 });
  }
  return json(manifest);
}

async function manifestAtVersion(target: string, version: string, env: Env): Promise<Response> {
  const tag = `${env.GH_TAG_PREFIX}${version}`;
  const release = await fetchRelease(tag, env);
  if (!release) return new Response(`no release ${tag}`, { status: 404 });

  const manifest = await buildManifest(target, release, env);
  if (!manifest) {
    return new Response(`no asset for target ${target}`, { status: 404 });
  }
  return json(manifest);
}

/**
 * Build the Tauri updater manifest for a target/release pair.
 *
 * The `signature` field MUST be the raw text contents of the .sig file (as a
 * base64-encoded minisign signature string). The Tauri plugin parses this
 * string and verifies the downloaded binary against it; a URL in the
 * `signature` field causes verification to fail. We fetch the .sig file here
 * and inline its contents.
 *
 * Platforms-object keys: the Tauri plugin uses a "short" target for URL
 * substitution (`darwin`, `linux`, `windows`) but does the response
 * `platforms[host_target]` lookup using rustc-style host triple — e.g.
 * `darwin-aarch64` on Apple Silicon. So the URL target rarely matches the
 * lookup target. To cover both: we include every reasonable alias for the
 * incoming target, all pointing at the same asset URL (our macOS builds are
 * universal; linux/windows we only ship x86_64). This lets any plugin
 * version find a match.
 */
async function buildManifest(
  target: string,
  release: GhRelease,
  env: Env,
): Promise<TauriManifest | null> {
  const platformAsset = findPlatformAsset(target, release.assets);
  if (!platformAsset) return null;

  const sigAsset = release.assets.find((a) => a.name === `${platformAsset.name}.sig`);
  if (!sigAsset) return null;

  const sigContents = await fetchSignatureText(sigAsset.browser_download_url);
  if (sigContents === null) return null;

  const payload = {
    signature: sigContents,
    url: platformAsset.browser_download_url,
  };

  return {
    version: stripTagPrefix(release.tag_name, env.GH_TAG_PREFIX),
    notes: release.body || release.name,
    pub_date: release.published_at,
    platforms: aliasedPlatforms(target, payload),
  };
}

/**
 * Return every alias the Tauri plugin might use for `platforms[…]` lookup
 * for a given URL target. Universal macOS + single-arch linux/windows means
 * one asset URL serves all aliases.
 */
function aliasedPlatforms(
  target: string,
  payload: { signature: string; url: string },
): Record<string, { signature: string; url: string }> {
  const aliasGroups: string[][] = [
    ["darwin", "darwin-aarch64", "darwin-x86_64"],
    ["linux", "linux-x86_64"],
    ["windows", "windows-x86_64"],
  ];
  const aliases = aliasGroups.find((group) => group.includes(target)) ?? [target];
  return Object.fromEntries(aliases.map((alias) => [alias, payload]));
}

async function fetchSignatureText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.text()).trim();
}

/**
 * Match a release asset by target. Tauri's updater plugin sends bare-OS
 * targets by default (`darwin`, `linux`, `windows`).
 *
 * The patterns below track what Tauri v2 emits with
 * `createUpdaterArtifacts: true` (our `tauri.conf.json`): macOS still wraps
 * the bundle as `.app.tar.gz`, but Windows and Linux now publish the *raw*
 * installer as the updater payload — `-setup.exe` (NSIS) / `.msi` on Windows,
 * `.AppImage` on Linux — each paired with a sibling `.sig`. (Tauri v1 wrapped
 * these as `.nsis.zip` / `.msi.zip` / `.AppImage.tar.gz`; matching only those
 * was why Windows + Linux auto-update 404'd while macOS kept working.)
 *
 * Windows prefers the NSIS `-setup.exe` (the plugin's default install target)
 * and falls back to `.msi`.
 *
 * Arch-suffixed targets (`darwin-aarch64`, etc.) are kept as aliases so
 * the manual-switch flow in Settings, which constructs the URL itself,
 * continues to work if someone calls with the more specific name.
 */
function findPlatformAsset(target: string, assets: GhAsset[]): GhAsset | undefined {
  const darwinPatterns = [/\.app\.tar\.gz$/];
  const linuxPatterns = [/\.AppImage$/];
  const windowsPatterns = [/-setup\.exe$/, /\.msi$/];
  const patterns: Record<string, RegExp[]> = {
    darwin: darwinPatterns,
    "darwin-aarch64": darwinPatterns,
    "darwin-x86_64": darwinPatterns,
    linux: linuxPatterns,
    "linux-x86_64": linuxPatterns,
    windows: windowsPatterns,
    "windows-x86_64": windowsPatterns,
  };
  const candidates = patterns[target];
  if (!candidates) return undefined;
  for (const pattern of candidates) {
    const match = assets.find((a) => pattern.test(a.name));
    if (match) return match;
  }
  return undefined;
}

function stripTagPrefix(tag: string, prefix: string): string {
  return tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
}

/**
 * Decide if `latest` is newer than `current` and worth offering as an update.
 *
 * Real semver comparison via the `semver` package — critical that 0.10.0
 * reads as newer than 0.9.0 (string sort gets that wrong).
 *
 * Works for both channels: stable carries e.g. "0.3.0", preview carries
 * "0.3.0-1". Consecutive candidates compare correctly because semver orders
 * numeric pre-release identifiers numerically, and a final beats every
 * candidate of the same version — which is what lets a preview user roll onto
 * stable when it ships. release.yml's patch step bakes the same version into
 * the binary, so the client's reported `current` matches the manifest format.
 */
function isNewer(latest: string, current: string): boolean {
  if (latest === current) return false;
  const latestSemver = semverValid(latest) ?? semverValid(latest.replace(/^v/, ""));
  const currentSemver = semverValid(current) ?? semverValid(current.replace(/^v/, ""));
  if (!latestSemver || !currentSemver) return false;
  return semverGt(latestSemver, currentSemver);
}

/**
 * A candidate is a tag with a semver pre-release part — `v0.3.0-1`. Read off
 * the tag rather than off GitHub's `prerelease` flag, because that flag is a
 * publishing checkbox a human can forget and the tag is what the release was
 * actually cut as.
 */
function isCandidate(tag: string, prefix: string): boolean {
  return stripTagPrefix(tag, prefix).includes("-");
}

async function fetchReleases(env: Env): Promise<GhRelease[]> {
  const res = await ghFetch(
    `https://api.github.com/repos/${env.GH_REPO}/releases?per_page=30`,
    env,
  );
  if (!res.ok) return [];
  // SAFETY: the shape of a 200 from GitHub's releases API, which is a stable
  // documented contract. Every field this file goes on to read is either
  // checked before use (`draft`, the tag prefix) or fed to a lookup that
  // returns undefined when it is missing (`findPlatformAsset`), so a
  // response that somehow did not match degrades to 404 rather than throwing.
  const all = (await res.json()) as GhRelease[];
  const tagged = all.filter((r) => r.tag_name.startsWith(env.GH_TAG_PREFIX));
  // Draft releases have assets that may not be published yet; never offer one.
  const published = tagged.filter((r) => !("draft" in r) || r.draft !== true);
  if (env.CHANNEL !== "stable") return published;
  return published.filter((r) => !isCandidate(r.tag_name, env.GH_TAG_PREFIX));
}

async function fetchRelease(tag: string, env: Env): Promise<GhRelease | null> {
  const res = await ghFetch(
    `https://api.github.com/repos/${env.GH_REPO}/releases/tags/${encodeURIComponent(tag)}`,
    env,
  );
  if (!res.ok) return null;
  // SAFETY: as above — a 200 from the releases-by-tag endpoint, with every
  // field checked or lookup-guarded downstream.
  return (await res.json()) as GhRelease;
}

function ghFetch(url: string, env: Env): Promise<Response> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": `sefer-updater-worker/${env.CHANNEL}`,
  };
  if (env.GH_TOKEN) headers.authorization = `Bearer ${env.GH_TOKEN}`;
  return fetch(url, { headers });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      // Tauri webviews enforce browser CORS for JS fetch() calls. The
      // Settings version picker and any future webview-side caller
      // need `Access-Control-Allow-Origin: *` so the response body is
      // visible to JS. The Rust-side plugin path (auto-check, install)
      // doesn't go through CORS, but we set this here for the JS path.
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET",
      "cache-control": "no-store",
    },
  });
}
