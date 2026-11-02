import { For, Show, createSignal, onCleanup } from "solid-js";

import { m } from "#app/paraglide/messages";

import { PlatformIcon, type Platform } from "./PlatformIcon";
import { Button, Card, PanelHeader } from "./primitives";

/**
 * Settings → Download Desktop Version (SEFER-85), shown only on the Web.
 *
 * PLACEHOLDER — the UI is real, the plumbing is not (paisano's):
 * - `RELEASE` is hard-coded from v0.1.0-5; it should come from the latest
 *   release for this build's channel (preview site → preview builds).
 * - The download is simulated. A browser cannot watch a download it hands to
 *   the user, so "Downloading…" only works if Sefer fetches the installer
 *   itself (then saves the bytes). No page can open the file afterwards.
 *
 * There is no "Open in desktop": a page cannot tell whether the desktop app
 * is installed, nor which version, so it does not offer to open it.
 */

type PlatformId = Extract<Platform, "mac" | "windows" | "linux">;

interface Build {
  readonly platform: PlatformId;
  /** Bytes; undefined when there is no build for that platform yet. */
  readonly size: number | undefined;
}

const RELEASE = {
  version: "0.1.0-5",
  builds: [
    // No macOS build has been published yet (the release run's Mac job was cancelled).
    { platform: "mac", size: undefined },
    { platform: "windows", size: 6_129_535 },
    { platform: "linux", size: 89_131_512 },
  ] satisfies readonly Build[],
} as const;

const platformName = (id: PlatformId): string =>
  id === "mac"
    ? m.desktop_platform_mac()
    : id === "windows"
      ? m.desktop_platform_windows()
      : m.desktop_platform_linux();

const detectPlatform = (): PlatformId => {
  const agent = globalThis.navigator?.userAgent ?? "";
  if (/Mac/i.test(agent)) return "mac";
  if (/Win/i.test(agent)) return "windows";
  return "linux";
};

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(0)} MB`;

/** One width for every row's download button, wide enough for "Download unavailable". */
const DOWNLOAD_WIDTH = "w-44 justify-center";

type Progress =
  | { readonly state: "idle" }
  | { readonly state: "downloading"; readonly percent: number }
  | { readonly state: "done" };

function DownloadRow(props: { readonly build: Build; readonly recommended: boolean }) {
  const [progress, setProgress] = createSignal<Progress>(
    { state: "idle" },
    { name: "desktopDownload" },
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => clearInterval(timer));

  const start = (): void => {
    clearInterval(timer);
    setProgress({ state: "downloading", percent: 0 });
    timer = setInterval(() => {
      const current = progress();
      const percent = current.state === "downloading" ? current.percent + 10 : 100;
      if (percent < 100) {
        setProgress({ state: "downloading", percent });
        return;
      }
      clearInterval(timer);
      setProgress({ state: "done" });
    }, 300);
  };

  const downloading = (): number | undefined => {
    const current = progress();
    return current.state === "downloading" ? current.percent : undefined;
  };

  const detail = (): string | undefined => {
    const size = props.build.size;
    if (size === undefined) return undefined;
    const percent = downloading();
    if (percent !== undefined) return m.desktop_download_progress({ percent: String(percent) });
    const details = m.desktop_download_details({ version: RELEASE.version, size: megabytes(size) });
    return progress().state === "done" ? `${m.desktop_download_done()} · ${details}` : details;
  };

  return (
    <div class="flex items-center gap-3 px-4 py-3" data-desktop-download={props.build.platform}>
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-2 text-small text-on-surface-primary">
          <PlatformIcon platform={props.build.platform} />
          {props.recommended
            ? m.desktop_download_recommended({ platform: platformName(props.build.platform) })
            : platformName(props.build.platform)}
        </p>
        <Show when={detail()}>
          {(text) => <p class="text-smallest text-on-surface-tertiary">{text()}</p>}
        </Show>
        <Show when={downloading() !== undefined}>
          <div class="mt-2 h-1 overflow-hidden rounded-full bg-surface-tertiary">
            <div
              class="h-full bg-brand transition-[width]"
              style={{ width: `${downloading() ?? 0}%` }}
            />
          </div>
        </Show>
      </div>
      <Show
        when={props.build.size !== undefined}
        fallback={
          <Button variant="secondary" class={DOWNLOAD_WIDTH} disabled>
            {m.desktop_download_unavailable()}
          </Button>
        }
      >
        <Button
          variant="secondary"
          class={DOWNLOAD_WIDTH}
          onClick={start}
          loading={downloading() !== undefined}
          disabled={downloading() !== undefined}
        >
          {progress().state === "done" ? m.desktop_download_again() : m.desktop_download_button()}
        </Button>
      </Show>
    </div>
  );
}

export function DesktopDownloadCard() {
  const current = detectPlatform();
  // The detected platform first; the rest keep their order.
  const builds = [
    ...RELEASE.builds.filter((build) => build.platform === current),
    ...RELEASE.builds.filter((build) => build.platform !== current),
  ];

  return (
    <Card
      padded={false}
      class="divide-y divide-surface-border"
      data-settings-group="desktop-download"
    >
      <div class="px-4 py-3">
        <PanelHeader
          level={3}
          title={m.desktop_download_title()}
          subtitle={m.desktop_download_description()}
        />
      </div>
      <For each={builds}>
        {(build) => (
          <DownloadRow
            build={build}
            recommended={build.platform === current && build.size !== undefined}
          />
        )}
      </For>
    </Card>
  );
}
