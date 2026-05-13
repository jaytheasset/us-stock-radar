"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type EventRow = {
  id: string;
  ticker?: string | null;
  source_code?: string | null;
  source_channel?: string | null;
  event_type?: string | null;
  market_direction?: string | null;
  impact_level?: string | null;
  confidence?: string | null;
  title?: string | null;
  summary?: string | null;
  detected_at?: string | null;
  event_date?: string | null;
};

type EventsResponse = {
  ok: boolean;
  data: EventRow[];
  count: number;
  error?: string;
};

type HealthResponse = {
  ok: boolean;
  render?: { ok: boolean; status: number; service?: string | null };
  supabase?: { ok: boolean; status?: number; rows?: number; error?: string };
};

type IntegrationStatus = {
  key: string;
  label: string;
  ok: boolean;
  status?: number;
  detail?: string;
  error?: string;
};

type SourceJobStatus = {
  source: string;
  label: string;
  jobRoute: string;
  ok: boolean;
  checkedUrls: number;
  totalUrls: number;
  okUrls: number;
  probes: Array<{
    label: string;
    url: string;
    ok: boolean;
    status: number;
    error?: string;
  }>;
};

const impactOptions = ["", "alert", "feed", "watch", "info"];

export function RadarDashboard() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [sourceJobs, setSourceJobs] = useState<SourceJobStatus[]>([]);
  const [ticker, setTicker] = useState("");
  const [impact, setImpact] = useState("");
  const [eventType, setEventType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadEvents(next?: {
    ticker?: string;
    impact?: string;
    eventType?: string;
  }) {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ limit: "50" });
    const activeTicker = next?.ticker ?? ticker;
    const activeImpact = next?.impact ?? impact;
    const activeEventType = next?.eventType ?? eventType;

    if (activeTicker.trim()) params.set("ticker", activeTicker.trim().toUpperCase());
    if (activeImpact) params.set("impact", activeImpact);
    if (activeEventType.trim()) params.set("event_type", activeEventType.trim());

    try {
      const response = await fetch(`/api/events?${params.toString()}`);
      const payload = (await response.json()) as EventsResponse;
      if (!payload.ok) {
        throw new Error(payload.error || "Failed to load events");
      }
      setEvents(payload.data || []);
    } catch (loadError) {
      setEvents([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  }

  async function loadHealth() {
    const [healthResponse, integrationsResponse, sourceJobsResponse] = await Promise.all([
      fetch("/api/health"),
      fetch("/api/integrations/health"),
      fetch("/api/sources/health"),
    ]);
    const payload = (await healthResponse.json()) as HealthResponse;
    const integrationsPayload = (await integrationsResponse.json()) as {
      integrations?: IntegrationStatus[];
    };
    const sourceJobsPayload = (await sourceJobsResponse.json()) as {
      sources?: SourceJobStatus[];
    };
    setHealth(payload);
    setIntegrations(integrationsPayload.integrations || []);
    setSourceJobs(sourceJobsPayload.sources || []);
  }

  useEffect(() => {
    loadHealth().catch(() => setHealth({ ok: false }));
    loadEvents().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eventTypes = useMemo(() => {
    const values = new Set<string>();
    for (const event of events) {
      if (event.event_type) values.add(event.event_type);
    }
    return Array.from(values).sort();
  }, [events]);

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadEvents();
  }

  function resetFilters() {
    setTicker("");
    setImpact("");
    setEventType("");
    loadEvents({ ticker: "", impact: "", eventType: "" });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="title-block">
          <h1>US Stock Radar</h1>
          <p className="muted">Events from Supabase, served through Next.js API routes.</p>
        </div>
        <button type="button" onClick={() => loadEvents()} disabled={loading}>
          Refresh
        </button>
      </header>

      <section className="status-strip" aria-label="Connection status">
        <StatusTile
          label="Render API"
          value={health?.render?.service || "stock-alert-bot"}
          state={health?.render?.ok ? "ok" : health ? "bad" : "warn"}
          detail={health?.render ? `HTTP ${health.render.status}` : "Checking"}
        />
        <StatusTile
          label="Supabase"
          value={health?.supabase?.ok ? "Connected" : "Pending"}
          state={health?.supabase?.ok ? "ok" : health ? "bad" : "warn"}
          detail={
            health?.supabase?.ok
              ? `${health.supabase.rows ?? 0} probe row`
              : health?.supabase?.error || "Checking"
          }
        />
        <StatusTile
          label="Loaded Events"
          value={String(events.length)}
          state={error ? "bad" : loading ? "warn" : "ok"}
          detail={loading ? "Loading" : "Current view"}
        />
      </section>

      <section className="integration-panel">
        <div className="panel-header">
          <h2>API Integrations</h2>
          <span className="muted">{integrations.length || 0} configured</span>
        </div>
        <div className="integration-grid">
          {integrations.length ? (
            integrations.map((integration) => (
              <article className="integration-tile" key={integration.key}>
                <div>
                  <strong>{integration.label}</strong>
                  <p className="muted">
                    {integration.detail ||
                      integration.error ||
                      (integration.status ? `HTTP ${integration.status}` : "No detail")}
                  </p>
                </div>
                <span className={`pill ${integration.ok ? "ok" : "bad"}`}>
                  {integration.ok ? "Connected" : "Check"}
                </span>
              </article>
            ))
          ) : (
            <div className="empty-state">Checking integrations...</div>
          )}
        </div>
      </section>

      <section className="integration-panel">
        <div className="panel-header">
          <h2>Source Jobs</h2>
          <span className="muted">{sourceJobs.length || 0} configured</span>
        </div>
        <div className="source-job-list">
          {sourceJobs.length ? (
            sourceJobs.map((job) => (
              <article className="source-job-row" key={job.source}>
                <div>
                  <strong>{job.label}</strong>
                  <p className="muted">
                    {job.jobRoute} · {job.okUrls}/{job.checkedUrls} checked URL ok ·{" "}
                    {job.totalUrls} source URL{job.totalUrls === 1 ? "" : "s"}
                  </p>
                </div>
                <span className={`pill ${job.ok ? "ok" : "bad"}`}>
                  {job.ok ? "Reachable" : "Check"}
                </span>
              </article>
            ))
          ) : (
            <div className="empty-state">Checking source jobs...</div>
          )}
        </div>
      </section>

      <form className="toolbar" onSubmit={submitFilters}>
        <div className="filters">
          <div className="field">
            <label htmlFor="ticker">Ticker</label>
            <input
              id="ticker"
              value={ticker}
              onChange={(event) => setTicker(event.target.value)}
              placeholder="AAPL"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="impact">Impact</label>
            <select
              id="impact"
              value={impact}
              onChange={(event) => setImpact(event.target.value)}
            >
              {impactOptions.map((option) => (
                <option key={option || "all"} value={option}>
                  {option || "All"}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="eventType">Event Type</label>
            <input
              id="eventType"
              list="event-types"
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              placeholder="sec_current_report"
              autoComplete="off"
            />
            <datalist id="event-types">
              {eventTypes.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </div>
        </div>
        <div>
          <button type="submit" disabled={loading}>
            Apply
          </button>{" "}
          <button type="button" onClick={resetFilters} disabled={loading}>
            Reset
          </button>
        </div>
      </form>

      <section className="data-panel">
        <div className="panel-header">
          <h2>Events</h2>
          <span className={`pill ${error ? "bad" : loading ? "warn" : "ok"}`}>
            {error ? "Error" : loading ? "Loading" : "Live"}
          </span>
        </div>
        {error ? (
          <div className="error-state">{error}</div>
        ) : (
          <EventsTable events={events} loading={loading} />
        )}
      </section>
    </main>
  );
}

function StatusTile({
  label,
  value,
  detail,
  state,
}: {
  label: string;
  value: string;
  detail: string;
  state: "ok" | "bad" | "warn";
}) {
  return (
    <article className="status-tile">
      <span className="status-label">{label}</span>
      <span className="status-value">{value}</span>
      <span className={`pill ${state}`}>{detail}</span>
    </article>
  );
}

function EventsTable({
  events,
  loading,
}: {
  events: EventRow[];
  loading: boolean;
}) {
  if (loading) {
    return <div className="empty-state">Loading events...</div>;
  }

  if (!events.length) {
    return <div className="empty-state">No events found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Impact</th>
            <th>Event</th>
            <th>Title</th>
            <th>Source</th>
            <th>Detected</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="ticker">{event.ticker || "-"}</td>
              <td>
                <span className="pill">{event.impact_level || "-"}</span>
              </td>
              <td>{event.event_type || "-"}</td>
              <td className="title-cell">
                <strong>{event.title || "-"}</strong>
                {event.summary ? <div className="summary">{event.summary}</div> : null}
              </td>
              <td>{event.source_code || event.source_channel || "-"}</td>
              <td>{formatDate(event.detected_at || event.event_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
