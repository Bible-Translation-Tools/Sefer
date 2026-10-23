import { execFileSync } from "node:child_process";
import process from "node:process";

export const run = (
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): void => {
  process.stdout.write(`$ ${command} ${args.join(" ")}\n`);
  execFileSync(command, [...args], { stdio: "inherit", ...options });
};
