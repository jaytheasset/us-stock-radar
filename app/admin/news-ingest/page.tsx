import Link from "next/link";
import type { ReactNode } from "react";
import { GlobeIngestPanel } from "@/app/admin/news-ingest/GlobeIngestPanel";
import styles from "@/components/admin/AdminSection.module.css";
import { fetchEventCount, supabaseSelect } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function NewsIngestAdminPage() {
  const [alertCount, feedCount, archiveCount, recentRuns, skippedRaw, recentEvents] = await Promise.all([
    fetchEventCount({ sourceGroup: "news", deliveryLevel: "alert" }),
    fetchEventCount({ sourceGroup: "news", deliveryLevel: "feed" }),
    fetchEventCount({ sourceGroup: "news", deliveryLevel: "archive" }),
    supabaseSelect("source_runs", {
      select: "*",
      source_code: "eq.globe",
      order: "started_at.desc",
      limit: "8",
    }),
    supabaseSelect("raw_items", {
      select: "id,source_unique_id,title,published_at,metadata",
      source_code: "eq.globe",
      "metadata->>ingest_decision": "eq.outside_us_market_coverage",
      order: "fetched_at.desc",
      limit: "8",
    }),
    supabaseSelect("events", {
      select: "id,title,ticker,market,event_type,score,delivery_level,signal,market_scope,detected_at",
      source_code: "eq.globe",
      order: "detected_at.desc",
      limit: "10",
    }),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div className="title-block">
          <h1>News Ingest</h1>
          <p className="muted">GlobeNewswire collection, LLM analysis, event storage, and coverage QA.</p>
        </div>
        <div className="prompt-test-actions">
          <Link className="text-link" href="/admin/prompts/news-event-test?dryRun=true">
            Prompt Dry Run
          </Link>
          <Link className="text-link" href="/news">
            News
          </Link>
        </div>
      </header>

      <section className="admin-grid ingest-status-grid">
        <StatusTile label="Alert" value={alertCount.count ?? 0} tone="bad" />
        <StatusTile label="Feed" value={feedCount.count ?? 0} tone="ok" />
        <StatusTile label="Archive" value={archiveCount.count ?? 0} tone="warn" />
        <StatusTile label="Outside Coverage" value={skippedRaw.count ?? rowCount(skippedRaw.data)} tone="muted" />
      </section>

      <section className="definition-list">
        <GlobeIngestPanel />

        <article className="definition-card">
          <div className="definition-card-header">
            <div>
              <h2>Recent Globe Runs</h2>
              <p className="muted">Source run status, stats, and failure visibility.</p>
            </div>
          </div>
          <IngestTable
            columns={["Started", "Status", "Checked", "Analyzed", "Events", "Skipped", "Outside"]}
            rows={records(recentRuns.data).map((run) => [
              formatDate(run.started_at),
              String(run.status || "-"),
              stat(run, "checked_count"),
              stat(run, "analyzed_count"),
              stat(run, "event_upserted_count"),
              stat(run, "skipped_count"),
              stat(run, "skipped_outside_coverage_count"),
            ])}
          />
        </article>

        <article className="definition-card">
          <div className="definition-card-header">
            <div>
              <h2>Latest Stored Globe Events</h2>
              <p className="muted">What actually reached events after archive/feed/alert routing.</p>
            </div>
          </div>
          <IngestTable
            columns={["Event", "Ticker", "Type", "Signal", "Level", "Impact"]}
            rows={records(recentEvents.data).map((event) => [
              <Link href={`/events/${String(event.id)}`} key="event">
                {String(event.title || "-")}
              </Link>,
              [event.market, event.ticker].filter(Boolean).join(":") || "-",
              String(event.event_type || "-"),
              String(event.signal || "-"),
              String(event.delivery_level || "-"),
              String(event.score ?? "-"),
            ])}
          />
        </article>

        <article className="definition-card">
          <div className="definition-card-header">
            <div>
              <h2>Outside U.S. Market Coverage</h2>
              <p className="muted">Raw items retained for dedupe, but not shown as events or archive pages.</p>
            </div>
          </div>
          <IngestTable
            columns={["Published", "Globe ID", "Title", "Reason"]}
            rows={records(skippedRaw.data).map((raw) => [
              formatDate(raw.published_at),
              String(raw.source_unique_id || "-"),
              String(raw.title || "-"),
              String(readRecord(raw.metadata)?.coverage_reason || "-"),
            ])}
          />
        </article>
      </section>
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "ok" | "warn" | "bad" | "muted";
}) {
  return (
    <article className="admin-card ingest-status-tile">
      <span className={`pill ${tone === "muted" ? "" : tone}`}>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function IngestTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<ReactNode>>;
}) {
  if (!rows.length) {
    return <p className="muted ingest-empty">No rows.</p>;
  }

  return (
    <div className="ingest-table-wrap">
      <table className="ingest-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function rowCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stat(row: Record<string, unknown>, key: string) {
  const stats = readRecord(row.stats);
  return String(stats?.[key] ?? "-");
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "-";
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z").slice(0, 19);
}
