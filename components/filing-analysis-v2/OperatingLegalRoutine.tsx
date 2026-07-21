import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
  type ListingFinancialRiskSnapshotItem,
} from "./ListingFinancialRiskSnapshot";
import styles from "./OperatingLegalRoutine.module.css";

export type OperatingEventMode =
  | "earnings"
  | "operating_update"
  | "product_or_regulatory"
  | "legal_or_accounting";

export type OperatingRegulatoryStage =
  | "not_applicable"
  | "ind_or_clinical_hold"
  | "application_review"
  | "advisory_committee"
  | "approval"
  | "crl_or_appeal"
  | "clinical_update"
  | "other_regulatory";

export type OperatingPerformanceComparison = {
  changeNote?: string;
  comparisonBasis: "other" | "qoq" | "yoy";
  comparisonLabel: string;
  comparisonNumeric: number;
  comparisonValue: string;
  currentLabel: string;
  currentNumeric: number;
  currentValue: string;
  label: string;
};

export type OperatingGuidanceMetric = {
  guidanceLabel: string;
  guidanceValue: string;
  label: string;
  note?: string;
  performanceLabel?: string;
  performanceRelationship?: "related_different_basis" | "same_basis" | "standalone";
};

export type OperatingBusinessUpdate = {
  summary: string;
  title: string;
  value?: string;
};

export type OperatingDetailSection = {
  rows: ListingFinancialRiskSnapshotItem[];
  title: string;
};

export type OperatingSecondaryUpdate = {
  label: string;
  summary: string;
  title: string;
};

export type OperatingLegalRoutineData = {
  businessUpdates: OperatingBusinessUpdate[];
  detailSections: OperatingDetailSection[];
  guidanceMetrics: OperatingGuidanceMetric[];
  mode: OperatingEventMode;
  performanceComparisons: OperatingPerformanceComparison[];
  regulatoryStage: OperatingRegulatoryStage;
  secondaryUpdates: OperatingSecondaryUpdate[];
  snapshot: ListingFinancialRiskSnapshotData;
};

export function OperatingEventSnapshot({ data }: { data: OperatingLegalRoutineData }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function OperatingEventDetails({ data }: { data: OperatingLegalRoutineData }) {
  const projectEconomics = data.detailSections.find(
    (section) => section.title.trim().toLowerCase() === "project economics",
  );
  const otherDetailSections = data.detailSections.filter(
    (section) => section !== projectEconomics,
  );
  const showPerformance = data.performanceComparisons.length || data.guidanceMetrics.length;

  return (
    <div className={styles.sections}>
      {showPerformance ? <PerformanceOutlook data={data} /> : null}
      {data.businessUpdates.length || projectEconomics ? (
        <KeyBusinessUpdates
          items={data.businessUpdates}
          projectEconomics={projectEconomics}
        />
      ) : null}
      {otherDetailSections.length ? (
        <DetailSections
          sections={otherDetailSections}
          title={operatingDetailTitle(data.mode, data.regulatoryStage)}
        />
      ) : null}
      {data.secondaryUpdates.length ? (
        <SecondaryUpdates items={data.secondaryUpdates} />
      ) : null}
    </div>
  );
}

function PerformanceOutlook({ data }: { data: OperatingLegalRoutineData }) {
  const guidanceByPerformance = new Map<string, OperatingGuidanceMetric>();
  const standaloneGuidance: OperatingGuidanceMetric[] = [];

  for (const guidance of data.guidanceMetrics) {
    const match = data.performanceComparisons.find(
      (item) =>
        guidance.performanceLabel &&
        item.label.trim().toLowerCase() === guidance.performanceLabel.trim().toLowerCase(),
    );
    if (match && guidance.performanceRelationship !== "standalone" && !guidanceByPerformance.has(match.label)) {
      guidanceByPerformance.set(match.label, guidance);
    } else {
      standaloneGuidance.push(guidance);
    }
  }

  return (
    <section className={styles.panel}>
      <PanelHeading title="Performance & Outlook" />
      {data.performanceComparisons.length ? (
        <div className={styles.performanceGrid}>
          {data.performanceComparisons.map((item) => (
            <PerformanceCard
              guidance={guidanceByPerformance.get(item.label)}
              item={item}
              key={`${item.label}-${item.currentLabel}`}
            />
          ))}
        </div>
      ) : null}
      {standaloneGuidance.length ? (
        <div className={styles.guidanceList}>
          {standaloneGuidance.map((item) => (
            <div className={styles.guidanceRow} key={`${item.label}-${item.guidanceLabel}`}>
              <span>{formatGuidanceLabel(item)}</span>
              <strong>{item.guidanceValue}</strong>
              {item.note ? <small>{item.note}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PerformanceCard({
  guidance,
  item,
}: {
  guidance?: OperatingGuidanceMetric;
  item: OperatingPerformanceComparison;
}) {
  const signed = item.currentNumeric < 0 || item.comparisonNumeric < 0;
  const scale = Math.max(Math.abs(item.currentNumeric), Math.abs(item.comparisonNumeric), 1);
  const currentWidth = Math.max(2, (Math.abs(item.currentNumeric) / scale) * (signed ? 50 : 100));
  const comparisonWidth = Math.max(2, (Math.abs(item.comparisonNumeric) / scale) * (signed ? 50 : 100));
  const change = performanceChange(item);

  return (
    <article className={styles.performanceCard}>
      <div className={styles.performanceHeading}>
        <h3>{item.label}</h3>
        {change ? <span className={change.tone ? styles[change.tone] : undefined}>{change.label}</span> : null}
      </div>
      <div className={styles.performanceRows}>
        <PerformanceRow
          label={item.comparisonLabel}
          numeric={item.comparisonNumeric}
          signed={signed}
          tone="comparison"
          value={item.comparisonValue}
          width={comparisonWidth}
        />
        <PerformanceRow
          label={item.currentLabel}
          numeric={item.currentNumeric}
          signed={signed}
          tone="current"
          value={item.currentValue}
          width={currentWidth}
        />
      </div>
      {guidance ? (
        <div className={styles.guidanceFooter}>
          <span>{formatGuidanceLabel(guidance)}</span>
          <strong>{guidance.guidanceValue}</strong>
          {guidance.note ? <small>{guidance.note}</small> : null}
        </div>
      ) : null}
    </article>
  );
}

function PerformanceRow({
  label,
  numeric,
  signed,
  tone,
  value,
  width,
}: {
  label: string;
  numeric: number;
  signed: boolean;
  tone: "comparison" | "current";
  value: string;
  width: number;
}) {
  return (
    <div className={styles.performanceRow}>
      <span>{label}</span>
      <div className={`${styles.track}${signed ? ` ${styles.signedTrack}` : ""}`}>
        {signed ? <i className={styles.zero} /> : null}
        <i
          className={`${styles.bar} ${styles[tone]} ${numeric < 0 ? styles.negative : ""}`}
          style={signed ? signedBarStyle(numeric, width) : { width: `${width}%` }}
        />
      </div>
      <strong className={numeric < 0 ? styles.negativeValue : undefined}>{value}</strong>
    </div>
  );
}

function KeyBusinessUpdates({
  items,
  projectEconomics,
}: {
  items: OperatingBusinessUpdate[];
  projectEconomics?: OperatingDetailSection;
}) {
  return (
    <section className={styles.panel}>
      <PanelHeading title="Key Business Updates" />
      <ol className={styles.updateList}>
        {items.map((item) => (
          <li key={`${item.title}-${item.value || ""}`}>
            <div className={styles.updateHeading}>
              <strong>{item.title}</strong>
              {item.value ? <span>{item.value}</span> : null}
            </div>
            <p>{item.summary}</p>
          </li>
        ))}
        {projectEconomics ? (
          <li>
            <div className={styles.updateHeading}>
              <strong>{projectEconomics.title}</strong>
            </div>
            <dl className={styles.projectGrid}>
              {projectEconomics.rows.map((row) => (
                <div key={`${row.label}-${row.value}`}>
                  <dt>{row.label}</dt>
                  <dd>
                    <strong>{row.value}</strong>
                    {row.note ? <small>{row.note}</small> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function DetailSections({ sections, title }: { sections: OperatingDetailSection[]; title: string }) {
  return (
    <section className={styles.panel}>
      <PanelHeading meta="Key terms" title={title} />
      <div className={`${styles.detailGrid}${sections.length === 1 ? ` ${styles.singleDetail}` : ""}`}>
        {sections.map((section) => (
          <div className={styles.detailGroup} key={section.title}>
            {sections.length > 1 ? <h3>{section.title}</h3> : null}
            <dl>
              {section.rows.map((row) => (
                <div key={`${section.title}-${row.label}-${row.value}`}>
                  <dt>{row.label}</dt>
                  <dd>
                    <strong>{row.value}</strong>
                    {row.note ? <small>{row.note}</small> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}

function SecondaryUpdates({ items }: { items: OperatingSecondaryUpdate[] }) {
  return (
    <section className={styles.panel}>
      <PanelHeading title="Other Material Event" />
      <div className={styles.secondaryList}>
        {items.map((item) => (
          <article key={`${item.label}-${item.title}`}>
            <span>{item.label}</span>
            <strong>{item.title}</strong>
            <p>{item.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function PanelHeading({ meta, title }: { meta?: string; title: string }) {
  return (
    <div className={styles.panelHeading}>
      <h2>{title}</h2>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

function signedBarStyle(value: number, width: number) {
  return value < 0
    ? { left: `calc(50% - ${width}%)`, width: `${width}%` }
    : { left: "50%", width: `${width}%` };
}

function performanceChange(item: OperatingPerformanceComparison) {
  if (item.currentNumeric < 0 || item.comparisonNumeric < 0) {
    if (item.comparisonNumeric < 0 && item.currentNumeric >= 0) {
      return { label: comparisonSuffix("Turned profitable", item.comparisonBasis), tone: "improvement" };
    }
    if (item.comparisonNumeric >= 0 && item.currentNumeric < 0) {
      return { label: comparisonSuffix("Swung to a loss", item.comparisonBasis), tone: "deterioration" };
    }
    if (item.currentNumeric < 0 && item.comparisonNumeric < 0 && item.comparisonNumeric !== 0) {
      const widened = Math.abs(item.currentNumeric) > Math.abs(item.comparisonNumeric);
      const percent = Math.round(
        Math.abs((Math.abs(item.currentNumeric) - Math.abs(item.comparisonNumeric)) / Math.abs(item.comparisonNumeric)) * 100,
      );
      return {
        label: comparisonSuffix(`${widened ? "Loss widened" : "Loss narrowed"} ${percent}%`, item.comparisonBasis),
        tone: widened ? "deterioration" : "improvement",
      };
    }
  }

  if (item.changeNote) {
    const lower = item.changeNote.toLowerCase();
    return {
      label: comparisonSuffix(item.changeNote, item.comparisonBasis),
      tone: /down|declin|widen|loss/.test(lower) ? "deterioration" : /up|grow|improv/.test(lower) ? "improvement" : "neutral",
    };
  }
  if (!item.comparisonNumeric) return null;
  const percent = Math.round(
    Math.abs((item.currentNumeric - item.comparisonNumeric) / item.comparisonNumeric) * 100,
  );
  const direction = item.currentNumeric >= item.comparisonNumeric ? "Up" : "Down";
  return {
    label: comparisonSuffix(`${direction} ${percent}%`, item.comparisonBasis),
    tone: direction === "Up" ? "improvement" : "deterioration",
  };
}

function comparisonSuffix(label: string, basis: OperatingPerformanceComparison["comparisonBasis"]) {
  if (/\b(?:YoY|QoQ)\b/i.test(label)) return label;
  if (basis === "yoy") return `${label} YoY`;
  if (basis === "qoq") return `${label} QoQ`;
  return label;
}

function formatGuidanceLabel(item: OperatingGuidanceMetric) {
  const label = item.guidanceLabel.trim();
  if (/expected range|guidance|outlook/i.test(label)) return `${item.label} Guidance`;
  return `${label} ${item.label}`.trim();
}

function operatingDetailTitle(mode: OperatingEventMode, stage: OperatingRegulatoryStage) {
  if (mode !== "product_or_regulatory") return mode === "legal_or_accounting" ? "Key Legal / Accounting Details" : "Key Details";
  if (stage === "ind_or_clinical_hold") return "Key IND Details";
  if (stage === "application_review" || stage === "advisory_committee") return "Key FDA Review Details";
  if (stage === "approval") return "Key FDA Approval Details";
  if (stage === "crl_or_appeal") return "Key FDA Appeal Details";
  if (stage === "clinical_update") return "Key Clinical Details";
  if (stage === "other_regulatory") return "Key Regulatory Details";
  return "Key Details";
}
