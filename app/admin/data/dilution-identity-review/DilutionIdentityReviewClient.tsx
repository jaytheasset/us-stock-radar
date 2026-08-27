"use client";

import { useMemo, useState } from "react";
import type {
  DilutionIdentityReviewApplyResult,
  DilutionIdentityReviewCaseSummary,
  DilutionIdentityReviewPacket,
  DilutionIdentityReviewPreview,
} from "@/lib/dilution/dilutionIdentityReviewExchange";
import styles from "./dilution-identity-review.module.css";

type ApiError = Readonly<{ code?: string; message?: string }>;

export function DilutionIdentityReviewClient({
  initialCases,
}: {
  initialCases: readonly DilutionIdentityReviewCaseSummary[];
}) {
  const [cases, setCases] = useState(initialCases);
  const [selectedKey, setSelectedKey] = useState(initialCases[0]?.observationKey || "");
  const [packet, setPacket] = useState<DilutionIdentityReviewPacket | null>(null);
  const [pastedDecision, setPastedDecision] = useState("");
  const [preview, setPreview] = useState<DilutionIdentityReviewPreview | null>(null);
  const [applyResult, setApplyResult] = useState<DilutionIdentityReviewApplyResult | null>(null);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState<"packet" | "validate" | "apply" | null>(null);

  const selectedCase = useMemo(
    () => cases.find((item) => item.observationKey === selectedKey) || null,
    [cases, selectedKey],
  );

  async function loadPacket(observationKey = selectedKey) {
    if (!observationKey) return;
    setBusy("packet");
    clearOutcome();
    try {
      const response = await fetch(
        `/api/admin/dilution-identity-review?observationKey=${encodeURIComponent(observationKey)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok || !body?.ok || !body.packet) throw apiError(body?.error);
      setPacket(body.packet);
      setMessage("Current review packet loaded. Copy it before asking ChatGPT for a decision.");
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  }

  async function copyPacket() {
    if (!packet) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(packet, null, 2));
      setMessage("Review packet copied to the clipboard.");
      setErrors([]);
    } catch {
      setErrors(["Clipboard access failed. Select and copy the packet JSON manually."]);
    }
  }

  async function validateDecision() {
    if (!selectedKey) return;
    setBusy("validate");
    setPreview(null);
    setApplyResult(null);
    setErrors([]);
    setMessage("");
    try {
      const response = await fetch("/api/admin/dilution-identity-review/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observationKey: selectedKey, pastedDecision }),
      });
      const body = await response.json();
      const validation = body?.validation;
      if (!validation?.ok) {
        const validationErrors = Array.isArray(validation?.errors)
          ? validation.errors.map((item: ApiError) => item.message || item.code || "Invalid decision.")
          : [body?.error?.message || "The GPT decision is invalid."];
        setErrors(validationErrors);
        return;
      }
      setPreview(validation.preview);
      setMessage("Validation passed. Review the preview before applying.");
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  }

  async function applyDecision() {
    if (!selectedKey || !preview) return;
    setBusy("apply");
    setErrors([]);
    setMessage("");
    try {
      const response = await fetch("/api/admin/dilution-identity-review/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observationKey: selectedKey, pastedDecision }),
      });
      const body = await response.json();
      if (!response.ok || !body?.ok || !body.result) throw apiError(body?.error);
      setApplyResult(body.result);
      setMessage(body.result.status === "idempotent"
        ? "This exact adjudication was already applied; no duplicate was created."
        : "Human adjudication applied. The resolver original remains unchanged.");
      await refreshCases();
    } catch (error) {
      setErrors([errorMessage(error)]);
    } finally {
      setBusy(null);
    }
  }

  async function refreshCases() {
    try {
      const response = await fetch("/api/admin/dilution-identity-review", { cache: "no-store" });
      const body = await response.json();
      if (response.ok && body?.ok && Array.isArray(body.cases)) setCases(body.cases);
    } catch {
      // Apply already succeeded atomically. A later list refresh must not turn
      // the completed adjudication into an apparent write failure.
    }
  }

  function selectCase(observationKey: string) {
    setSelectedKey(observationKey);
    setPacket(null);
    setPastedDecision("");
    clearOutcome();
  }

  function clearOutcome() {
    setPreview(null);
    setApplyResult(null);
    setErrors([]);
    setMessage("");
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Data operations · Manual GPT exchange</span>
          <h1>Dilution identity review</h1>
          <p>Copy a complete evidence packet, paste ChatGPT&apos;s JSON, validate it, preview the change, then apply it deliberately.</p>
        </div>
        <div className={styles.safety}>No automatic GPT call</div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.casePanel} aria-label="Review cases">
          <div className={styles.panelHeading}>
            <h2>Review cases</h2>
            <span>{cases.length}</span>
          </div>
          <div className={styles.caseList}>
            {cases.length ? cases.map((item) => (
              <button
                className={`${styles.caseCard} ${selectedKey === item.observationKey ? styles.selected : ""}`}
                key={item.observationKey}
                onClick={() => selectCase(item.observationKey)}
                type="button"
              >
                <span className={styles.caseTopline}>
                  <strong>{item.ticker || item.issuerCik}</strong>
                  <small data-status={item.reviewStatus.toLowerCase()}>{item.reviewStatus}</small>
                </span>
                <span>{item.form} · {item.filedDate}</span>
                <span>{item.originalDecision} · {item.exposureType}</span>
                <code>{item.accession}</code>
              </button>
            )) : <p className={styles.empty}>No persisted UNRESOLVED or CONFLICT observations.</p>}
          </div>
        </aside>

        <section className={styles.workspace} aria-label="Selected review case">
          {selectedCase ? (
            <>
              <section className={styles.summary}>
                <div><span>Ticker / issuer</span><strong>{selectedCase.ticker || "—"} · {selectedCase.issuerCik}</strong></div>
                <div><span>Filing</span><strong>{selectedCase.form} · {selectedCase.accession}</strong></div>
                <div><span>Resolver original</span><strong>{selectedCase.originalDecision}</strong><small>{selectedCase.originalReasonCode}</small></div>
                <div><span>Effective now</span><strong>{selectedCase.effectiveDecision}</strong><small>{selectedCase.effectiveTargetExposureId || "No target"}</small></div>
              </section>

              <section className={styles.step}>
                <div className={styles.stepTitle}><span>1</span><div><h2>Copy Review Packet</h2><p>Includes the original decision, source-backed claims, canonical exposures, and issuer history.</p></div></div>
                <div className={styles.actions}>
                  <button disabled={busy !== null} onClick={() => loadPacket()} type="button">
                    {busy === "packet" ? "Loading…" : "Generate current packet"}
                  </button>
                  <button disabled={!packet || busy !== null} onClick={copyPacket} type="button">Copy GPT Review Packet</button>
                </div>
                {packet ? <details className={styles.packet}><summary>Inspect packet JSON</summary><pre>{JSON.stringify(packet, null, 2)}</pre></details> : null}
              </section>

              <section className={styles.step}>
                <div className={styles.stepTitle}><span>2</span><div><h2>Paste GPT Decision</h2><p>Paste only the JSON object produced from the current packet.</p></div></div>
                <label className={styles.textareaLabel}>
                  GPT decision JSON
                  <textarea
                    aria-label="GPT decision JSON"
                    onChange={(event) => {
                      setPastedDecision(event.target.value);
                      setPreview(null);
                      setApplyResult(null);
                    }}
                    placeholder={'{\n  "review_case_id": "...",\n  "input_hash": "...",\n  "decision": "LINK_EXISTING",\n  ...\n}'}
                    spellCheck={false}
                    value={pastedDecision}
                  />
                </label>
                <button disabled={!packet || !pastedDecision.trim() || busy !== null} onClick={validateDecision} type="button">
                  {busy === "validate" ? "Validating…" : "Validate"}
                </button>
              </section>

              <section className={styles.step}>
                <div className={styles.stepTitle}><span>3</span><div><h2>Preview → Human Apply</h2><p>Nothing changes until an authorized administrator clicks Apply.</p></div></div>
                {preview ? (
                  <div className={styles.preview}>
                    <div><span>Original</span><strong>{preview.originalDecision}</strong></div>
                    <div><span>Proposed</span><strong>{preview.proposedDecision}</strong></div>
                    <div><span>Target</span><code>{preview.proposedTargetExposureId || "DB generates on CREATE_NEW / none"}</code></div>
                    <div><span>Confidence</span><strong>{preview.confidence}</strong></div>
                    <div className={styles.previewWide}><span>Reason</span><p>{preview.reason}</p></div>
                    <div className={styles.previewWide}><span>Evidence</span><p>{preview.evidenceRefs.join(", ")}</p></div>
                  </div>
                ) : <p className={styles.empty}>Validate a current response to unlock the final Apply action.</p>}
                <button className={styles.apply} disabled={!preview || busy !== null} onClick={applyDecision} type="button">
                  {busy === "apply" ? "Applying…" : "Apply human adjudication"}
                </button>
              </section>

              {errors.length ? <div className={styles.error} role="alert"><strong>Review blocked</strong>{errors.map((error) => <p key={error}>{error}</p>)}</div> : null}
              {message ? <div className={styles.message} role="status">{message}</div> : null}
              {applyResult ? <div className={styles.result}><strong>{applyResult.effectiveDecision}</strong><span>{applyResult.targetExposureId || "No target exposure"}</span><code>{applyResult.adjudicationId}</code></div> : null}
            </>
          ) : <p className={styles.empty}>Select a review case.</p>}
        </section>
      </div>
    </div>
  );
}

function apiError(value: ApiError | undefined) {
  return new Error(value?.message || value?.code || "The review request failed.");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The review request failed.";
}
