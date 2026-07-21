import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import styles from "./TenderOfferDetails.module.css";

export type TenderOfferMode =
  | "issuer_tender"
  | "third_party_tender"
  | "going_private"
  | "cross_border"
  | "material_amendment";

export type TenderOfferTerm = {
  label: string;
  note?: string;
  value: string;
};

export type TenderOfferChange = {
  current: string;
  label: string;
  note?: string;
  previous: string;
};

export type TenderOfferData = {
  changes?: TenderOfferChange[];
  mode: TenderOfferMode;
  snapshot: ListingFinancialRiskSnapshotData;
  terms: TenderOfferTerm[];
  termsTitle: string;
};

export function TenderOfferSnapshot({ data }: { data: TenderOfferData }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function TenderOfferDetails({ data }: { data: TenderOfferData }) {
  const terms = cleanTerms(data.terms);
  const changes = cleanChanges(data.changes);

  if (!terms.length && !changes.length) return null;

  return (
    <div className={styles.stack}>
      {changes.length ? (
        <section className={styles.panel}>
          <PanelHeading meta="Before / after" title="Changed Offer Terms" />
          <div className={styles.changeList}>
            {changes.map((change, index) => (
              <div className={styles.change} key={`${change.label}-${index}`}>
                <span className={styles.changeLabel}>{change.label}</span>
                <div className={styles.comparison}>
                  <span>{change.previous}</span>
                  <span aria-hidden="true" className={styles.arrow}>to</span>
                  <strong>{change.current}</strong>
                </div>
                {change.note ? <p>{change.note}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {terms.length ? (
        <section className={styles.panel}>
          <PanelHeading meta="Key terms" title={data.termsTitle || "Offer Terms"} />
          <dl className={styles.rows}>
            {terms.map((term, index) => (
              <div key={`${term.label}-${term.value}-${index}`}>
                <dt>{term.label}</dt>
                <dd>
                  <strong>{term.value}</strong>
                  {term.note ? <span>{term.note}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function PanelHeading({ meta, title }: { meta: string; title: string }) {
  return (
    <div className={styles.heading}>
      <h2>{title}</h2>
      <span>{meta}</span>
    </div>
  );
}

function cleanTerms(terms: TenderOfferTerm[]) {
  return terms
    .map((term) => ({
      label: term.label.trim(),
      note: term.note?.trim(),
      value: term.value.trim(),
    }))
    .filter((term) => term.label && term.value);
}

function cleanChanges(changes: TenderOfferChange[] | undefined) {
  return (changes || [])
    .map((change) => ({
      current: change.current.trim(),
      label: change.label.trim(),
      note: change.note?.trim(),
      previous: change.previous.trim(),
    }))
    .filter((change) => change.label && change.previous && change.current);
}
