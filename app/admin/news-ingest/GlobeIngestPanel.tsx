"use client";

import { useState } from "react";

type IngestResult = Record<string, unknown>;

export function GlobeIngestPanel() {
  const [limit, setLimit] = useState(20);
  const [force, setForce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");

  async function runIngest() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const params = new URLSearchParams({
        limit: String(limit),
      });
      if (force) params.set("force", "true");

      const response = await fetch(`/api/sources/globe/ingest?${params.toString()}`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as IngestResult | null;
      if (!response.ok) {
        throw new Error(readError(payload) || `HTTP ${response.status}`);
      }
      setResult(payload);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Unknown ingest error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="definition-card prompt-test-card">
      <div className="definition-card-header">
        <div>
          <h2>GlobeNewswire Ingest Runner</h2>
          <p className="muted">Runs raw parse, LLM analysis, canonical DB write, and duplicate/coverage guards.</p>
        </div>
        <span className={loading ? "pill warn" : "pill ok"}>{loading ? "Running" : "Ready"}</span>
      </div>

      <div className="ingest-runner">
        <label>
          <span>Limit</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={1}>1 item</option>
            <option value={12}>12 items</option>
            <option value={20}>20 items</option>
          </select>
        </label>
        <label className="ingest-checkbox">
          <input checked={force} onChange={(event) => setForce(event.target.checked)} type="checkbox" />
          <span>Force re-analysis</span>
        </label>
        <button disabled={loading} onClick={runIngest} type="button">
          {loading ? "Running..." : "Run Globe Ingest"}
        </button>
      </div>

      {error ? (
        <div className="error-state ingest-result">
          <strong>Ingest failed</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {result ? (
        <div className="ingest-result">
          <div className="prompt-test-metrics">
            {metric("ok", String(Boolean(result.ok)))}
            {metric("stage", String(result.stage || "-"))}
            {readStats(result).map(([key, value]) => metric(key, String(value)))}
          </div>
          <pre className="json-block">{JSON.stringify(result, null, 2)}</pre>
        </div>
      ) : null}
    </article>
  );
}

function readStats(result: IngestResult) {
  const stats = result.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return [];
  return Object.entries(stats as Record<string, unknown>);
}

function metric(label: string, value: string) {
  return (
    <span key={label}>
      {label}: {value}
    </span>
  );
}

function readError(payload: IngestResult | null) {
  if (!payload) return "";
  return String(payload.error || payload.message || "");
}
