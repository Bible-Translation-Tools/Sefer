import type { JSX } from "@solidjs/web";
import Wifi from "lucide-solid/icons/wifi";
import WifiOff from "lucide-solid/icons/wifi-off";
import { For, Show, createSignal } from "solid-js";

import { m } from "../../paraglide/messages";
import { useShell } from "../../ProjectContext";
import { shellKeys } from "../../settings";
import { syncStatus } from "../../syncStatus";
import { Button, Popover, SegmentedControl, Tooltip, cx } from "../primitives";

/**
 * The app bar's save status: "All changes saved", "Saving changes…" while the
 * backup is being written, then "Saved" once it has been. A tooltip says what
 * that means. It reports the backup as the backup itself reports it.
 */
export function SaveStatus() {
  const shell = useShell();
  const label = (): string => {
    const state = shell.backup();
    if (state.kind === "saving") return m.status_saving();
    if (state.kind === "failed") return m.status_not_saved();
    return m.status_saved();
  };
  const explained = (): string => {
    const state = shell.backup();
    if (state.kind === "saving") return m.status_saving_tooltip();
    if (state.kind === "failed") return m.status_backup_failed_body();
    return m.status_saved_tooltip();
  };

  // Every label sits in the same grid cell, the others invisible, so the
  // status is always as wide as its longest words and nothing beside it moves.
  return (
    <Tooltip label={explained()} side="bottom">
      <span
        tabindex="0"
        aria-live="polite"
        data-testid="app-bar-save-status"
        data-backup={shell.backup().kind}
        class={cx(
          "grid shrink-0 rounded-md px-1 text-small whitespace-nowrap",
          shell.backup().kind === "failed"
            ? "text-on-surface-warning"
            : "text-on-surface-secondary",
        )}
      >
        <For each={[m.status_saving(), m.status_saved(), m.status_not_saved()]}>
          {(text) => (
            <span
              class={cx("[grid-area:1/1]", text !== label() && "invisible")}
              aria-hidden={text === label() ? undefined : "true"}
            >
              {text}
            </span>
          )}
        </For>
      </span>
    </Tooltip>
  );
}

type Connection = "online" | "offline";

/**
 * The Online / Offline chip. The person can choose to work offline (Sefer
 * then reaches no server). Under the switch, the popover says where the work
 * stands with WACS and what to do next (`body`, from the sync chip).
 */
export function NetworkChip(props: {
  readonly attention: "none" | "tint" | "alert";
  readonly onOpenChange: (open: boolean) => void;
  /** What sits under the switch: the WACS state online, what waits offline. */
  readonly body: (close: () => void) => JSX.Element;
}) {
  const shell = useShell();
  const settings = shell.services.settings;
  const key = shellKeys(settings).workOffline;
  const [open, setOpen] = createSignal(false, { name: "networkOpen" });

  const connected = (): boolean => syncStatus.online();
  const choose = (next: Connection): void => {
    const offline = next === "offline";
    syncStatus.setWorkOffline(offline);
    void shell.services.run(settings.set(key, offline));
  };
  return (
    <Popover
      label={m.network_connection()}
      side="bottom"
      align="start"
      fitViewport
      class="w-[min(420px,92vw)] rounded-[12px]! p-3!"
      open={open()}
      onOpenChange={(next) => {
        setOpen(next);
        props.onOpenChange(next);
      }}
      trigger={
        <Button
          variant="secondary"
          class={cx(
            "relative h-8! shrink-0 gap-1.5! rounded-full! px-3! text-small! [&>svg]:size-5!",
            // Open, the pill keeps its own colour rather than the buttons' blue
            // pressed look: dark green online, the hover grey offline.
            connected()
              ? "border-transparent! bg-surface-success text-on-surface-success hover:not-disabled:bg-on-surface-success! hover:not-disabled:text-button-primary-on-surface! aria-pressed:bg-on-surface-success! aria-pressed:text-button-primary-on-surface!"
              : "aria-pressed:border-button-secondary-border! aria-pressed:bg-button-secondary-surface-hover! aria-pressed:text-button-secondary-on-surface!",
          )}
          icon={connected() ? <Wifi size={20} /> : <WifiOff size={20} />}
          aria-pressed={open() ? "true" : "false"}
          data-testid="app-bar-network"
          data-online={connected() ? "true" : "false"}
        >
          <span class="whitespace-nowrap">
            {connected() ? m.network_online() : m.network_offline()}
          </span>
          <Show when={props.attention !== "none" && !syncStatus.workOffline()}>
            <span
              aria-hidden="true"
              class={cx(
                "absolute -end-0.5 -top-0.5 size-2.5 rounded-full",
                props.attention === "alert" ? "bg-on-surface-warning" : "bg-brand",
              )}
            />
          </Show>
        </Button>
      }
    >
      <div class="space-y-4" data-status="network">
        <div class="space-y-1 text-center">
          <h2 class="text-h4 font-semibold text-on-surface-primary">
            {syncStatus.workOffline() ? m.network_you_are_offline() : m.network_you_are_online()}
          </h2>
        </div>
        <SegmentedControl<Connection>
          label={m.network_connection()}
          size="lg"
          class="w-full"
          value={syncStatus.workOffline() ? "offline" : "online"}
          onChange={choose}
          items={[
            { value: "online", label: m.network_online(), icon: <Wifi aria-hidden="true" /> },
            {
              value: "offline",
              label: m.network_offline(),
              icon: <WifiOff aria-hidden="true" />,
            },
          ]}
        />
        {props.body(() => setOpen(false))}
      </div>
    </Popover>
  );
}
