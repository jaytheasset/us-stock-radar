import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(process.execPath, [
  "--no-warnings", "--experimental-strip-types",
  "--import", new URL("./resolve-server-only.mjs", import.meta.url).href,
  "--experimental-loader", new URL("./resolve-ts-paths.mjs", import.meta.url).href,
  fileURLToPath(new URL("./replay-sec-stored-raw-cover.ts", import.meta.url)), ...process.argv.slice(2),
], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit", windowsHide: true });
process.exitCode = result.status ?? 1;
