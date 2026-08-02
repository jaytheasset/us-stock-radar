import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildLanDevelopmentValues,
  rewriteLocalEnv,
  rewriteSupabaseAuthConfig,
} from "./configure-lan-dev-lib.mjs";

const host = readHostArgument(process.argv.slice(2));
const envPath = resolve(".env.local");
const configPath = resolve("supabase/config.toml");
const values = buildLanDevelopmentValues(host);

const envContent = readFileSync(envPath, "utf8");
const configContent = readFileSync(configPath, "utf8");
const nextEnvContent = rewriteLocalEnv(envContent, values);
const nextConfigContent = rewriteSupabaseAuthConfig(
  configContent,
  values.appOrigin,
);

writeFileSync(envPath, nextEnvContent, "utf8");
writeFileSync(configPath, nextConfigContent, "utf8");

console.log(`LAN app origin: ${values.appOrigin}`);
console.log(`LAN Supabase API: ${values.supabaseOrigin}`);
console.log("Updated only APP_BASE_URL, SUPABASE_URL, and DEV_ALLOWED_ORIGINS in .env.local.");
console.log("No secret values were printed or changed.");
console.log("Restart the Next.js dev server to load the environment changes.");
console.log("Apply the Auth URL change only with a deliberate Supabase stop/start; this script never starts or stops it.");

function readHostArgument(args) {
  const index = args.indexOf("--host");
  const value = index >= 0 ? args[index + 1] : "";
  if (!value || value.startsWith("--")) {
    throw new Error("Usage: npm run dev:configure-lan -- --host 192.168.x.x");
  }
  return value;
}
