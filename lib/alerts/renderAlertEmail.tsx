import "server-only";

import { render, toPlainText } from "react-email";
import { StockRadarAlertEmail } from "@/lib/alerts/StockRadarAlertEmail";
import type { NormalizedAlertEvent } from "@/lib/alerts/delivery/types";
import { formatEventTimeEt, getCanonicalAlertAnalysisPath } from "@/lib/telegram/telegramAlertMessage";

export async function renderAlertEmail(event: NormalizedAlertEvent, baseUrl: string, unsubscribeUrl: string) {
  const ticker = normalizeTicker(event.primaryTicker || event.tickers[0] || "");
  const company = readString(event.metadata?.company_name);
  const analysisPath = getCanonicalAlertAnalysisPath(event);
  const liveRoomUrl = ticker && event.marketScope === "company" ? absoluteUrl(baseUrl, `/live/${encodeURIComponent(ticker)}`, { event: event.id, src: "email" }) : "";
  const scoreColor = typeof event.score === "number" && event.score >= 75 ? event.signal === "bearish" ? "#ff7b8a" : event.signal === "bullish" ? "#51d6a5" : "#f2c96d" : undefined;
  const props = {
    preview: oneLine(event.quickTake || event.title, 120), ticker: ticker || undefined, company: company || undefined,
    category: titleCase(event.category.replace(/_/g, " ")), source: event.sourceLabel, eventTime: formatEventTimeEt(event.publishedAt),
    headline: oneLine(event.title, 220), quickTake: oneLine(event.quickTake || event.title, 500),
    facts: [event.signal ? { label: "Signal", value: titleCase(event.signal), color: scoreColor } : null,
      typeof event.score === "number" ? { label: "Score", value: String(event.score), color: scoreColor } : null,
      event.impact ? { label: "Impact", value: titleCase(event.impact) } : null].filter(Boolean) as Array<{ label: string; value: string; color?: string }>,
    liveRoomUrl: liveRoomUrl || undefined, analysisUrl: analysisPath ? absoluteUrl(baseUrl, analysisPath) : undefined,
    settingsUrl: absoluteUrl(baseUrl, "/alerts"), unsubscribeUrl,
  };
  const html = await render(<StockRadarAlertEmail {...props} />);
  return { html, text: toPlainText(html), subject: `${ticker ? `$${ticker} ` : ""}${props.headline}`.slice(0, 180) };
}
function absoluteUrl(baseUrl: string, path: string, search?: Record<string, string>) { const url = new URL(path, baseUrl); for (const [key, value] of Object.entries(search || {})) url.searchParams.set(key, value); return url.toString(); }
function normalizeTicker(value: string) { const ticker = value.trim().toUpperCase(); return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : ""; }
function readString(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function titleCase(value: string) { return value.replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function oneLine(value: string, max: number) { const text = value.replace(/\s+/g, " ").trim() || "New market event detected."; return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`; }
