export type DilutionShareOverhangBarSegment = {
  key: string;
  className: string;
  rowRole?: string;
  supplyNature?: string;
  supplyType?: string;
  countedInRatio?: boolean;
  calculationRole?: string;
  unit?: string;
  classBasis?: string;
  poolId?: string;
  poolRelationship?: string;
  roleBadge?: string;
  roleKind?: "base" | "included" | "future" | "alternative" | "conditional" | "reference";
  label: string;
  value: string;
  note?: string;
  numericValue?: number | null;
  width: number;
  compact?: boolean;
};

export type DilutionShareOverhangBreakdownRow = {
  key: string;
  className: string;
  label: string;
  value: string;
  ratio: string;
};

type DilutionShareOverhangFactRow = {
  label: string;
  value: string;
  note?: string;
  tone?: "danger" | "neutral";
  rowRole?: string;
  supplyNature?: string;
  supplyType?: string;
  countedInRatio?: boolean;
  roleBadge?: string;
  roleKind?: "base" | "included" | "future" | "alternative" | "conditional" | "reference";
};

type DilutionInstrumentDetailRow = {
  type: string;
  sharesSecurities?: string;
  exerciseConversionPrice?: string;
  resetFloor?: string;
  termLimits?: string;
};

type DilutionShareOverhangDetailPanel = {
  title: string;
  rows?: DilutionShareOverhangFactRow[];
  instrumentRows?: DilutionInstrumentDetailRow[];
};

type DilutionShareOverhangModel = {
  breakdownCaption?: string;
  canRenderOverhangChart: boolean;
  chartTitle?: string;
  currentDetailLabel?: string;
  currentSharesCompact: string;
  dilutionRatioPercentValue: string;
  dilutionRatioValue: string;
  overhangAriaLabel?: string;
  overhangBarSegments: DilutionShareOverhangBarSegment[];
  overhangBreakdownRows?: DilutionShareOverhangBreakdownRow[];
  overhangLevel: string;
  overhangLevelLabel?: string;
  overhangNote?: string;
  overhangScoreCaption?: string;
  overhangScoreNote?: string;
  overhangSubtitle: string;
  overhangUnavailableMessage?: string;
  potentialSupplyCompact: string;
  compactScore?: boolean;
  hideScoreValue?: boolean;
  hideUnavailableRows?: boolean;
  unavailableRows?: DilutionShareOverhangFactRow[];
  unavailableSupplyValue?: string;
  conditionalSupplyRows?: DilutionShareOverhangFactRow[];
  showSegmentLegend?: boolean;
  showBreakdownPanel?: boolean;
  showTotalNote?: boolean;
  supplyDetailRows?: DilutionShareOverhangFactRow[];
  extraDetailPanels?: DilutionShareOverhangDetailPanel[];
  supplyDetailTitle?: string;
  requireProvidedSupplyDetails?: boolean;
  supplyDetailLabel: string;
  totalNoteSuffix?: string;
  totalNoteTitle?: string;
  totalOverhangLabel?: string;
};

const OVERHANG_SEGMENT_CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const DILUTION_MARKET_DATA_DISCLAIMER =
  "Share counts are filing-stated unless noted and may differ after splits, conversions, or later offerings.";
export const DILUTION_LATEST_MARKET_DATA_DISCLAIMER =
  "Share counts use latest market data when filing counts are unavailable and may differ from filing-date values.";
export const CAPACITY_FILING_DATA_DISCLAIMER =
  "Capacity comparisons use filing-stated values and may differ from current market data.";
export const CAPACITY_MARKET_DATA_DISCLAIMER =
  "Capacity comparisons use latest market data and may differ from filing-date values.";
export const CURRENT_SHARES_MARKET_CONTEXT_NOTE =
  "Latest available market-data share count. Filing-date share count may differ.";

function displayInstrumentCell(value: string | undefined, fallback: string) {
  const normalized = (value || "").trim();
  if (
    !normalized ||
    /^null$/i.test(normalized) ||
    /^undefined$/i.test(normalized) ||
    /^not\s+(?:stated|disclosed|provided)$/i.test(normalized)
  ) {
    return fallback;
  }
  return normalized;
}

function currentSharesTitle(label: string) {
  return /current shares/i.test(label) ? CURRENT_SHARES_MARKET_CONTEXT_NOTE : undefined;
}

const OVERHANG_BAR_ASSUMED_WIDTH_PX = 620;
const OVERHANG_SEGMENT_MIN_FULL_WIDTH_PERCENT = 18;

function estimateOverhangSegmentTextWidth(segment: DilutionShareOverhangBarSegment) {
  const label = segment.label.replace(/\s+/g, " ").trim();
  const value = segment.value.replace(/\s+/g, " ").trim();
  const codeWidth = 18;
  const gapWidth = 10;
  const horizontalPadding = 24;
  const labelWidth = label.length * 6.4;
  const valueWidth = value.length * 8.2;
  return codeWidth + gapWidth + Math.max(labelWidth, valueWidth) + horizontalPadding;
}

function requiredOverhangSegmentWidthPercent(segment: DilutionShareOverhangBarSegment) {
  const estimatedWidth = estimateOverhangSegmentTextWidth(segment);
  return Math.min(100, (estimatedWidth / OVERHANG_BAR_ASSUMED_WIDTH_PX) * 100 + 4);
}

function shouldShowFullOverhangSegment(segment: DilutionShareOverhangBarSegment) {
  if (!Number.isFinite(segment.width) || segment.width <= 0) return false;
  if (segment.width < OVERHANG_SEGMENT_MIN_FULL_WIDTH_PERCENT) return false;
  return segment.width >= requiredOverhangSegmentWidthPercent(segment);
}

function formatScaleMultiple(value: number) {
  const precision = value >= 10 ? 1 : 2;
  return `${value.toFixed(precision).replace(/\.0+$/, "")}x`;
}

function getExtremeScaleMode(segments: DilutionShareOverhangBarSegment[]) {
  const numericSegments = segments.filter((segment) => typeof segment.numericValue === "number" && segment.numericValue > 0);
  if (numericSegments.length !== segments.length) return null;

  const baseValue = numericSegments
    .filter((segment) => overhangSupplyRole(segment).kind === "base")
    .reduce((total, segment) => total + (segment.numericValue || 0), 0);
  const includedValue = numericSegments
    .filter((segment) => overhangSupplyRole(segment).kind === "included")
    .reduce((total, segment) => total + (segment.numericValue || 0), 0);

  if (baseValue <= 0 || includedValue <= 0) return null;
  const multiple = includedValue / baseValue;
  if (multiple < 3) return null;

  return {
    includedValue,
    multiple,
    multipleText: formatScaleMultiple(multiple),
  };
}

export function DilutionShareOverhang({ model }: { model: DilutionShareOverhangModel }) {
  const caption = model.overhangScoreCaption || model.overhangScoreNote || "Total potential dilution vs. current shares";
  const breakdownRows = model.overhangBreakdownRows || [];
  const breakdownCaption = model.breakdownCaption || "% of current";
  const chartTitle = model.chartTitle || "Share Overhang";
  const currentDetailLabel = model.currentDetailLabel || "Current Shares Outstanding";
  const overhangLevelLabel = model.overhangLevelLabel || "Overhang Level";
  const totalNoteSuffix = model.totalNoteSuffix || "potential supply vs. current shares";
  const totalNoteTitle = model.totalNoteTitle || "Total Potential Overhang";
  const totalOverhangLabel = model.totalOverhangLabel || "Total Overhang";
  const supplyDetailTitle = model.supplyDetailTitle || "Supply Details";
  const showTotalNote = model.showTotalNote !== false;
  const showSegmentLegend = model.showSegmentLegend !== false;
  const showBreakdownPanel = model.showBreakdownPanel !== false;
  const conditionalSupplyRows = model.conditionalSupplyRows || [];
  const baseUnavailableRows =
    model.unavailableRows && model.unavailableRows.length
      ? model.unavailableRows
      : [
          { label: currentDetailLabel, value: model.currentSharesCompact },
          { label: model.supplyDetailLabel, value: model.unavailableSupplyValue || model.potentialSupplyCompact || "Not stated" },
        ];
  const unavailableDisplayRows = baseUnavailableRows.concat(
    conditionalSupplyRows.map((row) => ({ ...row, label: formatConditionalSupplyLabel(row) })),
  );
  const supplyDetailRows = model.supplyDetailRows && model.supplyDetailRows.length
    ? model.supplyDetailRows
    : model.requireProvidedSupplyDetails
      ? []
      : [
          { label: currentDetailLabel, value: model.currentSharesCompact },
          { label: model.supplyDetailLabel, value: model.potentialSupplyCompact },
          { label: totalOverhangLabel, value: model.dilutionRatioValue, tone: "danger" as const },
          { label: overhangLevelLabel, value: model.overhangLevel },
        ];
  const extraDetailPanels = (model.extraDetailPanels || []).filter(
    (panel) => (panel.rows || []).length || (panel.instrumentRows || []).length,
  );
  const wideDetailPanels = extraDetailPanels.filter((panel) => (panel.instrumentRows || []).length);
  const sideDetailPanels = extraDetailPanels.filter((panel) => !(panel.instrumentRows || []).length);
  const scaleMode = getExtremeScaleMode(model.overhangBarSegments);
  const codeOnlyBar = !scaleMode && model.overhangBarSegments.every((segment) => !shouldShowFullOverhangSegment(segment));
  const includedScaleCodes = model.overhangBarSegments
    .map((segment, index) => (overhangSupplyRole(segment).kind === "included" ? OVERHANG_SEGMENT_CODES[index] || `${index + 1}` : ""))
    .filter(Boolean);
  const includedScaleLabel = includedScaleCodes.length ? `(${includedScaleCodes.join(" + ")})` : "Included";
  const dataDisclaimer = getDilutionDataDisclaimer(model);

  return (
    <section className="stock-detail-card dilution-overhang-card dilution-overhang-wide-card">
      <div className="dilution-overhang-body">
        <div
          className="dilution-overhang-chart"
          aria-label={model.overhangAriaLabel || `Potential supply equals ${model.dilutionRatioValue} of current shares`}
        >
          <div className="dilution-overhang-heading">
            <div>
              <h2>{chartTitle}</h2>
              <p>{model.overhangSubtitle}</p>
            </div>
            <div className={`dilution-overhang-score${model.compactScore ? " compact" : ""}`}>
              <span>{model.overhangLevel}</span>
              {model.hideScoreValue ? null : <strong>{model.dilutionRatioPercentValue}</strong>}
              <small>{caption}</small>
            </div>
          </div>

          {model.canRenderOverhangChart ? (
            <div className="dilution-overhang-plot">
              {scaleMode ? (
                <div className="dilution-overhang-scale-mode">
                  <div className="dilution-overhang-scale-readouts">
                    <div>
                      <strong>{currentDetailLabel}</strong>
                      <span>= 1.0x baseline</span>
                    </div>
                    <div>
                      <strong>{model.supplyDetailLabel || "Included supply"}</strong>
                      <span>= {scaleMode.multipleText} current shares</span>
                    </div>
                  </div>
                  <div className="dilution-overhang-scale-rail">
                    <b>1.0x</b>
                    <i>{scaleMode.multipleText}</i>
                    <span>{includedScaleLabel}</span>
                  </div>
                  <p>
                    Included supply is {scaleMode.multipleText} ({model.dilutionRatioValue}) of current shares.
                  </p>
                </div>
              ) : (
                <div className={`dilution-overhang-bar${codeOnlyBar ? " code-only" : ""}`}>
                  {model.overhangBarSegments.map((segment, index) => {
                    const showFullSegment = shouldShowFullOverhangSegment(segment);
                    return (
                      <span
                        key={segment.key}
                        className={`${segment.className}${showFullSegment ? " full" : " compact"}`}
                        style={{ width: `${segment.width}%` }}
                        title={`${segment.label}: ${segment.value}${segment.note ? ` ${segment.note}` : ""}`}
                      >
                        {showFullSegment ? (
                          <span className="dilution-overhang-bar-content">
                            <b>{OVERHANG_SEGMENT_CODES[index] || index + 1}</b>
                            <span>
                              <em>{segment.label}</em>
                              <strong>{segment.value}</strong>
                            </span>
                          </span>
                        ) : (
                          <b>{OVERHANG_SEGMENT_CODES[index] || index + 1}</b>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {showSegmentLegend ? (
                <div className="dilution-overhang-segment-legend">
                  {model.overhangBarSegments.map((segment, index) => {
                    const role = overhangSupplyRole(segment);
                    return (
                      <span key={segment.key} className={`supply-role-${role.kind}`}>
                        <b>
                          <span>
                            {OVERHANG_SEGMENT_CODES[index] || index + 1}. {segment.label}
                          </span>
                          <i>{role.badge}</i>
                        </b>
                        <strong>
                          <span>{segment.value}</span>
                          {segment.note ? <em>({segment.note})</em> : null}
                        </strong>
                      </span>
                    );
                  })}
                  {conditionalSupplyRows.map((row, index) => (
                    <span
                      key={`conditional-${row.label}-${index}`}
                      className={`conditional-supply supply-role-${overhangSupplyRole(row).kind}`}
                    >
                      <b>
                        <span>
                          {OVERHANG_SEGMENT_CODES[model.overhangBarSegments.length + index] || model.overhangBarSegments.length + index + 1}.{" "}
                          {formatConditionalSupplyLabel(row)}
                        </span>
                        <i>{overhangSupplyRole(row).badge}</i>
                      </b>
                      <strong className={row.tone === "danger" ? "danger" : undefined}>
                        <span>{row.value}</span>
                        {row.note ? <em>({row.note})</em> : null}
                      </strong>
                    </span>
                  ))}
                </div>
              ) : null}
              {showTotalNote ? (
                <div className="dilution-overhang-total-note">
                  <strong>{totalNoteTitle}</strong>
                  <span>
                    <b>{model.potentialSupplyCompact}</b>
                    <i>/</i>
                    <b>{model.currentSharesCompact}</b>
                    <i>=</i>
                    <strong>{model.dilutionRatioValue}</strong>
                    <em>{totalNoteSuffix}</em>
                  </span>
                </div>
              ) : null}
              <p className="dilution-data-disclaimer">{dataDisclaimer}</p>
            </div>
          ) : (
            <div className="dilution-overhang-unavailable">
              {model.hideUnavailableRows
                ? null
                : unavailableDisplayRows.map((row) => (
                    <div key={row.label}>
                      <span title={currentSharesTitle(row.label)}>{row.label}</span>
                      <strong className={row.tone === "danger" ? "danger" : undefined}>{row.value}</strong>
                      {row.note ? <em>{row.note}</em> : null}
                    </div>
                  ))}
              <p>{model.overhangUnavailableMessage || "Potential supply could not be calculated from disclosed share counts."}</p>
              <p className="dilution-data-disclaimer">{dataDisclaimer}</p>
            </div>
          )}
        </div>

        <div className="dilution-overhang-detail-grid">
          {supplyDetailRows.length ? (
            <section className="dilution-overhang-panel dilution-offering-details-panel">
              <h3>{supplyDetailTitle}</h3>
              <div className="dilution-overhang-facts">
                {supplyDetailRows.map((row) => (
                  <div key={row.label}>
                    <span title={currentSharesTitle(row.label)}>{row.label}</span>
                    <strong className={row.tone === "danger" ? "danger" : undefined}>{row.value}</strong>
                    {row.note ? <em>{row.note}</em> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {sideDetailPanels.map((panel) => (
            <DilutionExtraDetailPanel key={panel.title} panel={panel} />
          ))}

          {showBreakdownPanel ? (
            <section className="dilution-overhang-panel">
              <div className="dilution-breakdown-heading">
                <h3>Breakdown</h3>
                <span>{breakdownCaption}</span>
              </div>
              <div className="dilution-breakdown-list">
                {breakdownRows.map((row) => (
                  <div key={row.key}>
                    <span className="dilution-breakdown-label">
                      <i className={row.className} />
                      {row.label}
                    </span>
                    <strong>{row.value}</strong>
                    <b>{row.ratio}</b>
                  </div>
                ))}
              </div>
              <p className="dilution-overhang-note">
                {model.overhangNote || "High share overhang may create selling pressure. Monitor warrant exercise and note conversion activity."}
              </p>
            </section>
          ) : null}
        </div>
      </div>

      {wideDetailPanels.length ? (
        <div className="dilution-overhang-wide-panels">
          {wideDetailPanels.map((panel) => (
            <DilutionExtraDetailPanel key={panel.title} panel={panel} wide />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatConditionalSupplyLabel(row: DilutionShareOverhangFactRow) {
  return row.label;
}

function overhangSupplyRole(row: {
  rowRole?: string;
  countedInRatio?: boolean;
  supplyType?: string;
  supplyNature?: string;
  roleBadge?: string;
  roleKind?: "base" | "included" | "future" | "alternative" | "conditional" | "reference";
}) {
  if (row.roleBadge) return { kind: row.roleKind || "reference", badge: row.roleBadge };
  const supplyTypeRole = overhangSupplyTypeRole(row.supplyType);
  if (row.rowRole === "reference" && supplyTypeRole) return supplyTypeRole;
  switch (row.rowRole) {
    case "counted":
      return { kind: "included", badge: "Counted" };
    case "conditional":
      return { kind: "conditional", badge: "Conditional" };
    case "alternative":
      return { kind: "alternative", badge: "Alternative" };
    case "reference":
      return { kind: "reference", badge: "Reference" };
  }
  if (row.countedInRatio === true) return { kind: "included", badge: "Counted" };
  if (row.countedInRatio === false) {
    if (supplyTypeRole) return supplyTypeRole;
    return { kind: "reference", badge: "Reference" };
  }
  if (supplyTypeRole) return supplyTypeRole;

  switch (row.supplyNature) {
    case "base_shares":
      return { kind: "base", badge: "Baseline" };
    case "current_offering_supply":
    case "registered_resale_supply":
    case "common_equivalent_supply":
      return { kind: "included", badge: "Counted" };
    case "replacement_supply":
      return { kind: "alternative", badge: "Alternative" };
    case "conditional_future_supply":
      return { kind: "conditional", badge: "Conditional" };
    default:
      return { kind: "reference", badge: "Reference" };
  }
}

function overhangSupplyTypeRole(supplyType?: string) {
  switch (supplyType) {
    case "atm_capacity":
      return { kind: "included" as const, badge: "Capacity" };
    case "shelf_capacity":
      return { kind: "future" as const, badge: "Future capacity" };
    case "public_float":
    case "market_cap":
    case "market_value":
      return { kind: "base" as const, badge: "Base" };
    case "replacement_alternative":
      return { kind: "alternative" as const, badge: "Alternative" };
    case "future_exercise":
      return { kind: "conditional" as const, badge: "Conditional" };
    case "current_offering_pool":
    case "registered_resale_pool":
    case "share_equivalent":
      return { kind: "included" as const, badge: "Counted" };
    default:
      return null;
  }
}

function getDilutionDataDisclaimer(model: DilutionShareOverhangModel) {
  const isCapacityComparison = isCapacityScaleModel(model);
  const usesLatestMarketData = usesLatestMarketContext(model);

  if (isCapacityComparison) {
    return usesLatestMarketData ? CAPACITY_MARKET_DATA_DISCLAIMER : CAPACITY_FILING_DATA_DISCLAIMER;
  }

  return usesLatestMarketData ? DILUTION_LATEST_MARKET_DATA_DISCLAIMER : DILUTION_MARKET_DATA_DISCLAIMER;
}

function isCapacityScaleModel(model: DilutionShareOverhangModel) {
  const segmentUnits = model.overhangBarSegments.map((segment) => segment.unit || "").join(" ");
  const displayText = [
    model.chartTitle,
    model.currentDetailLabel,
    model.supplyDetailLabel,
    model.totalNoteTitle,
    model.totalNoteSuffix,
    model.totalOverhangLabel,
    model.overhangScoreCaption,
    model.overhangSubtitle,
    ...model.overhangBarSegments.flatMap((segment) => [segment.label, segment.value, segment.note, segment.unit, segment.supplyType]),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    /\busd\b/i.test(segmentUnits) ||
    /\b(?:ATM|shelf|capacity|market cap|public float)\b/i.test(displayText) &&
      /\b(?:capacity scale|capacity vs|program size|ATM capacity|shelf capacity|market cap|public float)\b/i.test(displayText)
  );
}

function usesLatestMarketContext(model: DilutionShareOverhangModel) {
  const displayText = [
    model.currentDetailLabel,
    model.currentSharesCompact,
    model.totalNoteSuffix,
    model.overhangScoreCaption,
    model.overhangSubtitle,
    model.overhangUnavailableMessage,
    ...model.overhangBarSegments.flatMap((segment) => [segment.label, segment.value, segment.note]),
    ...(model.unavailableRows || []).flatMap((row) => [row.label, row.value, row.note]),
    ...(model.supplyDetailRows || []).flatMap((row) => [row.label, row.value, row.note]),
  ]
    .filter(Boolean)
    .join(" ");

  if (/\b(?:latest|current)\s+(?:available\s+)?market(?:[-\s]?data)?\b|\bmarket_context\b/i.test(displayText)) {
    return true;
  }

  return /\bmarket cap\b/i.test(displayText) && !/\b(?:public float|as of|filing[-\s]?date|stated in (?:this )?filing)\b/i.test(displayText);
}

function DilutionExtraDetailPanel({
  panel,
  wide = false,
}: {
  panel: DilutionShareOverhangDetailPanel;
  wide?: boolean;
}) {
  return (
    <section
      className={`dilution-overhang-panel dilution-offering-details-panel${wide ? " dilution-overhang-wide-panel" : ""}`}
    >
      <h3>{panel.title}</h3>
      {(panel.instrumentRows || []).length ? (
        <div className="dilution-instrument-table">
          <div className="dilution-instrument-row header">
            <span>Type</span>
            <span>Shares / Securities</span>
            <span>Exercise / Conversion Price</span>
            <span>Reset / Floor</span>
            <span>Term / Limits</span>
          </div>
          {(panel.instrumentRows || []).map((row, index) => (
            <div key={`${row.type}-${index}`} className="dilution-instrument-row">
              <strong className="dilution-instrument-cell" data-label="Type">
                {row.type}
              </strong>
              <span className="dilution-instrument-cell" data-label="Shares / Securities">
                {displayInstrumentCell(row.sharesSecurities, "None")}
              </span>
              <span className="dilution-instrument-cell" data-label="Exercise / Conversion Price">
                {displayInstrumentCell(row.exerciseConversionPrice, "None")}
              </span>
              <span className="dilution-instrument-cell" data-label="Reset / Floor">
                {displayInstrumentCell(row.resetFloor, "None")}
              </span>
              <span className="dilution-instrument-cell" data-label="Term / Limits">
                {displayInstrumentCell(row.termLimits, "None")}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="dilution-overhang-facts">
          {(panel.rows || []).map((row, index) => (
            <div key={`${row.label}-${index}`}>
              <span title={currentSharesTitle(row.label)}>{row.label}</span>
              <strong className={row.tone === "danger" ? "danger" : undefined}>{row.value}</strong>
              {row.note ? <em>{row.note}</em> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
