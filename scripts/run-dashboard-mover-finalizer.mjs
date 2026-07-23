#!/usr/bin/env node

const baseUrl = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
const secret =
  process.env.DASHBOARD_MOVERS_CRON_SECRET || process.env.CRON_SECRET || "";

if (!baseUrl) {
  throw new Error("APP_BASE_URL is required for the dashboard mover finalizer.");
}
if (!secret) {
  throw new Error(
    "DASHBOARD_MOVERS_CRON_SECRET or CRON_SECRET is required for the dashboard mover finalizer.",
  );
}

const response = await fetch(`${baseUrl}/api/cron/dashboard-movers`, {
  method: "POST",
  cache: "no-store",
  headers: {
    Accept: "application/json",
    Authorization: `Bearer ${secret}`,
  },
});
const text = await response.text();
const body = text ? JSON.parse(text) : null;

console.log(
  JSON.stringify(
    {
      body,
      ok: response.ok,
      status: response.status,
    },
    null,
    2,
  ),
);
process.exitCode = response.ok ? 0 : 1;
