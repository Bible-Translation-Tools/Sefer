import type { NetworkGate } from "#core/network/gate";

import type { Services } from "./services";
import { shellKeys } from "./settings";
import { syncStatus } from "./syncStatus";

/**
 * The app's gate. "Work offline" closes it for every action; there are no
 * per-action exceptions, so a sensitive install reaches no server at all.
 */
export const network: NetworkGate = {
  may: () => !syncStatus.workOffline(),
};

/** The person's choice, in force at once and remembered on this device. */
export const chooseWorkOffline = (services: Services, offline: boolean): void => {
  syncStatus.setWorkOffline(offline);
  void services.run(services.settings.set(shellKeys(services.settings).workOffline, offline));
};
