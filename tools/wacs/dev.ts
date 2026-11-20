/**
 * `pnpm dev:wacs`: the dev server, built to talk to the local WACS
 * (`pnpm wacs:up`). The addresses come from `LOCAL_WACS`, the one place they
 * are written; a VITE_ variable already in the environment beats a .env
 * file, so nothing on disk changes. Extra arguments go to Vite.
 */
import { spawn } from "node:child_process";

import { LOCAL_WACS, WEB_TRANSPORT_SPEC } from "../../src/core/remote/channels.ts";

const vite = spawn("pnpm", ["exec", "vite", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_SEFER_CONTENT_HOST: LOCAL_WACS.contentHost,
    VITE_SEFER_CATALOGUE_URL: LOCAL_WACS.catalogueUrl,
    VITE_SEFER_WEB_TRANSPORT: WEB_TRANSPORT_SPEC,
  },
});
vite.on("exit", (code) => process.exit(code ?? 0));
