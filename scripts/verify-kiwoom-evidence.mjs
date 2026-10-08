import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, [
  "--no-warnings",
  "--import", new URL("./resolve-server-only.mjs", import.meta.url).href,
  "--experimental-loader", new URL("./resolve-ts-paths.mjs", import.meta.url).href,
  "--test", "--experimental-strip-types", "lib/ticker-verification/kiwoom/kiwoom.test.ts",
  "lib/ticker-verification/kiwoom/candidateLink.test.ts",
], { cwd: root, stdio: "inherit" });
if (result.error) { console.error(result.error.message); process.exitCode = 1; }
else process.exitCode = result.status ?? 1;
