import { For, Show, createSignal } from "solid-js";

import {
  downloadsConfigured,
  latestDownloads,
  type DesktopDownloads,
  type DesktopPlatform,
} from "#app/desktopDownloads";
import { m } from "#app/paraglide/messages";
import { useServices } from "#app/ProjectContext";

import { PlatformIcon } from "./PlatformIcon";
import { Button, ButtonLink, Card, PanelHeader } from "./primitives";

/**
 * Settings → Download Desktop Version (SEFER-85), shown only on the Web.
 *
 * The installers are this build's channel's latest release, as the updater
 * worker lists them (`#app/desktopDownloads`). A download is a plain link the
 * browser saves itself, with its own progress, pause and cancel: a page cannot
 * watch a download it hands over, and fetching an installer into the page to
 * show a percentage would hold the whole file in memory. A platform the
 * release has no installer for (macOS, so far) says so.
 *
 * There is no "Open" and no "Open in desktop": a page cannot open a file it
 * downloaded, nor tell whether the desktop app is installed.
 */

type PlatformId = DesktopPlatform;

const PLATFORMS: readonly PlatformId[] = ["mac", "windows", "linux"];

type Release =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly downloads: DesktopDownloads }
  | { readonly state: "unavailable"; readonly reason: string };

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

function DownloadRow(props: {
  readonly platform: PlatformId;
  readonly release: Release;
  readonly recommended: boolean;
}) {
  const build = () =>
    props.release.state === "ready"
      ? props.release.downloads.builds.find((row) => row.platform === props.platform)
      : undefined;
  const detail = (): string | undefined => {
    const found = build();
    if (found === undefined || props.release.state !== "ready") return undefined;
    return m.desktop_download_details({
      version: props.release.downloads.version,
      size: megabytes(found.size),
    });
  };

  return (
    <div class="flex items-center gap-3 px-4 py-3" data-desktop-download={props.platform}>
      <div class="min-w-0 flex-1">
        <p class="flex items-center gap-2 text-small text-on-surface-primary">
          <PlatformIcon platform={props.platform} />
          {props.recommended
            ? m.desktop_download_recommended({ platform: platformName(props.platform) })
            : platformName(props.platform)}
        </p>
        <Show when={detail()}>
          {(text) => <p class="text-smallest text-on-surface-tertiary">{text()}</p>}
        </Show>
      </div>
      <Show
        when={build()}
        fallback={
          <Button
            variant="secondary"
            class={DOWNLOAD_WIDTH}
            loading={props.release.state === "loading"}
            disabled
          >
            {props.release.state === "loading"
              ? m.desktop_download_button()
              : m.desktop_download_unavailable()}
          </Button>
        }
      >
        {(found) => (
          <ButtonLink
            variant="secondary"
            class={DOWNLOAD_WIDTH}
            href={found().url}
            download={found().name}
            data-desktop-download-link
          >
            {m.desktop_download_button()}
          </ButtonLink>
        )}
      </Show>
    </div>
  );
}

export function DesktopDownloadCard() {
  const services = useServices();
  const current = detectPlatform();
  // The detected platform first; the rest keep their order.
  const platforms = [current, ...PLATFORMS.filter((platform) => platform !== current)];

  const [release, setRelease] = createSignal<Release>(
    downloadsConfigured()
      ? { state: "loading" }
      : { state: "unavailable", reason: m.desktop_download_not_configured() },
    { name: "desktopRelease" },
  );
  if (downloadsConfigured()) {
    const operation = services.composition.observability.operation("desktop.downloads");
    latestDownloads().then(
      (downloads) => {
        operation.end("passed", { "downloads.builds": downloads.builds.length });
        setRelease({ state: "ready", downloads });
      },
      (cause: unknown) => {
        const reason = cause instanceof Error ? cause.message : String(cause);
        operation.end("unavailable", { "downloads.reason": reason });
        setRelease({ state: "unavailable", reason: m.desktop_download_failed({ reason }) });
      },
    );
  }

  const offered = (platform: PlatformId): boolean => {
    const now = release();
    return now.state === "ready" && now.downloads.builds.some((row) => row.platform === platform);
  };
  const note = (): string | undefined => {
    const now = release();
    return now.state === "unavailable" ? now.reason : undefined;
  };

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
        <Show when={note()}>
          {(text) => (
            <p class="mt-1 text-smallest text-on-surface-tertiary" data-desktop-download-note>
              {text()}
            </p>
          )}
        </Show>
      </div>
      <For each={platforms}>
        {(platform) => (
          <DownloadRow
            platform={platform}
            release={release()}
            recommended={platform === current && offered(platform)}
          />
        )}
      </For>
    </Card>
  );
}
