"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { BadgeDollarSign, ChevronDown, X } from "lucide-react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import type {
  BrokerageConnectionStatus,
  BrokerageProofSummary,
} from "@/lib/brokerage/types";
import { BrokerageProofCard } from "./BrokerageProofCard";
import styles from "./Brokerage.module.css";

export function BrokerageEvidencePicker({
  isOpen,
  loginHref,
  onChange,
  onOpenChange,
  placement = "default",
  value,
}: {
  isOpen?: boolean;
  loginHref: string;
  onChange: (proof: BrokerageProofSummary | null) => void;
  onOpenChange?: (open: boolean) => void;
  placement?: "composer" | "default" | "room-menu";
  value: BrokerageProofSummary | null;
}) {
  const id = `brokerage-evidence-${useId().replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setPickerOpen = useCallback(
    (nextOpen: boolean) => {
      if (isOpen === undefined) setInternalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [isOpen, onOpenChange],
  );
  const [status, setStatus] = useState<BrokerageConnectionStatus | null>(null);
  const [proofs, setProofs] = useState<BrokerageProofSummary[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [mobile, setMobile] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const usesMobileSheet = mobile && placement === "composer";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open || usesMobileSheet) return;
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPickerOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, setPickerOpen, usesMobileSheet]);

  async function toggle() {
    if (open) {
      setPickerOpen(false);
      return;
    }
    setPickerOpen(true);
    if (placement === "composer" && value) {
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const [nextStatus, nextProofs] = await Promise.all([
        request<BrokerageConnectionStatus>("/api/account/brokerage"),
        request<BrokerageProofSummary[]>("/api/account/brokerage/proofs"),
      ]);
      setStatus(nextStatus);
      setProofs(nextProofs);
    } catch {
      setNotice("Sign in to attach verified trading.");
    } finally {
      setLoading(false);
    }
  }

  const content = (
    <div className={styles.evidenceMenuContent}>
      <strong>Verified trading</strong>
      {loading ? (
        <p aria-live="polite">Checking brokerage connection...</p>
      ) : value && placement !== "default" ? (
        <>
          <BrokerageProofCard compact proof={value} />
          <button
            className={styles.evidenceRemoveButton}
            onClick={() => {
              onChange(null);
              setPickerOpen(false);
            }}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            Remove
          </button>
        </>
      ) : notice ? (
        <>
          <p>{notice}</p>
          <Link href={loginHref}>Sign in</Link>
        </>
      ) : !status?.canConnect ? (
        <>
          <p>Pro, Advanced, or Ultimate is required.</p>
          <Link href="/premium">View Premium plans</Link>
        </>
      ) : !status.publicProofsEnabled ? (
        <>
          <p>
            Public proof sharing is pending approval. You can still connect
            and privately review your brokerage accounts.
          </p>
          <Link
            className={styles.evidenceMenuLink}
            href="/account/brokerage"
          >
            Brokerage verification
          </Link>
        </>
      ) : !status.connected ? (
        <>
          <p>Connect a read-only brokerage account first.</p>
          <Link href="/account/brokerage">Brokerage verification</Link>
        </>
      ) : proofs.length ? (
        proofs.map((proof) => (
          <button
            aria-label={`Attach verified ${proof.kind} for ${proof.ticker}`}
            key={proof.id}
            onClick={() => {
              onChange(proof);
              setPickerOpen(false);
            }}
            type="button"
          >
            <BrokerageProofCard compact linked={false} proof={proof} />
          </button>
        ))
      ) : (
        <>
          <p>Create a public-safe proof before attaching verified trading.</p>
          <Link href="/account/brokerage">Create proof</Link>
        </>
      )}
    </div>
  );

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
          aria-haspopup={placement === "room-menu" ? undefined : "dialog"}
          aria-label={
            placement === "room-menu"
              ? "Verified trade / position"
              : "Verified trading"
          }
          aria-pressed={value ? true : undefined}
          className={styles.evidenceButton}
          onClick={() => void toggle()}
          ref={triggerRef}
          type="button"
        >
          <BadgeDollarSign aria-hidden="true" size={16} />
          <span className={styles.evidenceButtonText}>
            {placement === "room-menu"
              ? "Verified trade / position"
              : "Verified trading"}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={styles.evidenceButtonChevron}
            size={13}
          />
        </button>
      )}
      {open && !usesMobileSheet ? (
        <div
          aria-label="Verified trading"
          className={styles.evidenceMenu}
          id={id}
          ref={panelRef}
          role={placement === "room-menu" ? "region" : "dialog"}
          tabIndex={-1}
        >
          {content}
        </div>
      ) : null}
      <BottomSheetShell
        aria-label="Verified trading"
        closeLabel="Close verified trading"
        id={id}
        isOpen={open && usesMobileSheet}
        layout="full-scroll"
        onDismiss={() => setPickerOpen(false)}
        openerRef={triggerRef}
        overlayLabel="Close verified trading"
      >
        <div className={styles.evidenceSheetContent}>{content}</div>
      </BottomSheetShell>
    </div>
  );
}

async function request<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload.data as T;
}
