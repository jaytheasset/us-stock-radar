"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Landmark, Link2Off, ShieldCheck } from "lucide-react";
import type {
  BrokerageConnectionStatus,
  BrokerageProofCandidate,
  BrokerageProofDisclosure,
  BrokerageProofSummary,
} from "@/lib/brokerage/types";
import { BrokerageProofCard } from "./BrokerageProofCard";
import styles from "./Brokerage.module.css";

export function BrokerageAccountClient({
  initialStatus,
}: {
  initialStatus: BrokerageConnectionStatus;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [candidates, setCandidates] = useState<BrokerageProofCandidate[]>([]);
  const [proofs, setProofs] = useState<BrokerageProofSummary[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [publicConsent, setPublicConsent] = useState(false);
  const [disclosure, setDisclosure] = useState<BrokerageProofDisclosure>({});
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("connection") === "returned") {
      void runAction("sync");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!status.connected) return;
    void Promise.all([
      requestJson<BrokerageProofCandidate[]>("/api/account/brokerage/candidates"),
      requestJson<BrokerageProofSummary[]>("/api/account/brokerage/proofs"),
    ]).then(([nextCandidates, nextProofs]) => {
      setCandidates(nextCandidates);
      setProofs(nextProofs);
    }).catch(() => setNotice("Linked records could not be loaded."));
  }, [status.connected]);

  function runAction(action: "accept_terms" | "sync" | "disconnect") {
    startTransition(async () => {
      try {
        const next = await requestJson<BrokerageConnectionStatus>(
          "/api/account/brokerage",
          { method: "POST", body: JSON.stringify({ action }) },
        );
        setStatus(next);
        setNotice(
          action === "disconnect"
            ? "Brokerage disconnected. Existing cards are historical snapshots."
            : action === "sync"
              ? "Connection status refreshed."
              : "Terms accepted.",
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "The request failed.");
      }
    });
  }

  function openPortal() {
    startTransition(async () => {
      try {
        const data = await requestJson<{ url: string }>(
          "/api/account/brokerage/portal",
          { method: "POST" },
        );
        window.location.assign(data.url);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Connection Portal is unavailable.");
      }
    });
  }

  function createProof() {
    startTransition(async () => {
      try {
        const proof = await requestJson<BrokerageProofSummary>(
          "/api/account/brokerage/proofs",
          {
            method: "POST",
            body: JSON.stringify({
              candidateId: selectedCandidate,
              disclosure,
              publicConsent,
            }),
          },
        );
        setProofs((current) => [proof, ...current.filter((item) => item.id !== proof.id)]);
        setNotice("Broker-linked proof created.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Proof creation failed.");
      }
    });
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <span className={styles.eyebrow}>Account</span>
        <h1>Brokerage verification</h1>
        <p>
          Connect through SnapTrade&apos;s read-only portal. Stock Radar never asks for or stores your brokerage password, account number, or full balance.
        </p>
      </header>

      <div className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <Landmark aria-hidden="true" size={19} />
            <h2>Brokerage connected data</h2>
            <span className={styles.state}>{readStatusLabel(status)}</span>
          </div>

          {!status.canConnect ? (
            <div className={styles.message}>
              <strong>Pro plan required</strong>
              <p>Your current plan is {status.effectivePlan}. Compare Pro, Advanced, and Ultimate access.</p>
              <Link href="/premium">View Premium plans</Link>
            </div>
          ) : status.status === "not_configured" ? (
            <div className={styles.message}>
              <strong>Not configured</strong>
              <p>SnapTrade credentials are not configured for this environment. The rest of Stock Radar remains available.</p>
            </div>
          ) : !status.termsAccepted ? (
            <div className={styles.message}>
              <strong>SnapTrade End User Terms</strong>
              <p>Review and accept the provider terms before opening the read-only Connection Portal.</p>
              <label className={styles.check}>
                <input
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  type="checkbox"
                />
                I agree to the SnapTrade End User Terms.
              </label>
              <button disabled={!termsAccepted || pending} onClick={() => runAction("accept_terms")} type="button">
                Agree and continue
              </button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button disabled={pending} onClick={openPortal} type="button">
                <ExternalLink aria-hidden="true" size={16} />
                {status.connected ? "Reconnect account" : "Connect account"}
              </button>
              <button disabled={pending} onClick={() => runAction("sync")} type="button">Refresh status</button>
              {status.connected ? (
                <button disabled={pending} onClick={() => runAction("disconnect")} type="button">
                  <Link2Off aria-hidden="true" size={16} /> Disconnect
                </button>
              ) : null}
            </div>
          )}

          {status.accountTypes.length ? (
            <div className={styles.accountTypes}>
              {status.accountTypes.map((type) => (
                <span data-account-type={type} key={type}>
                  {type === "paper" ? "Paper account" : "Live account"}
                </span>
              ))}
            </div>
          ) : null}
          {notice ? <p aria-live="polite" className={styles.notice}>{notice}</p> : null}
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}>
            <ShieldCheck aria-hidden="true" size={19} />
            <h2>Proof privacy</h2>
          </div>
          <p className={styles.copy}>
            Position cards disclose ticker, LONG/SHORT, time, account type, and current/historical status. Execution cards disclose ticker, BUY/SELL, date, provisional/final, and account type. Units, cost, price, quantity, and broker stay hidden unless you opt in.
          </p>
          {!status.publicProofsEnabled ? (
            <p className={styles.pendingApproval}>Public sharing pending approval.</p>
          ) : status.connected ? (
            <div className={styles.proofForm}>
              <label>
                Linked record
                <select value={selectedCandidate} onChange={(event) => setSelectedCandidate(event.target.value)}>
                  <option value="">Choose a current position or filled execution</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.kind === "position" ? "Position" : "Execution"} · {candidate.ticker} · {candidate.side} · {candidate.accountType === "paper" ? "Paper" : "Live"}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>Optional public fields</legend>
                {(["units", "averageCost", "executionPrice", "executionQuantity", "brokerName"] as const).map((key) => (
                  <label className={styles.check} key={key}>
                    <input
                      checked={disclosure[key] === true}
                      onChange={(event) => setDisclosure((current) => ({ ...current, [key]: event.target.checked }))}
                      type="checkbox"
                    />
                    {readDisclosureLabel(key)}
                  </label>
                ))}
              </fieldset>
              <label className={styles.check}>
                <input checked={publicConsent} onChange={(event) => setPublicConsent(event.target.checked)} type="checkbox" />
                I consent to publishing only the fields selected above.
              </label>
              <button disabled={!selectedCandidate || !publicConsent || pending} onClick={createProof} type="button">
                <CheckCircle2 aria-hidden="true" size={16} /> Create proof
              </button>
            </div>
          ) : null}
        </article>
      </div>

      {proofs.length ? (
        <section className={styles.proofs}>
          <h2>Your brokerage proofs</h2>
          <div>{proofs.map((proof) => <BrokerageProofCard key={proof.id} proof={proof} />)}</div>
        </section>
      ) : null}
    </section>
  );
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The request failed.");
  return payload.data as T;
}

function readStatusLabel(status: BrokerageConnectionStatus) {
  if (status.status === "connected") return "Brokerage connected";
  if (status.status === "upgrade_required") return "Upgrade required";
  if (status.status === "not_configured") return "Not configured";
  return status.status === "disconnected" ? "Disconnected" : "Not connected";
}

function readDisclosureLabel(key: keyof BrokerageProofDisclosure) {
  return ({
    averageCost: "Average cost",
    brokerName: "Broker name",
    executionPrice: "Execution price",
    executionQuantity: "Execution quantity",
    units: "Units",
  } as const)[key];
}
