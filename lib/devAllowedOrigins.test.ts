import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getAllowedDevHostnames,
  getDevelopmentAllowedOrigins,
  isAllowedDevelopmentOrigin,
  isHttpsOrAllowedDevelopmentUrl,
} from "./devAllowedOrigins.ts";

test("development origin allowlist accepts exact private origins only", () => {
  const value = [
    "http://192.168.50.25:3110",
    "http://192.168.50.25:56321",
    "http://10.0.0.8:4000/path",
    "http://user:pass@10.0.0.8:4000",
    "https://192.168.50.25:3110",
    "http://8.8.8.8:3110",
    "http://*.example.test:3110",
  ].join(",");
  const origins = getDevelopmentAllowedOrigins({
    nodeEnv: "development",
    value,
  });

  assert.ok(origins.includes("http://192.168.50.25:3110"));
  assert.ok(origins.includes("http://192.168.50.25:56321"));
  assert.ok(!origins.includes("http://10.0.0.8:4000"));
  assert.ok(!origins.includes("https://192.168.50.25:3110"));
  assert.ok(!origins.includes("http://8.8.8.8:3110"));
  assert.ok(!origins.some((origin) => origin.includes("*")));
});

test("Realtime HTTP is accepted only from the explicit development origins", () => {
  const allowed = ["http://192.168.50.25:56321"];
  assert.equal(
    isHttpsOrAllowedDevelopmentUrl("http://192.168.50.25:56321", allowed),
    true,
  );
  assert.equal(
    isHttpsOrAllowedDevelopmentUrl("http://192.168.50.26:56321", allowed),
    false,
  );
  assert.equal(
    isHttpsOrAllowedDevelopmentUrl("https://project.supabase.co", []),
    true,
  );
});

test("production ignores development allowlist completely", () => {
  const value = "http://192.168.50.25:3110";
  assert.deepEqual(
    getDevelopmentAllowedOrigins({ nodeEnv: "production", value }),
    [],
  );
  assert.equal(
    isAllowedDevelopmentOrigin(value, { nodeEnv: "production", value }),
    false,
  );
});

test("Next development hostnames come from the same exact-origin parser", () => {
  assert.deepEqual(
    getAllowedDevHostnames({
      nodeEnv: "development",
      value: "http://192.168.50.25:3110,http://192.168.50.25:56321",
    }),
    ["127.0.0.1", "localhost", "192.168.50.25"],
  );

  const nextConfig = readFileSync("next.config.ts", "utf8");
  assert.match(nextConfig, /getAllowedDevHostnames/);
  assert.doesNotMatch(nextConfig, /allowedDevOrigins:\s*\[\s*["']127\.0\.0\.1/);
});
