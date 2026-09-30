"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DATE_REVIEW_FIELDS, DATE_REVIEW_LABELS, type DateReviewField, type ReviewedDate, type ReviewedDates, type ReviewDocument } from "@/lib/sec-listing-status/reviewContract";
import styles from "./AdminSection.module.css";

type FormReview = { observationId: string; baseVersion: string; revision: number; usable: boolean;
  reviewedFacts: ReviewedDates | null; canWithdraw: boolean; documents: Omit<ReviewDocument, "text">[] };
export function ListingStatusDateReview({ review, canWrite }: { review: FormReview; canWrite: boolean }) {
  const router = useRouter();
  const [dates, setDates] = useState<Partial<Record<DateReviewField, ReviewedDate>>>(review.reviewedFacts ?? {});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState<{ key: string; id: string } | null>(null);
  function update(field: DateReviewField, patch: Partial<ReviewedDate>) {
    setDates(current => ({ ...current, [field]: { availability: "unknown", value: null,
      sourceRef: review.documents[0]?.id ?? "", sourceHash: review.documents[0]?.sha256 ?? "", quote: "", ...current[field], ...patch } }));
  }
  async function submit(action: "reviewed" | "withdrawn") {
    const body = { action, dates: action === "reviewed" ? dates : {}, reason,
      expectedVersion: review.baseVersion, expectedRevision: review.revision };
    const key = JSON.stringify(body), id = request?.key === key ? request.id : crypto.randomUUID();
    setRequest({ key, id }); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/data/listing-status/${review.observationId}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Request-ID": id }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.message || "Review could not be saved.");
      setRequest(null); setMessage("Decision saved. Source and automatic result unchanged."); router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Review unavailable."); }
    finally { setBusy(false); }
  }
  if (!canWrite) return <p>Read-only access.</p>;
  return <section className={styles.stack}>
    <h2>Record a human date decision</h2>
    <p>Review each date role against the retained SEC passage. Unknown is an explicit conclusion, not a guessed date. Saving adds a revision; it does not rewrite any earlier record or establish security identity or trading status.</p>
    {!review.usable && <p role="alert">This observation failed revalidation. A new date decision is blocked; its history remains available.</p>}
    {DATE_REVIEW_FIELDS.map(field => <fieldset key={field} style={{ minWidth: 0 }}><legend>{DATE_REVIEW_LABELS[field]}</legend>
      <div className={styles.stack}>
        <label>{DATE_REVIEW_LABELS[field]} conclusion<select aria-label={`${DATE_REVIEW_LABELS[field]} conclusion`}
          value={dates[field]?.availability ?? ""} onChange={e => update(field, { availability: e.target.value as ReviewedDate["availability"], value: null })}>
          <option value="" disabled>Choose a conclusion</option><option value="available">Exact date supported</option><option value="unknown">Unknown / not established</option>
        </select></label>
        {dates[field]?.availability === "available" && <label>{DATE_REVIEW_LABELS[field]} value<input aria-label={`${DATE_REVIEW_LABELS[field]} value`} type="date"
          value={dates[field]?.value ?? ""} onChange={e => update(field, { value: e.target.value })} /></label>}
        <label>{DATE_REVIEW_LABELS[field]} evidence<select aria-label={`${DATE_REVIEW_LABELS[field]} evidence`} value={dates[field]?.sourceRef ?? review.documents[0]?.id ?? ""}
          onChange={e => { const doc = review.documents.find(d => d.id === e.target.value)!; update(field, { sourceRef: doc.id, sourceHash: doc.sha256, quote: "" }); }}>
          {review.documents.map(doc => <option key={doc.id} value={doc.id}>{doc.id} — {doc.url.split("/").at(-1)}</option>)}
        </select></label>
        <label>{DATE_REVIEW_LABELS[field]} source passage<textarea aria-label={`${DATE_REVIEW_LABELS[field]} source passage`} rows={5} maxLength={4000}
          value={dates[field]?.quote ?? ""} onChange={e => update(field, { quote: e.target.value })} /></label>
      </div>
    </fieldset>)}
    <label>Decision reason<textarea aria-label="Decision reason" rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    <div className={styles.actions} style={{ flexWrap: "wrap" }}>
      <button disabled={busy || reason.trim().length < 4 || !review.usable || DATE_REVIEW_FIELDS.some(f => !dates[f]?.quote)} onClick={() => submit("reviewed")}>Save date decision</button>
      <button disabled={busy || reason.trim().length < 4 || !review.canWithdraw} onClick={() => submit("withdrawn")}>Withdraw latest decision</button>
    </div>
    {message && <p role="status">{message}</p>}
  </section>;
}
