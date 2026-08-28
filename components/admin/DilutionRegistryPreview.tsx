"use client";

import { useRef, useState } from "react";
import {
  createDilutionRegistryApplyRequestBody,
  DILUTION_REGISTRY_APPLY_MESSAGES,
  isDilutionRegistryApplyEnabled,
  readDilutionRegistryApplyResponse,
  type DilutionRegistryApplyUiState,
} from "@/lib/dilution-registry/applyClient";
import {
  createDilutionRegistryPreviewModel,
  parseDilutionRegistryJson,
  type DilutionRegistryInstrumentRow,
  type DilutionRegistryPreviewModel,
  type DilutionRegistryRecord,
} from "@/lib/dilution-registry/preview";
import styles from "./DilutionRegistryPreview.module.css";

const NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const TYPE_LABELS: Record<string, string> = {
  convertible_note: "Convertible Note",
  convertible_preferred: "Convertible Preferred",
  warrant: "Warrant",
  prefunded_warrant: "Pre-funded Warrant",
  atm_program: "ATM",
  equity_line: "Equity Line",
};

const STATUS_LABELS: Record<string, string> = {
  current: "Current",
  old: "Old",
  closed: "Closed",
};

export function DilutionRegistryPreview({ canApply }: { canApply: boolean }) {
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<DilutionRegistryPreviewModel | null>(null);
  const [previewedSource, setPreviewedSource] = useState<string | null>(null);
  const [applyState, setApplyState] =
    useState<DilutionRegistryApplyUiState>("idle");
  const activeApplySource = useRef<string | null>(null);

  const applyEnabled = isDilutionRegistryApplyEnabled({
    canApply,
    previewedSource,
    source,
    state: applyState,
  });

  function handleSourceChange(nextSource: string) {
    activeApplySource.current = null;
    setSource(nextSource);
    setErrors([]);
    setPreview(null);
    setPreviewedSource(null);
    setApplyState("idle");
  }

  function handlePreview() {
    if (!source.trim()) {
      setPreview(null);
      setPreviewedSource(null);
      setApplyState("idle");
      setErrors(["먼저 JSON을 붙여넣어 주세요."]);
      return;
    }

    const result = parseDilutionRegistryJson(source);
    if (!result.ok) {
      setPreview(null);
      setPreviewedSource(null);
      setApplyState("idle");
      setErrors(result.errors);
      return;
    }

    setErrors([]);
    setPreview(createDilutionRegistryPreviewModel(result.payload));
    setPreviewedSource(source);
    setApplyState("idle");
  }

  function handleClear() {
    handleSourceChange("");
  }

  async function handleApply() {
    if (!applyEnabled) return;

    let requestBody: string;
    try {
      requestBody = createDilutionRegistryApplyRequestBody({
        previewedSource,
        source,
      });
    } catch {
      setApplyState("error");
      return;
    }

    activeApplySource.current = requestBody;
    setApplyState("saving");
    try {
      const response = await fetch(
        "/api/admin/data/dilution-registry/apply",
        {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: requestBody,
        },
      );
      const body = await response.json().catch(() => null);
      const status = response.ok
        ? readDilutionRegistryApplyResponse(body)
        : null;
      if (activeApplySource.current !== requestBody) return;
      setApplyState(status ?? "error");
    } catch {
      if (activeApplySource.current !== requestBody) return;
      setApplyState("error");
    } finally {
      if (activeApplySource.current === requestBody) {
        activeApplySource.current = null;
      }
    }
  }

  return (
    <div className={styles.stack}>
      <section className={styles.pastePanel}>
        <div className={styles.panelHeading}>
          <div>
            <span className={styles.kicker}>Paste · Check · Preview</span>
            <h2>Paste JSON</h2>
          </div>
          <span className={styles.previewOnly}>Preview before Apply</span>
        </div>

        <label className={styles.inputLabel} htmlFor="dilution-registry-json">
          Dilution Registry JSON
        </label>
        <textarea
          aria-describedby="dilution-registry-help"
          className={styles.textarea}
          id="dilution-registry-json"
          onChange={(event) => handleSourceChange(event.target.value)}
          placeholder='Paste JSON with "instruments", "snapshots", "activities", and "totals".'
          spellCheck={false}
          value={source}
        />
        <div className={styles.inputFooter}>
          <p id="dilution-registry-help">
            Preview checks the JSON shape and linked Instrument Keys before Apply can save it.
          </p>
          <span>{source.length.toLocaleString("en-US")} characters</span>
        </div>
        <div className={styles.actions}>
          <button className={styles.primaryButton} onClick={handlePreview} type="button">
            Preview
          </button>
          <button className={styles.secondaryButton} onClick={handleClear} type="button">
            Clear
          </button>
          <button
            className={styles.applyButton}
            disabled={!applyEnabled}
            onClick={handleApply}
            type="button"
          >
            Apply
          </button>
        </div>
        <div className={styles.applyNotice}>
          <p>이 내용을 Dilution Registry에 저장합니다.</p>
          {applyState !== "idle" ? (
            <strong
              className={
                applyState === "error" ? styles.applyError : styles.applyResult
              }
              role={applyState === "error" ? "alert" : "status"}
            >
              {DILUTION_REGISTRY_APPLY_MESSAGES[applyState]}
            </strong>
          ) : null}
        </div>
      </section>

      {errors.length ? (
        <div className={styles.error} role="alert">
          <strong>Preview를 만들 수 없습니다.</strong>
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? <RegistryPreview model={preview} /> : null}
    </div>
  );
}

function RegistryPreview({ model }: { model: DilutionRegistryPreviewModel }) {
  const summary = [
    ["Instruments", model.summary.instruments],
    ["Snapshots", model.summary.snapshots],
    ["Current", model.summary.current],
    ["Old", model.summary.old],
    ["Closed", model.summary.closed],
    ["Activities", model.summary.activities],
    ["Totals", model.summary.totals],
  ] as const;

  return (
    <section className={styles.preview} aria-live="polite">
      <header className={styles.previewHeading}>
        <div>
          <span className={styles.kicker}>Ready to review</span>
          <h2>{model.title}</h2>
          <p>Review every section below before applying this exact Preview.</p>
        </div>
        <span className={styles.checked}>JSON checked</span>
      </header>

      <div className={styles.summaryGrid}>
        {summary.map(([label, value]) => (
          <article className={styles.summaryCard} key={label}>
            <span>{label}</span>
            <strong>{value.toLocaleString("en-US")}</strong>
          </article>
        ))}
      </div>

      <PreviewSection
        description="Current contracts and programs, with the newest dated entries first."
        title="Instruments"
      >
        <div className={styles.instrumentList}>
          {model.current.map((row) => (
            <InstrumentCard key={String(row.instrument.instrument_key)} row={row} />
          ))}
        </div>
      </PreviewSection>

      <PreviewSection
        description="Company-level totals kept exactly as provided in the JSON."
        title="Totals"
      >
        <div className={styles.totalGrid}>
          {model.totals.map((total, index) => (
            <TotalCard key={`${String(total.name)}-${index}`} total={total} />
          ))}
        </div>
      </PreviewSection>

      <PreviewSection
        description="Most recent dated activity first."
        title="Activities"
      >
        <div className={styles.activityList}>
          {model.activities.map((activity, index) => (
            <ActivityCard
              activity={activity}
              instrumentsByKey={model.instrumentsByKey}
              key={`${String(activity.activity_type)}-${index}`}
            />
          ))}
        </div>
      </PreviewSection>

      <div className={styles.historyGrid}>
        <PreviewSection
          description="Contracts confirmed as ended, cancelled, or fully converted."
          title={`Closed (${model.closed.length})`}
        >
          {model.closed.length ? (
            <div className={styles.instrumentList}>
              {model.closed.map((row) => (
                <InstrumentCard key={String(row.instrument.instrument_key)} row={row} />
              ))}
            </div>
          ) : (
            <EmptyState>No Closed instruments in this JSON.</EmptyState>
          )}
        </PreviewSection>

        <PreviewSection
          description="Past contracts whose current status is not certain."
          title={`Old (${model.old.length})`}
        >
          {model.old.length ? (
            <div className={styles.instrumentList}>
              {model.old.map((row) => (
                <InstrumentCard key={String(row.instrument.instrument_key)} row={row} />
              ))}
            </div>
          ) : (
            <EmptyState>No Old instruments in this JSON.</EmptyState>
          )}
        </PreviewSection>
      </div>
    </section>
  );
}

function PreviewSection({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className={styles.previewSection}>
      <header className={styles.sectionHeading}>
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function InstrumentCard({ row }: { row: DilutionRegistryInstrumentRow }) {
  const { instrument, snapshot } = row;
  const status = row.status ? STATUS_LABELS[row.status] ?? titleCase(row.status) : "Not listed";
  const holders = readStringArray(instrument.holders);
  const price = formatPrice(snapshot);
  const remaining = formatRemaining(snapshot);
  const details = snapshot ? instrumentDetails(snapshot) : [];

  return (
    <article className={styles.instrumentCard}>
      <div className={styles.instrumentTitle}>
        <div>
          <h4>{displayText(instrument.name)}</h4>
          <p>{TYPE_LABELS[String(instrument.instrument_type)] ?? titleCase(instrument.instrument_type)}</p>
        </div>
        <span className={statusClass(row.status)}>{status}</span>
      </div>
      <dl className={styles.instrumentFacts}>
        <Fact label="Holder" value={holders.length ? holders.join(", ") : "Not listed"} />
        <Fact label="As of" value={formatDate(snapshot?.as_of_date)} />
        <Fact label="Remaining Amount / Units" value={remaining} />
        <Fact label="Price" value={price} />
        <Fact label="End Date" value={formatDate(snapshot?.end_date)} />
        <Fact label="Last Checked" value={formatDate(snapshot?.last_checked)} />
      </dl>
      {details.length ? (
        <div className={styles.detailStrip}>
          {details.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {snapshot?.closed_reason ? (
        <p className={styles.closedReason}>
          <span>Closed reason</span>
          <strong>{titleCase(snapshot.closed_reason)}</strong>
        </p>
      ) : null}
    </article>
  );
}

function TotalCard({ total }: { total: DilutionRegistryRecord }) {
  const metrics: [string, string][] = [];
  if (hasValue(total.total_shares)) {
    metrics.push(["Total Shares", formatExactAndCompact(total.total_shares)]);
  }
  if (hasValue(total.other_shares)) {
    metrics.push(["Other Shares", formatExactAndCompact(total.other_shares)]);
  }
  if (hasValue(total.total_amount)) {
    metrics.push([
      "Total Amount",
      formatMoneyExactAndCompact(total.total_amount, total.currency),
    ]);
  }
  if (hasValue(total.other_amount)) {
    metrics.push([
      "Other Amount",
      formatMoneyExactAndCompact(total.other_amount, total.currency),
    ]);
  }

  return (
    <article className={styles.totalCard}>
      <h4>{displayText(total.name)}</h4>
      <dl>
        {metrics.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
        <Fact label="As of" value={formatDate(total.as_of_date)} />
      </dl>
    </article>
  );
}

function ActivityCard({
  activity,
  instrumentsByKey,
}: {
  activity: DilutionRegistryRecord;
  instrumentsByKey: Map<string, DilutionRegistryRecord>;
}) {
  const instrument = instrumentsByKey.get(String(activity.instrument_key));
  const related = readStringArray(activity.related_instrument_keys)
    .map((key) => instrumentsByKey.get(key))
    .filter((item): item is DilutionRegistryRecord => Boolean(item));
  const relatedHolders = [
    ...new Set(related.flatMap((item) => readStringArray(item.holders))),
  ];
  const title = instrument
    ? displayText(instrument.name)
    : relatedHolders.length
      ? relatedHolders.join(", ")
      : titleCase(activity.activity_type);
  const metrics = activityMetrics(activity);

  return (
    <article className={styles.activityCard}>
      <time>{formatDate(activity.activity_date ?? activity.period_end)}</time>
      <div>
        <h4>{title}</h4>
        <p>{titleCase(activity.activity_type)}</p>
      </div>
      <dl>
        {metrics.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </dl>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

function activityMetrics(activity: DilutionRegistryRecord): [string, string][] {
  const definitions: [string, string, boolean][] = [
    ["Shares Issued", "shares_issued", false],
    ["Shares Sold", "shares_sold", false],
    ["Units Issued", "units_issued", false],
    ["Converted", "amount_converted", true],
    ["Converted Units", "units_converted", false],
    ["Exercised", "units_exercised", false],
    ["Cancelled", "units_cancelled", false],
    ["Expired", "units_expired", false],
    ["Amount Repaid", "amount_repaid", true],
    ["Interest Converted", "interest_converted", true],
    ["Used Amount", "used_amount", true],
    ["Gross Proceeds", "gross_proceeds", true],
  ];
  const metrics = definitions.flatMap(([label, key, money]) =>
    hasValue(activity[key])
      ? ([[label, money ? formatMoney(activity[key], activity.currency) : formatNumber(activity[key])]] as [string, string][])
      : [],
  );
  return metrics.length
    ? metrics
    : [[titleCase(activity.activity_type), "Recorded"]];
}

function instrumentDetails(snapshot: DilutionRegistryRecord): [string, string][] {
  const details: [string, string][] = [];
  const fields: [string, string, boolean][] = [
    ["Original", "original_capacity", true],
    ["Used Amount", "used_amount", true],
    ["Remaining Amount", "remaining_capacity", true],
    ["Original Amount", "original_amount", true],
    ["Converted", "converted_amount", true],
    ["Shares Issued", "shares_issued", false],
  ];
  fields.forEach(([label, key, money]) => {
    if (hasValue(snapshot[key])) {
      details.push([
        label,
        money ? formatMoney(snapshot[key], snapshot.currency) : formatNumber(snapshot[key]),
      ]);
    }
  });
  return details;
}

function formatRemaining(snapshot: DilutionRegistryRecord | null) {
  if (!snapshot) return "Not listed";
  const values: string[] = [];
  if (Object.hasOwn(snapshot, "remaining_amount")) {
    values.push(
      `Amount ${hasValue(snapshot.remaining_amount) ? formatMoney(snapshot.remaining_amount, snapshot.currency) : "Unknown"}`,
    );
  }
  if (Object.hasOwn(snapshot, "remaining_units")) {
    values.push(
      `Units ${hasValue(snapshot.remaining_units) ? formatNumber(snapshot.remaining_units) : "Unknown"}`,
    );
  }
  if (Object.hasOwn(snapshot, "remaining_capacity")) {
    values.push(
      `Amount ${hasValue(snapshot.remaining_capacity) ? formatMoney(snapshot.remaining_capacity, snapshot.currency) : "Unknown"}`,
    );
  }
  return values.length ? values.join(" · ") : "Not listed";
}

function formatPrice(snapshot: DilutionRegistryRecord | null) {
  if (!snapshot) return "Not listed";
  const prices: string[] = [];
  if (hasValue(snapshot.conversion_price)) {
    prices.push(`Conversion ${formatMoney(snapshot.conversion_price, snapshot.currency)}`);
  }
  if (hasValue(snapshot.exercise_price)) {
    prices.push(`Exercise ${formatMoney(snapshot.exercise_price, snapshot.currency)}`);
  }
  if (hasValue(snapshot.floor_price)) {
    prices.push(`Floor ${formatMoney(snapshot.floor_price, snapshot.currency)}`);
  }
  if (hasValue(snapshot.price_formula)) {
    prices.push(String(snapshot.price_formula));
  }
  return prices.length ? prices.join(" · ") : "Not listed";
}

function formatExactAndCompact(value: unknown) {
  const exact = formatNumber(value);
  return typeof value === "number" && Math.abs(value) >= 1_000_000
    ? `${exact} (${(value / 1_000_000).toFixed(2)}M)`
    : exact;
}

function formatMoneyExactAndCompact(value: unknown, currency: unknown) {
  const exact = formatMoney(value, currency);
  return typeof value === "number" && Math.abs(value) >= 1_000_000
    ? `${exact} (${moneyPrefix(currency)}${(value / 1_000_000).toFixed(2)}M)`
    : exact;
}

function formatMoney(value: unknown, currency: unknown) {
  return `${moneyPrefix(currency)}${formatNumber(value)}`;
}

function moneyPrefix(currency: unknown) {
  return !currency || currency === "USD" ? "$" : `${String(currency)} `;
}

function formatNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return NUMBER_FORMAT.format(value);
  }
  return hasValue(value) ? String(value) : "Unknown";
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "Not listed";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : DATE_FORMAT.format(date);
}

function displayText(value: unknown) {
  return hasValue(value) ? String(value) : "Not listed";
}

function titleCase(value: unknown) {
  return displayText(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item))
    : [];
}

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function statusClass(status: string | null) {
  if (status === "closed") return `${styles.status} ${styles.statusClosed}`;
  if (status === "old") return `${styles.status} ${styles.statusOld}`;
  return `${styles.status} ${styles.statusCurrent}`;
}
