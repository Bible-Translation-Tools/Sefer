import { createSignal, onCleanup } from "solid-js";

import { detectHost } from "#platform/host";

import type { Services } from "../services";

export const createUpdateCheck = (services: Services) => {
  const [updateAvailable, setUpdateAvailable] = createSignal(false, { name: "updateAvailable" });
  if (detectHost() === "tauri") {
    const askAt = setTimeout(() => {
      void services
        .run(services.updater.check())
        .then((answer) => setUpdateAvailable(answer._tag === "Available"))
        .catch(() => setUpdateAvailable(false));
    }, 5000);
    onCleanup(() => clearTimeout(askAt));
  }
  return { updateAvailable };
};
