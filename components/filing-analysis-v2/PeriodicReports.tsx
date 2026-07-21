import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import {
  OperatingEventDetails,
  type OperatingBusinessUpdate,
  type OperatingGuidanceMetric,
  type OperatingPerformanceComparison,
} from "./OperatingLegalRoutine";
import styles from "./PeriodicReports.module.css";

export type PeriodicAmendmentChange = {
  note?: string;
  title: string;
  value: string;
};

type PeriodicReportBase = {
  snapshot: ListingFinancialRiskSnapshotData;
};

export type PeriodicReportData =
  | (PeriodicReportBase & {
      businessUpdates: OperatingBusinessUpdate[];
      guidanceMetrics: OperatingGuidanceMetric[];
      mode: "report";
      performanceComparisons: OperatingPerformanceComparison[];
    })
  | (PeriodicReportBase & {
      changes: PeriodicAmendmentChange[];
      mode: "amendment";
    });

export function PeriodicReportSnapshot({ data }: { data: PeriodicReportData }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function PeriodicReportDetails({ data }: { data: PeriodicReportData }) {
  if (data.mode === "report") {
    return (
      <OperatingEventDetails
        data={{
          businessUpdates: data.businessUpdates,
          detailSections: [],
          guidanceMetrics: data.guidanceMetrics,
          mode: "earnings",
          performanceComparisons: data.performanceComparisons,
          regulatoryStage: "not_applicable",
          secondaryUpdates: [],
          snapshot: data.snapshot,
        }}
      />
    );
  }

  if (!data.changes.length) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <h2>Key Changes</h2>
        <span>{data.changes.length} {data.changes.length === 1 ? "item" : "items"}</span>
      </div>
      <ol className={styles.list}>
        {data.changes.map((change, index) => (
          <li key={`${change.title}-${change.value}-${index}`}>
            <span className={styles.index} aria-hidden="true">{index + 1}</span>
            <div className={styles.change}>
              <div className={styles.changeHeading}>
                <strong>{change.title}</strong>
                <span>{change.value}</span>
              </div>
              {change.note ? <p>{change.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
