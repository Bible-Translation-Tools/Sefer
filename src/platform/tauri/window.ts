import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Run `work` when the person closes the window, before it goes. Tauri waits
 * for the handler and destroys the window after it, so a write in flight
 * lands. A failure is the work's to report; the window closes either way.
 */
export const beforeWindowClose = (work: () => Promise<void>): void => {
  void getCurrentWindow().onCloseRequested(async () => {
    await work().catch(() => undefined);
  });
};
