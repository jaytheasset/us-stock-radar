"use client";

import { useState } from "react";

type IngestResult = Record<string, unknown>;

export function GlobeIngestPanel({ canRun }: { canRun: boolean }) {
  const [limit, setLimit] = useState(1);
  const [force, setForce] = useState(false);
  const [forceConfirmation, setForceConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState("");

  async function runIngest() {
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/admin/sources/globe/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          force,
          forceConfirmation,
          limit,
          reason,
        }),
      });
      const payload = (await response.json().catch(() => null)) as IngestResult | null;
      if (!response.ok) {
        throw new Error(readError(payload) || `HTTP ${response.status}`);
      }
      setResult(readRecord(payload?.data) || payload);
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
          <p className="muted">
            Administrator-only server execution. Every run is locked and
            recorded in the append-only audit log.
          </p>
        </div>
        <span className={loading ? "pill warn" : "pill ok"}>{loading ? "Running" : "Ready"}</span>
      </div>

      {!canRun ? (
        <div className="ingest-result">
          Read-only access. Source execution is limited to Operations and
          Super Admin roles.
        </div>
      ) : (
      <div className="ingest-runner">
        <label>
          <span>Limit</span>
          <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={1}>1 item</option>
            <option value={5}>5 items</option>
            <option value={12}>12 items</option>
            <option value={20}>20 items</option>
          </select>
        </label>
        <label>
          <span>Execution reason</span>
          <input
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Required for the audit log"
            value={reason}
          />
        </label>
        <label className="ingest-checkbox">
          <input
            checked={force}
            onChange={(event) => {
              setForce(event.target.checked);
              if (!event.target.checked) setForceConfirmation("");
            }}
            type="checkbox"
          />
          <span>Force re-analysis</span>
        </label>
        {force ? (
          <div className="error-state ingest-result">
            <strong>Forced analysis ignores normal reuse safeguards.</strong>
            <label>
              Type FORCE REANALYZE
              <input
                autoComplete="off"
                onChange={(event) =>
                  setForceConfirmation(event.target.value)
                }
                value={forceConfirmation}
              />
            </label>
          </div>
        ) : null}
        <button
          disabled={
            loading ||
            reason.trim().length < 4 ||
            (force && forceConfirmation.trim() !== "FORCE REANALYZE")
          }
          onClick={runIngest}
          type="button"
        >
          {loading ? "Running..." : "Run Globe Ingest"}
        </button>
      </div>
      )}

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
  const error = readRecord(payload.error);
  return String(error?.message || payload.error || payload.message || "");
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as IngestResult)
    : null;
}
