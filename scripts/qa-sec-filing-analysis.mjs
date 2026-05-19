#!/usr/bin/env node

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const baseUrl = String(args.get("base") || process.env.APP_LOCAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const ticker = String(args.get("ticker") || "CGC");
const dryRun = args.get("dryRun") === "true";
const force = args.get("force") !== "false";
const checks = [];

try {
  const result = await postJson(
    `/api/sources/sec/analyze?ticker=${encodeURIComponent(ticker)}&calendarCandidate=true&dryRun=${dryRun ? "true" : "false"}&force=${force ? "true" : "false"}`,
    {},
  );

  check("SEC filing analysis returns ok", result.ok === true, result);
  check("SEC filing analysis selected source item", Boolean(result.sourceItem?.id), result.sourceItem);
  check("SEC filing analysis produced analysis", Boolean(result.analysis), result.analysis);
  check("SEC filing analysis produced calendar items", Array.isArray(result.analysis?.calendar_items), result.analysis);
  if (result.skipped || result.stage === "skipped") {
    check("SEC filing analysis skipped without persistence", result.skipped === true && !result.event?.id, result);
    check("SEC filing analysis skip has reason", Boolean(result.skipReason || result.analysis?.archive_summary), result);
  }

  if (!dryRun && !result.skipped && result.stage !== "skipped") {
    const calendarItems = Array.isArray(result.calendarItems) ? result.calendarItems : [];
    check("SEC filing event was persisted", Boolean(result.event?.id), result.event);
    check("SEC filing calendar rows persisted", calendarItems.length > 0, result);
    check("SEC filing calendar rows are confirmed when exact", calendarItems.some((item) => item.calendar_status === "confirmed"), calendarItems);
  }

  console.log(
    JSON.stringify(
      {
        ok: checks.every((item) => item.ok),
        summary: {
          baseUrl,
          ticker,
          dryRun,
          force,
          skipped: Boolean(result.skipped),
          skipReason: result.skipReason || null,
          prompt: result.prompt || null,
          costEstimate: result.costEstimate || null,
          selected: result.sourceItem,
          event: result.event
            ? {
                id: result.event.id,
                title: result.event.title,
                ticker: result.event.ticker,
                event_type: result.event.event_type,
                score: result.event.score,
                delivery_level: result.event.delivery_level,
                signal: result.event.signal,
              }
            : null,
          calendarItems: (result.calendarItems || result.analysis?.calendar_items || []).map((item) => ({
            calendar_event_type: item.calendar_event_type,
            calendar_title: item.calendar_title,
            event_date: item.event_date,
            event_time: item.event_time,
            event_timezone: item.event_timezone,
            date_precision: item.date_precision,
            is_estimated: item.is_estimated,
            confidence: item.confidence,
            calendar_status: item.calendar_status,
            evidence: item.evidence,
          })),
        },
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = checks.every((item) => item.ok) ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`POST ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function short(value) {
  return String(value).length > 700 ? `${String(value).slice(0, 700)}...` : String(value);
}
