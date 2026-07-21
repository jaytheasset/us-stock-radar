import type { CSSProperties } from "react";
import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import styles from "./FinancingDilutionCapitalStructure.module.css";

export type FinancingDilutionScaleMode = "amount" | "shares";

export type FinancingDilutionRowRole =
  | "alternative"
  | "conditional"
  | "counted"
  | "reference";

type FinancingDilutionRoleKind =
  | "alternative"
  | "base"
  | "conditional"
  | "future"
  | "included"
  | "reference";

export type FinancingDilutionDetailRow = {
  label: string;
  note?: string;
  value: string;
};

export type FinancingDilutionInstrument = {
  exerciseOrConversionPrice?: string;
  resetOrFloor?: string;
  securities?: string;
  termOrLimits?: string;
  type: string;
};

export type FinancingDilutionScaleSegment = {
  calculationRole?: string;
  classBasis?: string;
  countedInRatio?: boolean;
  label: string;
  note?: string;
  numericValue: number;
  poolId?: string;
  poolRelationship?: "additive" | "alternative_max";
  roleBadge?: string;
  roleKind?: FinancingDilutionRoleKind;
  rowRole?: FinancingDilutionRowRole;
  supplyNature?: string;
  supplyType?: string;
  tone: "base" | "conditional" | "supply";
  unit?: string;
  value: string;
};

type FinancingDilutionScale = {
  basis: {
    label: string;
    note?: string;
    numericValue?: number;
    value: string;
  };
  caption: string;
  headlineLabel: string;
  headlineValue: string;
  mode: FinancingDilutionScaleMode;
  note: string;
  segments: FinancingDilutionScaleSegment[];
  subtitle: string;
  title: string;
  total?: {
    denominator: string;
    numerator: string;
    ratio: string;
    title: string;
  };
};

export type FinancingDilutionCapitalStructureData = {
  instruments: FinancingDilutionInstrument[];
  offeringDetails: FinancingDilutionDetailRow[];
  scale?: FinancingDilutionScale;
  snapshot: ListingFinancialRiskSnapshotData;
};

export function FinancingDilutionSnapshot({
  data,
}: {
  data: FinancingDilutionCapitalStructureData;
}) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function FinancingDilutionDetails({
  data,
}: {
  data: FinancingDilutionCapitalStructureData;
}) {
  const hasScale = Boolean(data.scale);
  const hasOfferingDetails = data.offeringDetails.length > 0;

  return (
    <div className={styles.stack}>
      {hasScale || hasOfferingDetails ? (
        <div
          className={`${styles.primaryGrid}${
            hasScale && hasOfferingDetails ? "" : ` ${styles.primaryGridSingle}`
          }`}
        >
          {data.scale ? <ScalePanel scale={data.scale} /> : null}
          {hasOfferingDetails ? (
            <FinancingDilutionOfferingDetails data={data} />
          ) : null}
        </div>
      ) : null}
      <FinancingDilutionInstrumentDetails data={data} />
    </div>
  );
}

export function FinancingDilutionOfferingDetails({
  data,
}: {
  data: FinancingDilutionCapitalStructureData;
}) {
  return data.offeringDetails.length ? (
    <DetailRows rows={data.offeringDetails} title="Offering Details" />
  ) : null;
}

export function FinancingDilutionInstrumentDetails({
  data,
}: {
  data: FinancingDilutionCapitalStructureData;
}) {
  return data.instruments.length ? (
    <InstrumentTable instruments={data.instruments} />
  ) : null;
}

function ScalePanel({
  scale,
}: {
  scale: FinancingDilutionScale;
}) {
  const indexedSegments = scale.segments.map((segment, index) => ({
    code: scaleCode(index + 1),
    index,
    segment,
  }));
  const includedSegments = collapseAlternativeScaleSegments(
    indexedSegments.filter(({ segment }) => isIncludedScaleSegment(segment, scale.mode)),
  );
  const canRenderScale =
    Boolean(scale.basis.numericValue && scale.basis.numericValue > 0) &&
    includedSegments.some(({ segment }) => segment.numericValue > 0);
  const totalNumeric = canRenderScale
    ? (scale.basis.numericValue || 0) +
      includedSegments.reduce((total, { segment }) => total + segment.numericValue, 0)
    : 0;
  const extremeScale = getExtremeShareScale(scale, includedSegments);
  const extremeScaleCodes = includedSegments.map(({ code }) => code);

  return (
    <section className={styles.panel}>
      <header className={styles.scaleHeader}>
        <div>
          <h2>{scale.title}</h2>
          <p>{scale.subtitle}</p>
        </div>
        <div className={styles.headline}>
          <span>{scale.headlineLabel}</span>
          <strong>{scale.headlineValue}</strong>
          <small>{scale.caption}</small>
        </div>
      </header>

      {canRenderScale ? (
        <div className={styles.chart}>
          {extremeScale ? (
            <div className={styles.extremeScale}>
              <div className={styles.extremeScaleReadouts}>
                <div>
                  <strong>{scale.basis.label}</strong>
                  <span>= 1.0x baseline</span>
                </div>
                <div>
                  <strong>Included Supply</strong>
                  <span>= {extremeScale.multipleText} current shares</span>
                </div>
              </div>
              <div
                aria-label={`${scale.title}: included supply equals ${extremeScale.multipleText} current shares`}
                className={styles.extremeScaleRail}
                role="img"
              >
                <b>A · 1.0x</b>
                <i><strong>{extremeScale.multipleText}</strong></i>
                <span>({extremeScaleCodes.join(" + ")})</span>
              </div>
              <p>
                Included supply is {extremeScale.multipleText} ({scale.total?.ratio || scale.headlineValue}) of current shares.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.barMetrics}>
                <span
                  className={`${styles.barMetric} ${styles.baseMetric}`}
                  style={segmentWidth((scale.basis.numericValue || 0) / totalNumeric)}
                >
                  <i>A</i>
                  <span>
                    <small>{scale.basis.label}</small>
                    <strong>{scale.basis.value}</strong>
                  </span>
                </span>
                {includedSegments.map(({ code, segment }) => (
                  <span
                    className={`${styles.barMetric} ${styles.supplyMetric}`}
                    key={`${code}-${segment.label}-metric`}
                    style={segmentWidth(segment.numericValue / totalNumeric)}
                  >
                    <i>{code}</i>
                    <span>
                      <small>{segment.label}</small>
                      <strong>{segment.value}</strong>
                    </span>
                  </span>
                ))}
              </div>

              <div
                aria-label={`${scale.title}: ${scale.headlineValue} ${scale.caption}`}
                className={styles.bar}
                role="img"
              >
                <span
                  aria-hidden="true"
                  className={`${styles.segment} ${styles.base}`}
                  style={segmentWidth((scale.basis.numericValue || 0) / totalNumeric)}
                />
                {includedSegments.map(({ code, segment }) => (
                  <span
                    aria-hidden="true"
                    className={`${styles.segment} ${styles[segment.tone]}`}
                    key={`${code}-${segment.label}-${segment.value}`}
                    style={segmentWidth(segment.numericValue / totalNumeric)}
                  />
                ))}
              </div>
            </>
          )}

          <div className={styles.legend}>
            <ScaleLegendItem
              code="A"
              label={scale.basis.label}
              note={scale.basis.note}
              roleBadge={scale.mode === "amount" ? "Base" : "Baseline"}
              roleKind="base"
              tone="base"
              value={scale.basis.value}
            />
            {indexedSegments.map(({ code, segment }) => {
              const role = scaleSegmentRole(segment);
              return (
              <ScaleLegendItem
                code={code}
                key={`${code}-${segment.label}-legend`}
                label={segment.label}
                note={segment.note}
                roleBadge={role.badge}
                roleKind={role.kind}
                tone={segment.tone}
                value={segment.value}
              />
              );
            })}
          </div>

          {scale.total ? (
            <div className={styles.equation}>
              <strong>{scale.total.title}</strong>
              <span>
                <b>{scale.total.numerator}</b>
                <i>/</i>
                <b>{scale.total.denominator}</b>
                <i>=</i>
                <strong>{scale.total.ratio}</strong>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className={styles.scaleNote}>{scale.note}</p>
    </section>
  );
}

function ScaleLegendItem({
  code,
  label,
  note,
  roleBadge,
  roleKind,
  tone,
  value,
}: {
  code: string;
  label: string;
  note?: string;
  roleBadge: string;
  roleKind: FinancingDilutionRoleKind;
  tone: FinancingDilutionScaleSegment["tone"];
  value: string;
}) {
  return (
    <div className={`${styles.legendItem} ${styles[`role_${roleKind}`]}`}>
      <span className={`${styles.legendCode} ${styles[tone]}`}>{code}</span>
      <div className={styles.legendCopy}>
        <strong>{label}</strong>
        {note ? <small>{note}</small> : null}
      </div>
      <div className={styles.legendValue}>
        <i>{roleBadge}</i>
        <b>{value}</b>
      </div>
    </div>
  );
}

function DetailRows({
  rows,
  title,
}: {
  rows: FinancingDilutionDetailRow[];
  title: string;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        <span>Key terms</span>
      </div>
      <dl className={styles.detailRows}>
        {rows.slice(0, 6).map((row) => (
          <div key={`${row.label}-${row.value}`}>
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

function InstrumentTable({
  instruments,
}: {
  instruments: FinancingDilutionInstrument[];
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHeading}>
        <h2>Instrument Details</h2>
        <span>Key terms</span>
      </div>
      <div className={styles.tableScroller}>
        <table className={styles.instrumentTable}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Shares / Securities</th>
              <th>Exercise / Conversion Price</th>
              <th>Reset / Floor</th>
              <th>Term / Limits</th>
            </tr>
          </thead>
          <tbody>
            {instruments.slice(0, 8).map((instrument) => (
              <tr key={`${instrument.type}-${instrument.securities}`}>
                <th scope="row">{instrument.type}</th>
                <td>{displayInstrumentTerm(instrument.securities)}</td>
                <td>{displayInstrumentTerm(instrument.exerciseOrConversionPrice)}</td>
                <td>{displayInstrumentTerm(instrument.resetOrFloor)}</td>
                <td>{displayInstrumentTerm(instrument.termOrLimits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function displayInstrumentTerm(value?: string) {
  const normalized = value?.trim();
  if (!normalized || normalized === "-") return "\u2014";

  const comparable = normalized.toLowerCase().replace(/\s+/g, " ");
  if (["n/a", "not applicable", "not relevant"].includes(comparable)) {
    return "\u2014";
  }
  if (
    [
      "no floor stated",
      "no reset stated",
      "no reset / floor stated",
    ].includes(comparable)
  ) {
    return "None";
  }
  if (
    [
      "not disclosed",
      "not provided",
      "not specified",
      "not stated",
    ].includes(comparable)
  ) {
    return "\u2014";
  }

  return normalized;
}

function segmentWidth(ratio: number) {
  return {
    "--segment-width": `${Math.max(0, Math.min(100, ratio * 100))}%`,
  } as CSSProperties;
}

function scaleCode(index: number) {
  if (index < 26) return String.fromCharCode(65 + index);
  return `A${index - 25}`;
}

function isIncludedScaleSegment(
  segment: FinancingDilutionScaleSegment,
  mode: FinancingDilutionScaleMode,
) {
  if (
    mode === "amount" &&
    ["atm_capacity", "shelf_capacity"].includes(segment.supplyType || "")
  ) {
    return true;
  }
  if (segment.rowRole) return segment.rowRole === "counted";
  if (typeof segment.countedInRatio === "boolean") return segment.countedInRatio;
  if (segment.calculationRole) return segment.calculationRole === "headline_numerator";
  return [
    "common_equivalent_supply",
    "current_offering_supply",
    "registered_resale_supply",
  ].includes(segment.supplyNature || "");
}

function collapseAlternativeScaleSegments(
  entries: Array<{
    code: string;
    index: number;
    segment: FinancingDilutionScaleSegment;
  }>,
) {
  const output: typeof entries = [];
  const pools = new Map<string, typeof entries>();

  for (const entry of entries) {
    const { poolId, poolRelationship } = entry.segment;
    if (poolId && poolRelationship === "alternative_max") {
      const pool = pools.get(poolId) || [];
      pool.push(entry);
      pools.set(poolId, pool);
    } else {
      output.push(entry);
    }
  }

  for (const pool of pools.values()) {
    const representative = pool.reduce((selected, entry) =>
      entry.segment.numericValue > selected.segment.numericValue ? entry : selected,
    );
    output.push(representative);
  }

  return output.sort((left, right) => left.index - right.index);
}

const EXTREME_DILUTION_MULTIPLE_THRESHOLD = 3;

function getExtremeShareScale(
  scale: FinancingDilutionScale,
  includedSegments: ReturnType<typeof collapseAlternativeScaleSegments>,
) {
  if (scale.mode !== "shares") return null;

  const baseValue = scale.basis.numericValue || 0;
  const includedValue = includedSegments.reduce(
    (total, { segment }) => total + segment.numericValue,
    0,
  );
  if (baseValue <= 0 || includedValue <= 0) return null;

  const multiple = includedValue / baseValue;
  if (multiple < EXTREME_DILUTION_MULTIPLE_THRESHOLD) return null;

  return {
    multiple,
    multipleText: `${multiple
      .toFixed(multiple >= 10 ? 1 : 2)
      .replace(/\.0+$/, "")}x`,
  };
}

function scaleSegmentRole(segment: FinancingDilutionScaleSegment): {
  badge: string;
  kind: FinancingDilutionRoleKind;
} {
  if (segment.roleBadge) {
    return { badge: segment.roleBadge, kind: segment.roleKind || "reference" };
  }

  if (segment.rowRole === "counted") return { badge: "Counted", kind: "included" };
  if (segment.rowRole === "conditional") return { badge: "Conditional", kind: "conditional" };
  if (segment.rowRole === "alternative") return { badge: "Alternative", kind: "alternative" };
  if (segment.supplyType === "atm_capacity") return { badge: "Capacity", kind: "included" };
  if (segment.supplyType === "shelf_capacity") return { badge: "Future capacity", kind: "future" };
  if (segment.rowRole === "reference") return { badge: "Reference", kind: "reference" };
  if (segment.countedInRatio === true) return { badge: "Counted", kind: "included" };
  if (segment.supplyNature === "replacement_supply") {
    return { badge: "Alternative", kind: "alternative" };
  }
  if (segment.supplyNature === "conditional_future_supply") {
    return { badge: "Conditional", kind: "conditional" };
  }
  return { badge: "Reference", kind: "reference" };
}
