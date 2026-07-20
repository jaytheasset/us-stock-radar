import styles from "./ListingFinancialRiskSnapshot.module.css";

export type ListingFinancialRiskSnapshotItem = {
  label: string;
  note?: string;
  value: string;
};

export type ListingFinancialRiskSnapshotData = {
  items: ListingFinancialRiskSnapshotItem[];
  title: string;
};

type ListingFinancialRiskSnapshotProps = {
  snapshot: ListingFinancialRiskSnapshotData;
};

export function ListingFinancialRiskSnapshot({
  snapshot,
}: ListingFinancialRiskSnapshotProps) {
  const title = cleanText(snapshot.title);
  const items = snapshot.items
    .map((item) => ({
      label: cleanText(item.label),
      note: cleanText(item.note),
      value: cleanText(item.value),
    }))
    .filter((item) => item.label && item.value)
    .slice(0, 4);

  if (!title || items.length !== 4) return null;

  return (
    <section className={styles.snapshot}>
      <h2>{title}</h2>
      <dl className={styles.grid}>
        {items.map((item, index) => (
          <div className={styles.item} key={`${item.label}-${item.value}-${index}`}>
            <dt>{item.label}</dt>
            <dd>
              <strong>{item.value}</strong>
              {item.note ? <span>{item.note}</span> : null}
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
