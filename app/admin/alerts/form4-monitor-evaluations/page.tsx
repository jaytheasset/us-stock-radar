import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import {
  listForm4MonitorEvaluationAdminRecords,
  type Form4MonitorEvaluationAdminRecord,
} from "@/lib/admin/form4MonitorEvaluations";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function Form4MonitorEvaluationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ evaluationId?: string | string[] }> }>) {
  await requireAdminPermission("system.read");
  const params = await searchParams;
  const requestedId = typeof params.evaluationId === "string" ? params.evaluationId : "";
  let records: Form4MonitorEvaluationAdminRecord[] | null = null;
  try {
    records = await listForm4MonitorEvaluationAdminRecords(150);
  } catch {
    records = null;
  }
  const selected = requestedId
    ? records?.find((record) => record.id === requestedId) ?? null
    : records?.[0] ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Persisted actual consumer history</span>
          <h1>Form 4 monitor evaluations</h1>
          <p>Read-only evaluation and internal-alert outcomes captured by the actual matcher and consumer. This page does not infer missing facts or call an LLM.</p>
        </div>
        <span className={styles.badge}>system.read</span>
      </header>

      {records === null ? (
        <section className={styles.error}><strong>Evaluation history unavailable.</strong> The service-owned record could not be read; this is not evidence that no evaluation exists.</section>
      ) : records.length === 0 ? (
        <section className={styles.empty}><strong>Not evaluated / no persisted record.</strong><p>No actual Form 4 matcher-consumer attempt has been recorded.</p></section>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Evaluated</th><th>Filing</th><th>Monitor</th><th>Match</th><th>Notification / dedupe</th></tr></thead>
              <tbody>{records.map((record) => (
                <tr key={record.id}>
                  <td><Link href={`/admin/alerts/form4-monitor-evaluations?evaluationId=${record.id}`}>{formatTime(record.evaluatedAt)}</Link><br /><span className={styles.mono}>{record.id}</span></td>
                  <td>{text(record.filingSnapshot.ticker)}<br /><span className={styles.mono}>{text(record.filingSnapshot.accessionNumber) || record.eventId}</span></td>
                  <td><span className={styles.mono}>{record.monitorId}</span></td>
                  <td>{record.evaluationStatus}<br /><span className={styles.muted}>{record.evaluationReasonCode}</span></td>
                  <td>{record.notificationStatus}<br /><span className={styles.muted}>{record.notificationReasonCode}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {selected ? <EvaluationDetail record={selected} /> : requestedId ? (
            <section className={styles.empty}><strong>Not evaluated / no persisted record.</strong><p>The requested evaluation ID is not present in the persisted actual history.</p></section>
          ) : null}
        </>
      )}
    </div>
  );
}

function EvaluationDetail({ record }: Readonly<{ record: Form4MonitorEvaluationAdminRecord }>) {
  const settings = object(record.monitorSnapshot.settings);
  const target = object(settings.target);
  const trace = object(record.evaluationSnapshot.trace);
  const rows = array(trace.rows);
  const sourceUrl = text(record.filingSnapshot.sourceUrl);
  return (
    <section className={styles.stack} aria-label="Selected Form 4 monitor evaluation">
      <div className={styles.detailGrid}>
        <DetailCard title="Monitor settings" entries={[
          ["Monitor", record.monitorId], ["Owner", record.ownerUserId], ["Target", text(target.scope) === "ticker" ? `ticker: ${text(target.ticker)}` : text(target.scope)],
          ["Role", text(settings.role)], ["Minimum shares", settings.minimumShares === null ? "No minimum" : text(settings.minimumShares)], ["Active snapshot", String(record.monitorSnapshot.isActive === true)],
        ]} />
        <DetailCard title="Filing identity" entries={[
          ["Event", record.eventId], ["Execution", record.sourceExecutionId ?? "Unavailable"], ["Ticker", text(record.filingSnapshot.ticker) || "Unavailable"],
          ["Accession", text(record.filingSnapshot.accessionNumber) || "Unavailable"], ["Form", text(record.filingSnapshot.filingForm) || "Unavailable"], ["Filed", formatTime(text(record.filingSnapshot.filedAt))],
        ]} />
        <DetailCard title="Actual outcomes" entries={[
          ["Match evaluation", `${record.evaluationStatus} · ${record.evaluationReasonCode}`],
          ["Notification / dedupe", `${record.notificationStatus} · ${record.notificationReasonCode}`],
          ["Processing error", record.notificationError ?? "None recorded"], ["Attempt", record.processingAttemptId],
        ]} />
      </div>
      {sourceUrl ? <div className={styles.actions}><a className={styles.button} href={sourceUrl} rel="noreferrer" target="_blank">SEC original source</a></div> : null}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Row / outcome</th><th>XML transaction</th><th>Security / shares</th><th>Price / date / D-I</th><th>Reviewed owners and source/footnote evidence</th></tr></thead>
          <tbody>{rows.map((candidate, index) => {
            const row = object(candidate);
            const owners = array(row.owners);
            return <tr key={`${text(row.transactionIndex)}-${index}`}>
              <td>#{text(row.transactionIndex)}<br /><strong>{text(row.status)}</strong><br /><span className={styles.muted}>{text(row.reasonCode)}</span></td>
              <td>{text(row.transactionKind) || "Unavailable"}<br />Code {text(row.transactionCode) || "Unavailable"} · {text(row.acquisitionDispositionCode) || "Unavailable"}</td>
              <td>{text(row.securityTitle) || "Unavailable"}<br />{text(row.sharesRaw) || "Unavailable"}</td>
              <td>{text(row.pricePerShareRaw) || "Not disclosed"}<br />{text(row.transactionDate) || "Unavailable"} · {text(row.directOrIndirectOwnership) || "Unavailable"}</td>
              <td>{owners.length ? owners.map((ownerCandidate, ownerIndex) => {
                const owner = object(ownerCandidate);
                const evidence = array(owner.relationEvidence);
                return <div key={`${text(owner.name)}-${ownerIndex}`} className={styles.stack}>
                  <strong>{text(owner.name) || "Unavailable owner"}</strong>
                  <span>{array(owner.roles).map(text).filter(Boolean).join(", ") || "Role unavailable"}{text(owner.officerTitle) ? ` · ${text(owner.officerTitle)}` : ""}</span>
                  <span className={styles.muted}>role {text(owner.roleStatus)} · relation {text(owner.relationStatus)} · {text(owner.relation) || "unavailable"}</span>
                  {evidence.length ? evidence.map((itemCandidate, evidenceIndex) => {
                    const item = object(itemCandidate);
                    return <span className={styles.mono} key={`${text(item.ref)}-${evidenceIndex}`}>{text(item.kind)} {text(item.ref)}: {text(item.text)}</span>;
                  }) : <span className={styles.muted}>No persisted relation evidence.</span>}
                </div>;
              }) : <span className={styles.muted}>No reviewed owner record.</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <section className={styles.detailCard}>
        <h2>Linked user alert</h2>
        {record.alertId ? (
          <dl className={styles.definition}>
            <dt>Alert ID</dt><dd className={styles.mono}>{record.alertId}</dd>
            <dt>Persisted row</dt><dd>{record.linkedAlert ? "Found" : "Missing or unavailable"}</dd>
            <dt>Monitor / event IDs</dt><dd className={styles.mono}>{text(record.linkedAlert?.listing_monitor_id)} / {text(record.linkedAlert?.alert_event_id)}</dd>
            <dt>User page</dt><dd><Link href={`/alerts#monitor-alert-${record.alertId}`}>Open linked alert on /alerts</Link></dd>
          </dl>
        ) : <p className={styles.muted}>No alert ID was created or recorded for this attempt.</p>}
      </section>
    </section>
  );
}

function DetailCard({ title, entries }: Readonly<{ title: string; entries: readonly (readonly [string, string])[] }>) {
  return <section className={styles.detailCard}><h2>{title}</h2><dl className={styles.definition}>{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={styles.mono}>{value || "Unavailable"}</dd></div>)}</dl></section>;
}

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function text(value: unknown): string { return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : ""; }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString("en-US"); }
