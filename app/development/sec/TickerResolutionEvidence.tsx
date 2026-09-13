"use client";

import { useEffect, useState } from "react";
import styles from "./sec-development.module.css";

type Row = Record<string, unknown>;
type ResolutionPayload = Readonly<{
  decision: Row;
  identity: Row | null;
  evidence: Row | null;
  evaluation: Row;
  sourceObservations: Readonly<{
    before: readonly Row[];
    after: readonly Row[];
  }>;
}>;

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "available"; resolution: ResolutionPayload };

export function TickerResolutionEvidence({
  resolutionId,
  room,
}: {
  resolutionId: string;
  room: string;
}) {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    if (!resolutionId) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    const params = new URLSearchParams({ room, view: "resolution", resolutionId });
    fetch(`/api/development/sec-form-room?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || !payload.ok || !payload.resolution) {
          throw new Error(
            payload?.error?.message || "The exact ticker resolution could not be loaded.",
          );
        }
        return payload.resolution as ResolutionPayload;
      })
      .then((resolution) => {
        if (!cancelled) setState({ status: "available", resolution });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Ticker resolution read unavailable.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resolutionId, room]);

  if (!resolutionId) {
    return (
      <div className={styles.reviewEmptyState} role="status">
        Open an exact decision from the administrator ticker-resolution list. This view never chooses a latest relationship implicitly.
      </div>
    );
  }
  if (state.status === "idle" || state.status === "loading") {
    return <div className={styles.reviewEmptyState} role="status">Loading the exact validated decision…</div>;
  }
  if (state.status === "error") {
    return (
      <div className={styles.errorBox} role="alert">
        {state.message} The record is not presented as a confirmed relationship.
      </div>
    );
  }
  if (state.status !== "available") {
    return <div className={styles.reviewEmptyState} role="status">Ticker resolution read unavailable.</div>;
  }

  const { decision, identity, evidence, evaluation, sourceObservations } = state.resolution;
  const summary = record(evaluation.summary);
  const relationship = record(record(decision.decision_payload).relationship);
  const resolutionState = text(decision.resolution_state);
  const reasons = stringArray(decision.rule_reasons);

  return (
    <section aria-labelledby="ticker-resolution-evidence-heading" className={styles.resolutionWorkspace}>
      <header className={styles.resolutionHero}>
        <div>
          <span>Exact saved decision</span>
          <h3 id="ticker-resolution-evidence-heading">
            {display(relationship.oldTicker)} → {display(relationship.newTicker)}
          </h3>
          <p className={styles.resolutionMono}>Issuer CIK {text(decision.issuer_cik)} · {text(decision.id)}</p>
        </div>
        <strong data-state={resolutionState}>{resolutionState}</strong>
      </header>

      <div className={styles.resolutionNotice}>
        This deterministic relationship and its retained SEC evidence are displayed independently of site AI analysis results. No review or mutation action is available here.
      </div>

      <div className={styles.resolutionGrid}>
        <ResolutionCard title="Target security" values={[
          ["Type", humanize(text(identity?.security_type) || text(summary.securityType) || "unresolved")],
          ["Class", text(identity?.security_class) || text(summary.securityClass) || "Not recorded"],
          ["Before title", text(identity?.before_security_title) || "Not resolved"],
          ["After title", text(identity?.after_security_title) || "Not resolved"],
        ]} />
        <ResolutionCard title="Effective change" values={[
          ["Old ticker", display(relationship.oldTicker)],
          ["New ticker", display(relationship.newTicker)],
          ["Date", text(evidence?.effective_date) || text(summary.effectiveDate) || "Unresolved"],
          ["Timestamp", text(evidence?.effective_at) || "No exact timestamp claimed"],
          ["Precision", humanize(text(evidence?.effective_precision) || text(summary.effectivePrecision) || "unknown")],
          ["Basis", humanize(text(evidence?.continuity_basis) || text(summary.continuityBasis) || "unresolved")],
        ]} />
        <ResolutionCard title="Method and lineage" values={[
          ["Resolution type", humanize(text(decision.resolution_type))],
          ["Method", text(decision.method)],
          ["Version", text(decision.method_version)],
          ["Before accession", text(decision.before_accession_number)],
          ["After accession", text(decision.after_accession_number)],
          ["Evidence accession", text(decision.evidence_accession_number)],
        ]} />
      </div>

      <section className={styles.resolutionSection}>
        <header><span>Source observations</span><h4>Historical symbols remain attached to their exact filing contexts</h4></header>
        <div className={styles.resolutionObservationColumns}>
          <ObservationList label="Before" observations={sourceObservations.before} />
          <ObservationList label="After" observations={sourceObservations.after} />
        </div>
      </section>

      <section className={styles.resolutionSection}>
        <header><span>Decision rules</span><h4>{reasons.length} recorded reason{reasons.length === 1 ? "" : "s"}</h4></header>
        <ul className={styles.resolutionReasonList}>
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      </section>

      <section className={styles.resolutionSection}>
        <header><span>Primary document evidence</span><h4>{text(evidence?.source_document) || "No relationship evidence row"}</h4></header>
        {evidence ? (
          <>
            <dl className={styles.resolutionFacts}>
              <div><dt>Accession</dt><dd>{text(evidence.source_accession_number)}</dd></div>
              <div><dt>Document</dt><dd>{text(evidence.source_document)}</dd></div>
              <div><dt>Effective text</dt><dd>{text(evidence.effective_text)}</dd></div>
              <div><dt>Location</dt><dd>{String(evidence.source_text_span_start)}–{String(evidence.source_text_span_end)}</dd></div>
              <div><dt>Text rules</dt><dd>{text(evidence.source_text_method)} · {text(evidence.source_text_version)}</dd></div>
              <div><dt>Extraction</dt><dd>{text(evidence.extraction_method)} · {text(evidence.extraction_version)}</dd></div>
              <div><dt>Span SHA-256</dt><dd className={styles.resolutionMono}>{text(evidence.source_text_span_sha256)}</dd></div>
              <div><dt>Source SHA-256</dt><dd className={styles.resolutionMono}>{text(evidence.source_sha256)}</dd></div>
            </dl>
            <pre className={styles.resolutionEvidenceText}>{textPreserve(evidence.source_text_span)}</pre>
            {text(evidence.source_url) ? <a className={styles.resolutionSourceLink} href={text(evidence.source_url)}>Open original SEC document</a> : null}
          </>
        ) : (
          <div className={styles.recordMissing}>
            <strong>Not resolved</strong>
            <p>This REVIEW or UNRESOLVED decision has no confirmed relationship evidence row. Its source observations and reasons remain visible above.</p>
          </div>
        )}
      </section>
    </section>
  );
}

function ResolutionCard({ title, values }: { title: string; values: Array<[string, string]> }) {
  return (
    <article className={styles.resolutionCard}>
      <h4>{title}</h4>
      <dl>
        {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}
      </dl>
    </article>
  );
}

function ObservationList({ label, observations }: { label: string; observations: readonly Row[] }) {
  return (
    <article className={styles.resolutionObservationList}>
      <h5>{label} observations · {observations.length}</h5>
      {observations.length ? observations.map((observation) => (
        <dl key={`${text(observation.resultId)}-${text(observation.observationKey)}`}>
          <div><dt>Symbol</dt><dd>{display(observation.tradingSymbol)}</dd></div>
          <div><dt>Symbol status</dt><dd>{text(observation.tradingSymbolStatus) || "Not recorded"}</dd></div>
          <div><dt>Security</dt><dd>{text(observation.securityTitle) || "Not observed"}</dd></div>
          <div><dt>Security status</dt><dd>{text(observation.securityTitleStatus) || "Not recorded"}</dd></div>
          <div><dt>Exchange</dt><dd>{text(observation.exchange) || "Not observed"}</dd></div>
          <div><dt>Exchange status</dt><dd>{text(observation.exchangeStatus) || "Not recorded"}</dd></div>
          <div><dt>Accession</dt><dd>{text(observation.accessionNumber)}</dd></div>
          <div><dt>Accepted</dt><dd>{text(observation.acceptedAt) || "Not recorded"}</dd></div>
          <div><dt>Source document</dt><dd>{text(observation.sourceDocument) || "Not recorded"}</dd></div>
          <div><dt>Source SHA-256</dt><dd className={styles.resolutionMono}>{text(observation.sourceSha256) || "Not recorded"}</dd></div>
          <div><dt>Context</dt><dd className={styles.resolutionMono}>{text(observation.contextRef)}</dd></div>
          <div><dt>Evidence key</dt><dd className={styles.resolutionMono}>{text(observation.observationKey)}</dd></div>
          <div><dt>Dimensions</dt><dd className={styles.resolutionMono}>{JSON.stringify(observation.dimensions || [])}</dd></div>
          {text(observation.sourceUrl) ? (
            <div>
              <dt>Source URL</dt>
              <dd className={styles.resolutionMono}>
                <a className={styles.resolutionSourceLink} href={text(observation.sourceUrl)}>{text(observation.sourceUrl)}</a>
              </dd>
            </div>
          ) : null}
        </dl>
      )) : <p>No source observation was available for this side.</p>}
    </article>
  );
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textPreserve(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function display(value: unknown) {
  return text(value) || "Unresolved";
}

function humanize(value: string) {
  return value ? value.replaceAll("_", " ") : "—";
}
