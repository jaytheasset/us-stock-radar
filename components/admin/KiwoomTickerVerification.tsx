"use client";

import { useEffect, useRef, useState } from "react";
import type { KiwoomSnapshot, NoticeListItem } from "@/lib/ticker-verification/kiwoom/source";
import type { ReviewDraft, ReviewFacts, SavedReview } from "@/lib/ticker-verification/kiwoom/review";
import type { ReviewSummary } from "@/lib/ticker-verification/kiwoom/service";
import styles from "./KiwoomTickerVerification.module.css";
import { KiwoomHumanComparison } from "./KiwoomHumanComparison";

const endpoint = "/api/admin/data/kiwoom-verification";
const emptyFacts: ReviewFacts = { market: "US", kind: "symbol_change", securityName: "", oldTicker: null, newTicker: null, effectiveDate: null };
async function api<T>(query: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${endpoint}${query}`, { ...options, cache: "no-store", credentials: "same-origin" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error?.code ?? "KIWOOM_UNAVAILABLE");
  return result.data as T;
}
function message(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    KIWOOM_SOURCE_CHANGED: "The notice or its image changed. Reload it and review the new evidence before saving.",
    KIWOOM_REVISION_CONFLICT: "A newer review exists. Open the latest saved review before changing it.",
    KIWOOM_IDEMPOTENCY_CONFLICT: "This request ID was already used for different review data.",
    KIWOOM_REVIEW_STORE_UNAVAILABLE: "Saved reviews are unavailable. The evidence-review database migration may not be applied.",
    KIWOOM_REVIEW_INVALID: "Check the US security, symbols, market effective date, source locator and review reason.",
    KIWOOM_PROOF_REQUIRED: "Select a notice image or enter an exact source excerpt.",
    KIWOOM_PROOF_INVALID: "Evidence must match the captured notice. Broker account-processing text cannot support a market change.",
    ADMIN_AUTH_REQUIRED: "Administrator sign-in is required.", ADMIN_PERMISSION_REQUIRED: "Your account cannot record this review.",
  };
  return messages[code] ?? "The source or review could not be verified. Nothing was marked as confirmed.";
}
export function KiwoomTickerVerification({ canWrite }: { canWrite: boolean }) {
  const [notices, setNotices] = useState<NoticeListItem[]>([]), [history, setHistory] = useState<ReviewSummary[]>([]);
  const [snapshot, setSnapshot] = useState<KiwoomSnapshot | null>(null), [facts, setFacts] = useState<ReviewFacts>(emptyFacts);
  const [noticeNumber, setNoticeNumber] = useState(""), [caseId, setCaseId] = useState(""), [revision, setRevision] = useState(0);
  const [savedReview, setSavedReview] = useState<SavedReview | null>(null);
  const savedId = savedReview?.id ?? "";
  const [verdict, setVerdict] = useState<ReviewDraft["verdict"]>("unclear"), [imageHash, setImageHash] = useState<string | null>(null);
  const [locator, setLocator] = useState(""), [quote, setQuote] = useState(""), [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [historyError, setHistoryError] = useState(""), [imageError, setImageError] = useState(false), [zoom, setZoom] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null), readSequence = useRef(0), readAbort = useRef<AbortController | null>(null), saving = useRef(false);
  async function loadHistory() { try { setHistory(await api<ReviewSummary[]>("?mode=history")); setHistoryError(""); } catch (e) { setHistoryError(message(e)); } }
  useEffect(() => { void loadHistory(); return () => { readSequence.current++; readAbort.current?.abort(); }; }, []);
  function newCase() { setCaseId(crypto.randomUUID()); setRevision(0); setSavedReview(null); setFacts({ ...emptyFacts }); setReason(""); setLocator(""); setQuote(""); setVerdict("unclear"); setReviewed(false); request.current = null; setNotice("New evidence review. No ticker change will be applied."); }
  async function read<T>(query: string, receive: (data: T) => void, clearSnapshot = false) {
    if (saving.current) return;
    const seq = ++readSequence.current; readAbort.current?.abort(); const abort = new AbortController(); readAbort.current = abort;
    setBusy(true); setError(""); setNotice(""); if (clearSnapshot) { setSnapshot(null); setReviewed(false); setImageHash(null); setImageError(false); }
    try { const data = await api<T>(query, { signal: abort.signal }); if (seq === readSequence.current) receive(data); }
    catch (e) { if (seq === readSequence.current && !abort.signal.aborted) setError(message(e)); }
    finally { if (seq === readSequence.current) setBusy(false); }
  }
  function adopt(source: KiwoomSnapshot) { setSnapshot(source); setNoticeNumber(source.id); setImageHash(source.images[0]?.sha256 ?? null); setReviewed(false); setImageError(false); setZoom(false); }
  function openNotice(id: string) { void read<KiwoomSnapshot>(`?mode=notice&noticeId=${encodeURIComponent(id)}`, source => { newCase(); adopt(source); }, true); }
  function openReview(id: string) {
    void read<SavedReview>(`?mode=review&id=${encodeURIComponent(id)}`, review => {
      adopt(review.snapshot); setSavedReview(review); setCaseId(review.caseId); setRevision(review.revision); setFacts(review.draft.facts);
      setVerdict("unclear"); setImageHash(review.draft.proof.imageSha256); setLocator(review.draft.proof.locator); setQuote(review.draft.proof.quote ?? ""); setReason("");
      request.current = null; setNotice("Historical evidence loaded. Recheck the publisher before recording a new review. This record has no ticker authority.");
    }, true);
  }
  function chooseVerdict(next: ReviewDraft["verdict"]) {
    setVerdict(next);
    if (next === "withdrawn" && savedReview) {
      // Withdraw the retained assessment, even after a changed-source recheck.
      // Do not reinterpret edited candidate fields as the assessment being withdrawn.
      adopt(savedReview.snapshot); setFacts(savedReview.draft.facts);
      setImageHash(savedReview.draft.proof.imageSha256); setLocator(savedReview.draft.proof.locator);
      setQuote(savedReview.draft.proof.quote ?? ""); request.current = null;
      setNotice("Withdrawing the selected saved assessment using its historical evidence. Enter a withdrawal reason; no ticker change will be applied.");
    }
  }
  async function save() {
    if (!snapshot || !canWrite || saving.current || (imageError && verdict !== "withdrawn")) return;
    if (verdict === "withdrawn" && !savedReview) return;
    const draft: ReviewDraft = verdict === "withdrawn" && savedReview
      ? { ...savedReview.draft, expectedRevision: savedReview.revision, verdict, reason }
      : { caseId, expectedRevision: revision, noticeId: snapshot.id, expectedSourceHash: snapshot.sourceHash,
      verdict, facts, proof: { imageSha256: imageHash, locator, quote: quote || null }, usMarketRowReviewed: reviewed, reason };
    const body = JSON.stringify(draft); if (request.current?.fingerprint !== body) request.current = { fingerprint: body, id: crypto.randomUUID() };
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ status: string; review: SavedReview }>("", { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": request.current.id }, body });
      setSavedReview(result.review); setRevision(result.review.revision); setSnapshot(result.review.snapshot); setReviewed(false); request.current = null;
      if (result.review.draft.verdict === "withdrawn") setVerdict("unclear");
      setNotice(`Review ${result.review.revision} saved (${result.review.draft.verdict}). No ticker, listing, alert or customer data was changed.`); void loadHistory();
    } catch (e) { setError(message(e)); }
    finally { saving.current = false; setBusy(false); }
  }
  function recheck() { if (!savedId) return; void read<{ status: string; current: KiwoomSnapshot }>(`?mode=recheck&id=${encodeURIComponent(savedId)}`, result => {
    adopt(result.current); setQuote(""); setReviewed(false); setVerdict("unclear");
    setNotice(result.status === "same" ? "Source and image hashes still match the saved review. This is not a ticker approval." : "SOURCE CHANGED. The old review remains in history. Review the new text and images before saving a new revision.");
  }); }
  const previewLines = snapshot?.text.split(/\n+/).filter(line => line.trim() && !/잔고|예탁결제|결제|계좌|입금|매매|매도|거래가 제한|세금|과세|소수점|문의|감사|키움증권|고객|☎|https?:|접속방법|유의사항/.test(line)).slice(0, 12) ?? [];
  return <div className={styles.root}>
    <KiwoomHumanComparison canWrite={canWrite} />
    <div className={styles.notice}>Supporting evidence for US securities. A recorded review never changes a ticker or authorizes a same-security mapping. Account settlement dates are not market effective dates.</div>
    <section className={styles.card} aria-labelledby="kiwoom-notices-heading">
      <h2 id="kiwoom-notices-heading">1. Open an official Kiwoom notice</h2>
      <div className={styles.actions}>
        <button disabled={busy} onClick={() => void read<{ items: NoticeListItem[] }>("?mode=notices", result => setNotices(result.items))}>Load board notices</button>
        <label>Notice number<input value={noticeNumber} onChange={e => setNoticeNumber(e.target.value)} inputMode="numeric" placeholder="4611" /></label>
        <button disabled={busy || !noticeNumber} onClick={() => openNotice(noticeNumber)}>Open notice</button>
      </div>
      <p className={styles.muted}>Official notices on one board page only; not a complete IPO or corporate-action feed. Customer posts are excluded.</p>
      <div className={styles.noticeList}>{notices.map(item => <button key={item.id} disabled={busy} onClick={() => openNotice(item.id)}><span>{item.postedDate} · #{item.id}</span><strong lang="ko">{item.title}</strong></button>)}</div>
    </section>
    {busy ? <p role="status">Checking…</p> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {snapshot ? <div className={styles.columns}>
      <section className={styles.card} aria-labelledby="kiwoom-evidence-heading">
        <h2 id="kiwoom-evidence-heading">2. Source evidence</h2><h3 lang="ko">{snapshot.title}</h3>
        <p className={styles.muted}>Posted {snapshot.postedDate} · Captured {new Date(snapshot.capturedAt).toISOString()}</p>
        <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">Open original Kiwoom notice</a>
        <p className={styles.hash}>Snapshot {snapshot.sourceHash}</p>
        {savedId ? <button disabled={busy} onClick={recheck}>Recheck saved source</button> : null}
        <p>No automatic OCR or ticker extraction. Select the US row and verify its market effective date.</p>
        {snapshot.images.length ? <>
          <button onClick={() => setZoom(!zoom)}>{zoom ? "Fit evidence to panel" : "View image at original size"}</button>
          {snapshot.images.map((image, index) => <figure key={image.sha256} className={styles.figure}>
            <div className={styles.imageScroll}><img className={zoom ? styles.fullImage : styles.image} src={`data:${image.mime};base64,${image.base64}`} alt={`Kiwoom original notice table ${index + 1}`} onError={() => setImageError(true)} /></div>
            <figcaption><label><input type="radio" name="proof-image" disabled={busy || !canWrite || verdict === "withdrawn"} checked={imageHash === image.sha256} onChange={() => setImageHash(image.sha256)} />Use image {index + 1} as evidence</label></figcaption>
          </figure>)}
        </> : <p className={styles.notice}>Text-only notice: cite an exact market-event excerpt from the original source.</p>}
        {imageError ? <div className={styles.error} role="alert">Evidence image did not load. Review saving is blocked; reload the source.</div> : null}
        {previewLines.length ? <details><summary>Source text preview (account guidance excluded)</summary><pre className={styles.sourceText} lang="ko">{previewLines.join("\n\n")}</pre></details> : null}
      </section>
      <section className={styles.card} aria-labelledby="kiwoom-review-heading">
        <h2 id="kiwoom-review-heading">3. Record an evidence review</h2>
        <p>Manual candidate and assessment, not an AI correction or a production ticker change.</p>
        <button disabled={busy} onClick={newCase}>Start a new review case</button>
        <p className={styles.muted}>{revision ? `Next revision: ${revision + 1}` : "New case"}</p>
        <fieldset disabled={!canWrite || busy} className={styles.fields}>
          <fieldset disabled={verdict === "withdrawn"} className={styles.fields}>
          <label>Change type<select value={facts.kind} onChange={e => setFacts({ ...facts, kind: e.target.value as ReviewFacts["kind"], oldTicker: null, newTicker: null })}>
            <option value="symbol_change">Symbol change</option><option value="new_listing">New listing</option><option value="merger_new_symbol">New symbol after a merger</option><option value="delisting">Delisting</option>
          </select></label>
          <label>US security / share class<input value={facts.securityName} maxLength={240} onChange={e => setFacts({ ...facts, securityName: e.target.value })} placeholder="Company and exact security class" /></label>
          <div className={styles.pair}><label>Old ticker<input disabled={facts.kind === "new_listing"} value={facts.oldTicker ?? ""} maxLength={12} onChange={e => setFacts({ ...facts, oldTicker: e.target.value || null })} /></label>
          <label>New ticker<input disabled={facts.kind === "delisting"} value={facts.newTicker ?? ""} maxLength={12} onChange={e => setFacts({ ...facts, newTicker: e.target.value || null })} /></label></div>
          <label>US market effective date<input type="date" value={facts.effectiveDate ?? ""} onChange={e => setFacts({ ...facts, effectiveDate: e.target.value || null })} /></label>
          <label>Source row / evidence locator<input value={locator} maxLength={500} onChange={e => setLocator(e.target.value)} placeholder="Image 1, US section, row …" /></label>
          <label>Exact source excerpt (optional for images)<textarea value={quote} maxLength={2000} onChange={e => setQuote(e.target.value)} /></label>
          </fieldset>
          <label>Human assessment<select value={verdict} onChange={e => chooseVerdict(e.target.value as ReviewDraft["verdict"])}>
            <option value="unclear">Not confirmed / review needed</option><option value="supports">Source supports this candidate</option><option value="conflicts">Source conflicts with this candidate</option>{savedReview && savedReview.draft.verdict !== "withdrawn" ? <option value="withdrawn">Withdraw previous evidence review</option> : null}
          </select></label>
          <label className={styles.check}><input type="checkbox" disabled={verdict === "withdrawn"} checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked the US security row and market effective date, not Kiwoom account posting or trading restrictions.</label>
          <label>Review reason<textarea value={reason} maxLength={2000} onChange={e => setReason(e.target.value)} /></label>
          <button disabled={imageError && verdict !== "withdrawn"} onClick={() => void save()}>Save evidence review only</button>
        </fieldset>
        {!canWrite ? <p role="status">Read-only administrator access. Your role cannot record a review.</p> : null}
      </section>
    </div> : null}
    <section className={styles.card} aria-labelledby="kiwoom-history-heading"><h2 id="kiwoom-history-heading">Saved evidence history</h2>
      <p className={styles.muted}>Last 30 immutable records. Historical assessments are not live source confirmations and never grant ticker authority.</p>
      <button disabled={busy} onClick={() => void loadHistory()}>Reload saved reviews</button>
      {historyError ? <div className={styles.error} role="status">{historyError}</div> : null}
      {!historyError && !history.length ? <p>No saved evidence reviews.</p> : null}
      <div className={styles.noticeList}>{history.map(item => <button key={item.id} disabled={busy} onClick={() => openReview(item.id)}>
        <strong>{item.draft.facts.oldTicker ?? "New"} → {item.draft.facts.newTicker ?? "Delisted"} · {item.verdict}</strong>
        <span>Revision {item.revision} · {item.draft.facts.effectiveDate ?? "Date unconfirmed"} · {item.createdAt}</span>
      </button>)}</div>
    </section>
  </div>;
}
