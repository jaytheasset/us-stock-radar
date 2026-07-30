"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { BadgeCheck, ChevronDown, X } from "lucide-react";
import type {
  BrokerageConnectionStatus,
  BrokerageProofSummary,
} from "@/lib/brokerage/types";
import { BrokerageProofCard } from "./BrokerageProofCard";
import styles from "./Brokerage.module.css";

export function BrokerageEvidencePicker({
  loginHref,
  onChange,
  placement = "default",
  value,
}: {
  loginHref: string;
  onChange: (proof: BrokerageProofSummary | null) => void;
  placement?: "composer" | "default";
  value: BrokerageProofSummary | null;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BrokerageConnectionStatus | null>(null);
  const [proofs, setProofs] = useState<BrokerageProofSummary[]>([]);
  const [notice, setNotice] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    if (placement === "composer" && value) {
      setOpen(true);
      return;
    }
    try {
      const [nextStatus, nextProofs] = await Promise.all([
        request<BrokerageConnectionStatus>("/api/account/brokerage"),
        request<BrokerageProofSummary[]>("/api/account/brokerage/proofs"),
      ]);
      setStatus(nextStatus);
      setProofs(nextProofs);
      setOpen(true);
    } catch {
      setNotice("Sign in to attach verified trading.");
      setOpen(true);
    }
  }

  return (
    <div
      className={styles.evidencePicker}
      data-placement={placement}
      ref={rootRef}
    >
      {value && placement === "default" ? (
        <div className={styles.selectedEvidence}>
          <BrokerageProofCard compact proof={value} />
          <button aria-label="Remove verified trading" onClick={() => onChange(null)} type="button">
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : (
        <button
          aria-controls={id}
          aria-expanded={open}
          aria-label="Verified trading"
          aria-pressed={value ? true : undefined}
          className={styles.evidenceButton}
          onClick={() => void toggle()}
          ref={triggerRef}
          type="button"
        >
          <BadgeCheck aria-hidden="true" size={15} />
          <span className={styles.evidenceButtonText}>Verified trading</span>
          <ChevronDown
            aria-hidden="true"
            className={styles.evidenceButtonChevron}
            size={13}
          />
        </button>
      )}
      {open ? (
        <div aria-label="Verified trading" className={styles.evidenceMenu} id={id} role="dialog">
          <strong>Verified trading</strong>
          {value && placement === "composer" ? (
            <>
              <BrokerageProofCard compact proof={value} />
              <button
                className={styles.evidenceRemoveButton}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                type="button"
              >
                <X aria-hidden="true" size={14} />
                Remove
              </button>
            </>
          ) : notice ? <><p>{notice}</p><Link href={loginHref}>Sign in</Link></> : !status?.canConnect ? (
            <><p>Pro, Advanced, or Ultimate is required.</p><Link href="/premium">View Premium plans</Link></>
          ) : !status.publicProofsEnabled ? (
            <>
              <p>
                Public proof sharing is pending approval. You can still
                connect and privately review your brokerage accounts.
              </p>
              <Link
                className={styles.evidenceMenuLink}
                href="/account/brokerage"
              >
                Brokerage verification
              </Link>
            </>
          ) : !status.connected ? (
            <><p>Connect a read-only brokerage account first.</p><Link href="/account/brokerage">Brokerage verification</Link></>
          ) : proofs.length ? (
            proofs.map((proof) => (
              <button
                aria-label={`Attach verified ${proof.kind} for ${proof.ticker}`}
                key={proof.id}
                onClick={() => {
                  onChange(proof);
                  setOpen(false);
                }}
                type="button"
              >
                <BrokerageProofCard compact linked={false} proof={proof} />
              </button>
            ))
          ) : (
            <><p>Create a public-safe proof before attaching verified trading.</p><Link href="/account/brokerage">Create proof</Link></>
          )}
        </div>
      ) : null}
    </div>
  );
}

async function request<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload.data as T;
}
