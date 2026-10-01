import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { ListingStatusDateReview } from "@/components/admin/ListingStatusDateReview";
import { requireAdminPermission } from "@/lib/admin/server";
import { rolesHavePermission } from "@/lib/admin/policy";
import { listListingReviewObservations, readReviewedSecListingObservation } from "@/lib/sec-listing-status/review";
import { DATE_REVIEW_FIELDS, DATE_REVIEW_LABELS } from "@/lib/sec-listing-status/reviewContract";

export const dynamic = "force-dynamic";
const wrap = { minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" as const };
const pre = { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const };
export default async function ListingStatusReviewPage({ searchParams }: { searchParams: Promise<{ observationId?: string }> }) {
  const access = await requireAdminPermission("system.read");
  const params = await searchParams;
  const entries = await listListingReviewObservations().catch(() => null);
  let selected = null, error = "";
  if (params.observationId) {
    try { selected = await readReviewedSecListingObservation({ observationId: params.observationId }); }
    catch { error = "Selected observation or review history is unavailable. No conclusion has been substituted."; }
  }
  return <div className={styles.page} style={wrap}>
    <header><h1>Listing Status date review</h1><p>Review notice and suspension dates independently of automatic analysis and security identity.</p><Link href="/admin/data">Data operations</Link></header>
    {error && <p role="alert">{error}</p>}
    {selected && <section className={styles.stack} style={wrap}>
      <h2>{selected.automatic.observation.accession} · {selected.automatic.observation.form}</h2>
      <p>Filing date: {selected.automatic.observation.filingDate}. A filing date is not an operative date.</p>
      <section className={styles.card} style={wrap}><h3>Automatic canonical result — unchanged</h3>
        <p>Listing: {selected.automatic.observation.reported.listing} · Trading: {selected.automatic.observation.reported.trading}</p>
        <p>Suspension effective date: {selected.automatic.observation.reported.suspensionDate ?? "Unknown"}</p>
        <p>Reasons: {selected.automatic.observation.reported.reasons.join(", ")}</p>
        <p>Revalidation: {selected.automatic.usable ? "Current" : selected.automatic.reason}</p>
        <p>Security attachment: {selected.automatic.observation.attachment.status} · {selected.automatic.observation.attachment.reason}</p>
      </section>
      <section className={styles.card} style={wrap}><h3>Canonical reader: reviewed facts</h3><p>Review status: {selected.reviewStatus}</p>
        {DATE_REVIEW_FIELDS.map(field => <p key={field}>{DATE_REVIEW_LABELS[field]}: {selected.reviewedFacts ? selected.reviewedFacts[field].availability === "unknown" ? "Unknown / not established" : selected.reviewedFacts[field].value : "No current human decision"}</p>)}
        <p>Decision: {selected.decisionId ?? "None"} · Recorded: {selected.reviewedAt ?? "Not reviewed"}</p>
        <p>These are human-reviewed dates for this observation, not a historical claim that the review existed on the filing date. Listing/trading projection and unresolved identity remain separate.</p>
      </section>
      <section className={styles.stack}><h3>SEC evidence</h3>{selected.documents.map(doc => <details key={doc.id} open={selected.documents.length === 1}>
        <summary>{doc.id} · Retained source</summary><a href={doc.url} target="_blank" rel="noreferrer">SEC original filing</a>
        <p>Source SHA-256: {doc.sha256}</p><pre style={pre}>{doc.text}</pre>
      </details>)}</section>
      <ListingStatusDateReview key={`${selected.baseVersion}:${selected.revision}`} review={{ observationId: selected.observationId,
        baseVersion: selected.baseVersion, revision: selected.revision, usable: selected.automatic.usable,
        reviewedFacts: selected.reviewedFacts, canWithdraw: selected.history.at(-1)?.action === "reviewed",
        documents: selected.documents.map(({ id, url, sha256 }) => ({ id, url, sha256 })) }} canWrite={rolesHavePermission(access.roles, "data.run")} />
      <details><summary>Original automatic / AI evidence — unchanged</summary><pre style={pre}>{JSON.stringify({ automatic: selected.automatic.observation.reported, retainedListingRisk: selected.automatic.observation.listingRisk }, null, 2)}</pre></details>
      <section><h3>Append-only decision history</h3>{!selected.history.length && <p>No decisions recorded.</p>}{selected.history.map(row => <article key={String(row.id)} className={styles.card} style={wrap}>
        <strong>Revision {String(row.revision)} · {String(row.action)}</strong><p>{String(row.reason)}</p>
        <p>Actor: {String(row.actor_user_id)} ({String(row.actor_role)}) · {String(row.created_at)}</p>
        <pre style={pre}>{JSON.stringify(row.dates, null, 2)}</pre><p>Audit: {String(row.audit_log_id)} · Previous decision: {String(row.previous_decision_id ?? "None")}</p>
      </article>)}</section>
    </section>}
    <details open={!selected}><summary>Recent retained observations</summary>{entries === null ? <p role="alert">Observation list unavailable.</p> : entries.map(row => <p key={String(row.id)} style={wrap}>
      <Link href={`?observationId=${row.id}`}>{String(row.accession)} · {String(row.form)} · {String(row.filing_date)} · {String(row.attachment_status)} · {String(row.id)}</Link>
    </p>)}</details>
  </div>;
}
