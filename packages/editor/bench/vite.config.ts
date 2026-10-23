import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * The editor bench: `@sefer/editor` mounted by a host that is not Sefer.
 * `pnpm editor:bench` serves it; nothing builds or ships it.
 *
 * Tailwind is here only because the token sheet the bench borrows from Sefer
 * opens with `@import "tailwindcss"`.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [tailwindcss()],
  server: { port: 4410 },
});
