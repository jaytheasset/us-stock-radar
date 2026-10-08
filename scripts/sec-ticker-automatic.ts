import fs from "node:fs/promises";
import path from "node:path";
import { verifySecOfflineLocalTarget } from "../lib/sec-offline-import/localRuntime.ts";
import { withSecOfflineLocalCredentials, SecOfflineLocalTargetError } from "../lib/sec-offline-import/localTarget.ts";
import { planSecTickerAutomatic, applySecTickerAutomatic, parseAutomaticTriggerSource, AutomaticRunnerError } from "../lib/sec-ticker-resolution/automaticRunner.ts";

async function main() {
  const args = new Map<string, string>();
  const allowed = ["--input", "--mode", "--expected-api-url", "--expected-db-url", "--expected-system-identifier", "--confirm-plan-digest", "--receipt"];
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i]!, value = process.argv[i + 1];
    if (!allowed.includes(name) || !value || value.startsWith("--") || args.has(name)) throw new AutomaticRunnerError("argument_invalid");
    args.set(name, value);
  }
  const inputFile = args.get("--input"), mode = args.get("--mode") ?? "plan";
  if (!inputFile || !["plan", "apply"].includes(mode)) throw new AutomaticRunnerError("input_or_mode_invalid");
  const trigger = parseAutomaticTriggerSource(JSON.parse(await fs.readFile(inputFile, "utf8")));
  const { target, credentials } = await verifySecOfflineLocalTarget({ expectedApiUrl: args.get("--expected-api-url"),
    expectedDbUrl: args.get("--expected-db-url"), expectedSystemIdentifier: args.get("--expected-system-identifier") });
  const result = await withSecOfflineLocalCredentials(credentials, async () => {
    const input = { trigger, systemIdentifier: target.systemIdentifier };
    return mode === "plan" ? planSecTickerAutomatic(input)
      : applySecTickerAutomatic({ ...input, confirmedPlanDigest: args.get("--confirm-plan-digest") ?? "" });
  });
  const text = JSON.stringify({ mode, target, result }, null, 2) + "\n";
  if (args.has("--receipt")) {
    const file = path.resolve(args.get("--receipt")!);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, { flag: "wx" });
  }
  process.stdout.write(text);
  if (!["ready", "complete"].includes(result.status)) process.exitCode = 2;
}
main().catch((error: unknown) => {
  const code = error instanceof AutomaticRunnerError || error instanceof SecOfflineLocalTargetError ? error.code : "unexpected_failure";
  process.stderr.write(JSON.stringify({ ok: false, code }) + "\n"); process.exitCode = 1;
});
