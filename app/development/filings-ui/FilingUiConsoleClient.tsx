"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, CircleDot, Minus } from "lucide-react";
import type { FilingUiConsoleFamily } from "@/lib/development/filingUiConsoleRegistry";
import styles from "./filings-ui-console.module.css";

export type FilingUiConsoleEntry = {
  company: string;
  delivery: string;
  eventId: string;
  eventType: string;
  family: string;
  fixtureKind: "Actual DB" | "Fixture";
  formType: string;
  label: string;
  notes: string;
  route: string;
  score: number | null;
  signal: string;
  status: "Broken" | "Missing" | "Ready";
  ticker: string;
  contentContract: FilingUiConsoleContentContractItem[];
};

export type FilingUiConsoleContentVisibility = "conditional" | "hidden" | "shown";

export type FilingUiConsoleContentContractItem = {
  fullAnalysis: FilingUiConsoleContentVisibility;
  label: string;
  preview: FilingUiConsoleContentVisibility;
};

type Props = {
  entries: FilingUiConsoleEntry[];
  families: readonly FilingUiConsoleFamily[];
  initialFamilyId?: string;
};

export function FilingUiConsoleClient({ entries, families, initialFamilyId = "" }: Props) {
  const firstRegisteredFamilyId = families.find((family) => entries.some((entry) => entry.family === family.id))?.id;
  const requestedFamilyId = families.some((family) => family.id === initialFamilyId)
    ? initialFamilyId
    : "";
  const [familyId, setFamilyId] = useState(requestedFamilyId || firstRegisteredFamilyId || families[0]?.id || "");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<{ route: string; mode: "desktop" | "mobile" } | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const activeFamily = families.find((family) => family.id === familyId) || families[0];
  const counts = useMemo(
    () => new Map(families.map((family) => [family.id, entries.filter((entry) => entry.family === family.id).length])),
    [entries, families],
  );
  const visibleEntries = entries
    .filter((entry) => {
      if (entry.family !== activeFamily?.id) return false;
      if (!normalizedQuery) return true;
      return [entry.label, entry.company, entry.ticker, entry.formType, entry.eventType]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((left, right) => fixtureKindPriority(left) - fixtureKindPriority(right));

  return (
    <section className={styles.embedded} data-sr-theme="light">
      <header className={styles.embeddedHeader}>
        <div>
          <h2>Filing UI Console</h2>
          <p>Existing production filing renderers, grouped by their analysis UI contract.</p>
        </div>
        <Link href="/filings">Open filings</Link>
      </header>

      <section className={styles.controls}>
        <label>
          <span>Search selected family</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, ticker, form, event" />
        </label>
      </section>

      <div className={styles.layout}>
        <nav className={styles.familyRail} aria-label="Filing UI families">
          {families.map((family) => {
            const count = counts.get(family.id) || 0;
            return (
              <button
                className={family.id === activeFamily?.id ? styles.familyActive : styles.familyButton}
                key={family.id}
                onClick={() => {
                  setFamilyId(family.id);
                  setPreview(null);
                }}
                type="button"
              >
                <strong>{family.label}</strong>
                <span>{count ? `${count} registered` : "Not registered"}</span>
              </button>
            );
          })}
        </nav>

        <section className={styles.workspace}>
          <div className={styles.workspaceHeader}>
            <div>
              <h2>{activeFamily?.label}</h2>
              <p>{activeFamily?.description}</p>
            </div>
            <span>{visibleEntries.length} results</span>
          </div>

          <div className={styles.entryList} key={activeFamily?.id}>
            {visibleEntries.map((entry) => (
              <article className={styles.entry} key={entry.eventId}>
                <div className={styles.entryTitle}>
                  <div>
                    <span>{entry.fixtureKind} · {entry.formType || "Form not stored"}</span>
                    <h3>{entry.label}</h3>
                  </div>
                  <b data-status={entry.status.toLowerCase()}>{entry.status}</b>
                </div>
                <dl>
                  <div><dt>Company / ticker</dt><dd>{[entry.company, entry.ticker].filter(Boolean).join(" / ") || "Not stored"}</dd></div>
                  <div><dt>Event</dt><dd>{entry.eventType || "Not stored"}</dd></div>
                  <div><dt>Signal / score</dt><dd>{[entry.signal, entry.score].filter((value) => value !== null && value !== "").join(" / ") || "Not stored"}</dd></div>
                  <div><dt>Delivery</dt><dd>{entry.delivery || "Not stored"}</dd></div>
                </dl>
                <p>{entry.notes}</p>
                <ContentContractTable items={entry.contentContract} />
                <code>{entry.route}</code>
                <div className={styles.actions}>
                  <Link href={entry.route} target="_blank">Open Full Page</Link>
                  <button type="button" onClick={() => setPreview({ route: entry.route, mode: "desktop" })}>Desktop</button>
                  <button type="button" onClick={() => setPreview({ route: entry.route, mode: "mobile" })}>Mobile</button>
                </div>
              </article>
            ))}
            {!visibleEntries.length ? <div className={styles.empty}>No registered production example for this UI family.</div> : null}
          </div>
        </section>
      </div>

      {preview ? (
        <section className={styles.preview}>
          <div className={styles.previewHeader}>
            <h2>{preview.mode === "desktop" ? "Desktop preview" : "Mobile preview"}</h2>
            <button type="button" onClick={() => setPreview(null)}>Close</button>
          </div>
          <div className={styles.previewScroll}>
            <iframe className={preview.mode === "desktop" ? styles.desktopFrame : styles.mobileFrame} src={preview.route} title="Filing UI preview" />
          </div>
        </section>
      ) : null}
    </section>
  );
}

function ContentContractTable({ items }: { items: FilingUiConsoleContentContractItem[] }) {
  if (!items.length) {
    return <p className={styles.contractPending}>Display contract not defined yet.</p>;
  }

  return (
    <section className={styles.contract} aria-label="Content display contract">
      <div className={styles.contractHeader}>
        <strong>Content display</strong>
        <span>Full Analysis</span>
        <span>Preview</span>
      </div>
      {items.map((item) => (
        <div className={styles.contractRow} key={item.label}>
          <span>{item.label}</span>
          <VisibilityMark value={item.fullAnalysis} />
          <VisibilityMark value={item.preview} />
        </div>
      ))}
    </section>
  );
}

function VisibilityMark({ value }: { value: FilingUiConsoleContentVisibility }) {
  if (value === "shown") {
    return <span className={styles.contractShown}><Check aria-hidden="true" size={15} /> Display</span>;
  }
  if (value === "conditional") {
    return <span className={styles.contractConditional}><CircleDot aria-hidden="true" size={14} /> Conditional</span>;
  }
  return <span className={styles.contractHidden}><Minus aria-hidden="true" size={15} /> Hidden</span>;
}

function fixtureKindPriority(entry: FilingUiConsoleEntry) {
  return entry.fixtureKind === "Fixture" ? 0 : 1;
}
