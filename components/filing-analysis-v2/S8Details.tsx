import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import styles from "./S8Details.module.css";

export type S8Mode =
  | "plan_registration"
  | "inducement_awards"
  | "reoffer_resale"
  | "post_effective_amendment";

export type S8DetailRow = {
  label: string;
  note?: string;
  value: string;
};

export type S8Data = {
  details: S8DetailRow[];
  detailsTitle: string;
  mode: S8Mode;
  snapshot: ListingFinancialRiskSnapshotData;
};

export function S8Snapshot({ data }: { data: S8Data }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function S8Details({ data }: { data: S8Data }) {
  const rows = data.details
    .map((row) => ({
      label: cleanText(row.label),
      note: cleanText(row.note),
      value: cleanText(row.value),
    }))
    .filter((row) => row.label && row.value)
    .slice(0, 6);

  if (!rows.length) return null;

  return (
    <section className={styles.panel}>
      <header className={styles.heading}>
        <h2>{data.detailsTitle}</h2>
        <span>Key terms</span>
      </header>
      <dl className={styles.rows}>
        {rows.map((row, index) => (
          <div className={styles.row} key={`${row.label}-${row.value}-${index}`}>
            <dt>{row.label}</dt>
            <dd>
              <strong>{row.value}</strong>
              {row.note ? <span>{row.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function cleanText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}
