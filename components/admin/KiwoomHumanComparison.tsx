"use client";
import { useEffect, useRef, useState } from "react";
import type { HumanFields, HumanStorageDraft, SavedHumanComparison, CurrentHumanComparison, humanCandidateDisplay, listHumanComparisons } from "@/lib/ticker-verification/kiwoom/humanStorage";
import type { HumanExceptionComparison, SecTextProof } from "@/lib/ticker-verification/kiwoom/humanException";
import type { ManualKiwoomRow } from "@/lib/ticker-verification/kiwoom/candidateLink";
import type { SavedReview } from "@/lib/ticker-verification/kiwoom/review";
import styles from "./KiwoomTickerVerification.module.css";

type Candidate = Awaited<ReturnType<typeof humanCandidateDisplay>>;
type History = Awaited<ReturnType<typeof listHumanComparisons>>;
const endpoint = "/api/admin/data/kiwoom-verification";
const freshHuman = (): HumanFields => ({ status: "unconfirmed", reason: "", values: { oldTicker: null, newTicker: null, effectiveDate: null },
  eventStatus: "unknown", security: { title: "", securityClass: null }, proofs: { oldTicker: null, newTicker: null, effectiveDate: null, security: null, eventStatus: null }, exchangeTransfer: null });
const freshRow = () => ({ cells: { country: "US", event: "", symbol: "", securityName: "", details: "", date: "" },
  market: "US" as ManualKiwoomRow["market"], event: "unknown" as ManualKiwoomRow["event"], additionalChanges: [] as string[],
  values: { oldTicker: null, newTicker: null, effectiveDate: null } as ManualKiwoomRow["values"], dateBasis: "unknown" as ManualKiwoomRow["dateBasis"],
  securityType: null as string | null, securityClass: null as string | null, rowCorrespondence: "unconfirmed" as ManualKiwoomRow["rowCorrespondence"], correspondenceReason: "" });
async function api<T>(query: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${endpoint}${query}`, { ...options, cache: "no-store", credentials: "same-origin" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error?.code ?? "KIWOOM_HUMAN_UNAVAILABLE");
  return body.data as T;
}
const show = (v: unknown) => v === null || v === undefined ? "Not reported" : String(v);
export function KiwoomHumanComparison({ canWrite }: { canWrite: boolean }) {
  const [decisionId, setDecisionId] = useState(""), [reviewId, setReviewId] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null), [review, setReview] = useState<SavedReview | null>(null);
  const [human, setHuman] = useState<HumanFields>(freshHuman), [row, setRow] = useState(freshRow);
  const [saved, setSaved] = useState<SavedHumanComparison | null>(null), [current, setCurrent] = useState<CurrentHumanComparison | null>(null);
  const [comparison, setComparison] = useState<HumanExceptionComparison | null>(null), [history, setHistory] = useState<History>([]);
  const [reason, setReason] = useState(""), [error, setError] = useState(""), [historyError, setHistoryError] = useState("");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [proofTarget, setProofTarget] = useState("security");
  const [caseId, setCaseId] = useState("");
  const sourceText = useRef<HTMLTextAreaElement>(null), lock = useRef(false), mounted = useRef(true);
  const request = useRef<{ body: string; id: string } | null>(null);
  async function historyRead() {
    try { const h = await api<History>("?mode=human-history"); if (mounted.current) { setHistory(h); setHistoryError(""); } }
    catch (e) { if (mounted.current) setHistoryError(e instanceof Error ? e.message : "History unavailable"); }
  }
  useEffect(() => { mounted.current = true; setCaseId(crypto.randomUUID()); void historyRead(); return () => { mounted.current = false; }; }, []);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Verification unavailable"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function editHuman(next: HumanFields) { setHuman(next); setComparison(null); setCurrent(null); }
  function editRow(next: ReturnType<typeof freshRow>) { setRow(next); setComparison(null); setCurrent(null); }
  function newCase() {
    setSaved(null); setCurrent(null); setComparison(null); setCaseId(crypto.randomUUID()); setHuman(freshHuman()); setRow(freshRow());
    setReason(""); request.current = null;
  }
  function loadCandidate() { void run(async () => {
    setCandidate(null); setReview(null); newCase();
    const c = await api<Candidate>(`?mode=candidate&decisionId=${encodeURIComponent(decisionId)}`);
    if (mounted.current) setCandidate(c);
  }); }
  function loadReview() { void run(async () => {
    setReview(null); setComparison(null); setCurrent(null);
    const r = await api<SavedReview>(`?mode=review&id=${encodeURIComponent(reviewId)}`);
    if (mounted.current) { setReview(r); setRow(freshRow()); }
  }); }
  function attachProof() {
    const el = sourceText.current;
    if (!el || el.selectionEnd <= el.selectionStart) { setError("Select an exact SEC text span first."); return; }
    const proof: SecTextProof = { start: el.selectionStart, end: el.selectionEnd, quote: el.value.slice(el.selectionStart, el.selectionEnd) };
    if (proofTarget === "exchange") {
      if (human.exchangeTransfer) editHuman({ ...human, exchangeTransfer: { ...human.exchangeTransfer, proof } });
    } else editHuman({ ...human, proofs: { ...human.proofs, [proofTarget]: proof } });
  }
  function draft(withdraw = false): HumanStorageDraft {
    if (withdraw && saved) return { ...saved.draft, action: "withdraw", expectedRevision: saved.revision, previousId: saved.id,
      human: { ...saved.draft.human, status: "withdrawn", reason } };
    if (!candidate || !review || !review.draft.proof.imageSha256) throw new Error("Load the exact candidate and an image-backed saved review.");
    const c = candidate.candidate;
    return { action: "append", caseId, expectedRevision: saved?.revision ?? 0, previousId: saved?.id ?? null,
      decisionId: c.decisionId, expectedDecisionSha256: c.decisionSha256, expectedCandidateRevisionSha256: c.revisionSha256,
      source: candidate.source, reviewId: review.id, expectedReviewRevision: review.revision, expectedSnapshotSha256: review.snapshot.sourceHash,
      expectedImageSha256: review.draft.proof.imageSha256, human,
      row: { ...row, method: "manual_transcription", candidateRevisionSha256: c.revisionSha256, reviewId: review.id, caseId: review.caseId,
        reviewRevision: review.revision, noticeId: review.snapshot.id, sourceHash: review.snapshot.sourceHash,
        imageSha256: review.draft.proof.imageSha256, locator: review.draft.proof.locator } };
  }
  function submit(preview = false, withdraw = false) { void run(async () => {
    const body = JSON.stringify(draft(withdraw));
    if (preview) { setComparison(await api<HumanExceptionComparison>("?mode=human-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body })); return; }
    if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
    const result = await api<{ status: string; saved: SavedHumanComparison }>("?mode=human-save", { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": request.current.id }, body });
    setSaved(result.saved); setHuman(result.saved.draft.human); setComparison(result.saved.comparison); setReason(""); request.current = null;
    setCurrent(null); setMessage(`Revision ${result.saved.revision} ${result.status}. Historical evidence saved; recheck current inputs before reuse. No ticker change.`);
    await historyRead();
  }); }
  function openSaved(id: string) { void run(async () => {
    setCandidate(null); setReview(null); setSaved(null); setCurrent(null); setComparison(null);
    const r = await api<CurrentHumanComparison>(`?mode=human&id=${encodeURIComponent(id)}`);
    setCurrent(r);
    if (!r.saved) return;
    const s = r.saved;
    setSaved(s); setCaseId(s.caseId); setDecisionId(s.draft.decisionId); setReviewId(s.draft.reviewId);
    setHuman(s.draft.human); setRow(s.draft.row); setReason(""); setComparison(s.comparison); request.current = null;
    // Exact historical references only. A failed load leaves append disabled; withdrawal remains possible.
    const [c, k] = await Promise.all([api<Candidate>(`?mode=candidate&decisionId=${encodeURIComponent(s.draft.decisionId)}`), api<SavedReview>(`?mode=review&id=${encodeURIComponent(s.draft.reviewId)}`)]);
    if (c.candidate.decisionSha256 !== s.draft.expectedDecisionSha256 || c.candidate.revisionSha256 !== s.draft.expectedCandidateRevisionSha256
      || c.source.sha256 !== s.draft.source.sha256 || k.revision !== s.draft.expectedReviewRevision
      || k.snapshot.sourceHash !== s.draft.expectedSnapshotSha256 || k.draft.proof.imageSha256 !== s.draft.expectedImageSha256)
      throw new Error("Saved references changed. Historical evidence is retained; it cannot be silently replaced.");
    setCandidate(c); setReview(k);
  }); }
  const locked = busy || !canWrite || saved?.judgment.status === "withdrawn";
  const hFields = ["oldTicker", "newTicker", "effectiveDate"] as const;
  return <section className={styles.root} aria-label="SEC human judgment and linked evidence">
    <div className={styles.notice}>SEC human judgments and linked evidence only. tickerAuthority: none. This is not a ticker change or final same-security approval.</div>
    {error && <p role="alert" className={styles.error}>{error}. No current conclusion is assumed.</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    <section className={styles.card}><h2>SEC automatic candidate</h2>
      <div className={styles.actions}><label>Exact decision ID<input disabled={busy} value={decisionId} onChange={e => setDecisionId(e.target.value)} /></label>
        <button disabled={busy || !decisionId} onClick={loadCandidate}>Load exact SEC decision (new case)</button></div>
      {candidate && <><dl>{Object.entries(candidate.candidate).filter(([k]) => k !== "values").map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={styles.hash}>{show(v)}</dd></div>)}</dl>
        <p>Automatic reasons: {candidate.reasons.join(", ")}</p><pre className={styles.sourceText}>{JSON.stringify(candidate.candidate.values, null, 2)}</pre>
        <a href={candidate.source.url} target="_blank" rel="noreferrer">SEC original source</a>
        <p>Select text below to attach an exact proof. Positions are UTF-16 offsets in normalized SEC visible text.</p>
        <textarea ref={sourceText} readOnly rows={12} aria-label="SEC source text" value={candidate.sourceText} />
      </>}
    </section>
    <section className={styles.card}><h2>Separate SEC human judgment</h2>
      <p>Enter only values read in SEC evidence. Automatic and Kiwoom values are not copied into these fields.</p>
      <p>Case {caseId} · Next revision {(saved?.revision ?? 0) + 1} · Predecessor {saved?.id ?? "none"}</p>
      <fieldset disabled={locked} className={styles.fields}>
        {hFields.map(k => <label key={k}>SEC human {k}<input type={k === "effectiveDate" ? "date" : "text"} value={human.values[k] ?? ""} onChange={e => editHuman({ ...human, values: { ...human.values, [k]: e.target.value || null } })} /></label>)}
        <label>SEC event state<select value={human.eventStatus} onChange={e => editHuman({ ...human, eventStatus: e.target.value as HumanFields["eventStatus"] })}>{["unknown", "proposed", "occurred"].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>SEC security title<input value={human.security.title} onChange={e => editHuman({ ...human, security: { ...human.security, title: e.target.value } })} /></label>
        <label>SEC security class (blank = unreported)<input value={human.security.securityClass ?? ""} onChange={e => editHuman({ ...human, security: { ...human.security, securityClass: e.target.value || null } })} /></label>
        <label>Judgment status<select value={human.status} onChange={e => editHuman({ ...human, status: e.target.value as HumanFields["status"] })}><option>unconfirmed</option><option>confirmed</option>{human.status === "withdrawn" && <option>withdrawn</option>}</select></label>
        <label>Judgment reason<textarea maxLength={2000} value={human.reason} onChange={e => editHuman({ ...human, reason: e.target.value })} /></label>
        <label className={styles.check}><input type="checkbox" checked={!!human.exchangeTransfer} onChange={e => editHuman({ ...human, exchangeTransfer: e.target.checked ? { from: "", to: "", date: null, status: "unknown", proof: null } : null })} />Record an SEC-only exchange transfer</label>
        {human.exchangeTransfer && <>{(["from", "to", "date"] as const).map(k => <label key={k}>SEC exchange {k}<input type={k === "date" ? "date" : "text"} value={human.exchangeTransfer![k] ?? ""} onChange={e => editHuman({ ...human, exchangeTransfer: { ...human.exchangeTransfer!, [k]: k === "date" ? e.target.value || null : e.target.value } })} /></label>)}
          <label>Transfer state<select value={human.exchangeTransfer.status} onChange={e => editHuman({ ...human, exchangeTransfer: { ...human.exchangeTransfer!, status: e.target.value as "unknown" | "proposed" | "occurred" } })}>{["unknown", "proposed", "occurred"].map(s => <option key={s}>{s}</option>)}</select></label></>}
        <div className={styles.actions}><label>Proof target<select value={proofTarget} onChange={e => setProofTarget(e.target.value)}>{[...hFields, "security", "eventStatus", "exchange"].map(k => <option key={k}>{k}</option>)}</select></label><button disabled={!candidate} onClick={attachProof}>Attach selected SEC text</button></div>
        {Object.entries({ ...human.proofs, exchange: human.exchangeTransfer?.proof ?? null }).map(([k, p]) => <div key={k}><strong>{k}: {p ? `${p.start}–${p.end}` : "No proof"}</strong><blockquote className={styles.sourceText}>{p?.quote}</blockquote>
          {p && <button onClick={() => k === "exchange" ? editHuman({ ...human, exchangeTransfer: { ...human.exchangeTransfer!, proof: null } }) : editHuman({ ...human, proofs: { ...human.proofs, [k]: null } })}>Clear {k} proof</button>}</div>)}
      </fieldset>
    </section>
    <section className={styles.card}><h2>Exact saved Kiwoom review and row</h2>
      <div className={styles.actions}><label>Saved review ID<input disabled={busy} value={reviewId} onChange={e => setReviewId(e.target.value)} /></label><button disabled={busy || !reviewId} onClick={loadReview}>Load exact Kiwoom review</button></div>
      {review && <><p className={styles.hash}>Review {review.id} · Case {review.caseId} · Revision {review.revision} · {review.draft.verdict}<br />Notice {review.snapshot.id}<br />Snapshot {review.snapshot.sourceHash}<br />Image {review.draft.proof.imageSha256}<br />Locator {review.draft.proof.locator}</p>
        <p>Read the selected source image below. No CIK or exchange is inferred. The row must match this saved locator.</p>
        {review.snapshot.images.filter(i => i.sha256 === review.draft.proof.imageSha256).map(i => <div className={styles.imageScroll} key={i.sha256}><img className={styles.image} src={`data:${i.mime};base64,${i.base64}`} alt="Selected Kiwoom review evidence" /></div>)}
      </>}
      <fieldset disabled={locked || !review} className={styles.fields}>
        <p>Transcribe the US market-event row only. Exclude account balances, settlement, deposits, withdrawals and customer trading restrictions.</p>
        {Object.entries(row.cells).map(([k, v]) => <label key={k}>Literal Kiwoom cell: {k}<input value={v} onChange={e => editRow({ ...row, cells: { ...row.cells, [k]: e.target.value } })} /></label>)}
        {hFields.map(k => <label key={k}>Kiwoom transcribed {k}<input type={k === "effectiveDate" ? "date" : "text"} value={row.values[k] ?? ""} onChange={e => editRow({ ...row, values: { ...row.values, [k]: e.target.value || null } })} /></label>)}
        <label>Market<select value={row.market} onChange={e => editRow({ ...row, market: e.target.value as ManualKiwoomRow["market"] })}><option>US</option><option>unknown</option></select></label>
        <label>Event<select value={row.event} onChange={e => editRow({ ...row, event: e.target.value as ManualKiwoomRow["event"] })}>{["unknown", "symbol_change", "other"].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Date basis<select value={row.dateBasis} onChange={e => editRow({ ...row, dateBasis: e.target.value as ManualKiwoomRow["dateBasis"] })}><option>unknown</option><option>market_effective</option></select></label>
        <label>Other changes explicitly in row (one per line)<textarea value={row.additionalChanges.join("\n")} onChange={e => editRow({ ...row, additionalChanges: e.target.value ? e.target.value.split("\n") : [] })} /></label>
        {(["securityType", "securityClass"] as const).map(k => <label key={k}>Kiwoom {k} (leave blank if absent)<input value={row[k] ?? ""} onChange={e => editRow({ ...row, [k]: e.target.value || null })} /></label>)}
        <label>Row correspondence<select value={row.rowCorrespondence} onChange={e => editRow({ ...row, rowCorrespondence: e.target.value as ManualKiwoomRow["rowCorrespondence"] })}>{["unconfirmed", "confirmed", "different"].map(v => <option key={v}>{v}</option>)}</select></label>
        <label>Correspondence reason<textarea value={row.correspondenceReason} onChange={e => editRow({ ...row, correspondenceReason: e.target.value })} /></label>
      </fieldset>
    </section>
    <section className={styles.card}><h2>Comparison and immutable history</h2>
      {current && <p role="status">Saved revision current-input status at last check: {current.status} · {current.reasons.join(", ")}</p>}
      {comparison && <><p>Comparison inputs: SEC human values vs Kiwoom transcription. Human status: {comparison.humanStatus}. Eligible: {String(comparison.assessment.eligible)}.</p>
        <table><thead><tr><th>Field</th><th>Automatic</th><th>SEC human</th><th>Kiwoom</th><th>Comparison</th></tr></thead><tbody>{hFields.map(k => <tr key={k}><th>{k}</th><td>{show(comparison.originalLink.candidate.values[k])}</td><td>{show(comparison.secHuman.values[k])}</td><td>{show(comparison.originalLink.observed.values[k])}</td><td>{comparison.comparison.fields[k]}</td></tr>)}
          <tr><th>Class</th><td>{show(comparison.originalLink.candidate.securityClass)}</td><td>{show(comparison.secHuman.security.securityClass)}</td><td>{show(comparison.originalLink.observed.securityClass)}</td><td>See assessment reasons</td></tr></tbody></table>
        <p>Reasons: {comparison.assessment.reasons.join(", ") || "None"}</p><pre className={styles.sourceText}>Automatic / human differences: {JSON.stringify(comparison.differencesFromAutomatic, null, 2)}</pre>
        <p className={styles.hash}>Comparison hash {comparison.comparisonSha256}</p></>}
      <div className={styles.actions}><button disabled={locked || !candidate || !review} onClick={() => submit(true)}>Compare current inputs</button><button disabled={locked || !candidate || !review} onClick={() => submit()}>Save human judgment and linked evidence</button></div>
      {saved && <><p className={styles.hash}>Saved {saved.id} · Revision {saved.revision} · Actor {saved.actorUserId} · Audit {saved.auditLogId}</p>
        <button disabled={busy} onClick={() => openSaved(saved.id)}>Reload and recheck current inputs</button>
        <label>Withdrawal reason<textarea disabled={busy || !canWrite} value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
        <button disabled={locked || reason.trim().length < 4} onClick={() => submit(false, true)}>Record withdrawal revision</button></>}
      {!canWrite && <p>Read-only administrator access.</p>}
      <button disabled={busy} onClick={() => void historyRead()}>Reload judgment history</button>
      {historyError && <p role="alert">History unavailable: {historyError}</p>}
      <div className={styles.noticeList}>{history.map(s => <button key={s.id} disabled={busy} onClick={() => openSaved(s.id)}>{s.id} · Revision {s.revision} · {s.status} · {s.createdAt}</button>)}</div>
    </section>
  </section>;
}
