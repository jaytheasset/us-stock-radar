import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const test = process.argv[2] === "--test";
const args = test ? ["--test", "lib/sec-ticker-resolution/automaticRunner.test.ts"]
  : [fileURLToPath(new URL("./sec-ticker-automatic.ts", import.meta.url)), ...process.argv.slice(2)];
const result = spawnSync(process.execPath, [
  "--no-warnings", "--experimental-strip-types",
  "--import", new URL("./resolve-server-only.mjs", import.meta.url).href,
  "--experimental-loader", new URL("./resolve-ts-paths.mjs", import.meta.url).href, ...args,
], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit", windowsHide: true });
process.exitCode = result.status ?? 1;
