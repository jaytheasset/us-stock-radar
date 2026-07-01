export type DilutionShareOverhangBarSegment = {
  key: string;
  className: string;
  supplyNature?: string;
  supplyType?: string;
  countedInRatio?: boolean;
  calculationRole?: string;
  unit?: string;
  classBasis?: string;
  poolId?: string;
  poolRelationship?: string;
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
  supplyNature?: string;
  supplyType?: string;
  countedInRatio?: boolean;
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
  "Share counts may differ from current market data after filings, splits, or later offerings.";
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
              <div className="dilution-overhang-bar">
                {model.overhangBarSegments.map((segment, index) => (
                  <span
                    key={segment.key}
                    className={`${segment.className}${segment.compact ? " compact" : ""}`}
                    style={{ width: `${segment.width}%` }}
                    title={`${segment.label}: ${segment.value}${segment.note ? ` ${segment.note}` : ""}`}
                  >
                    {segment.compact ? (
                      <b>{OVERHANG_SEGMENT_CODES[index] || index + 1}</b>
                    ) : (
                      <span className="dilution-overhang-bar-content">
                        <b>{OVERHANG_SEGMENT_CODES[index] || index + 1}</b>
                        <span>
                          <em>{segment.label}</em>
                          <strong>{segment.value}</strong>
                        </span>
                      </span>
                    )}
                  </span>
                ))}
              </div>
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
              <p className="dilution-data-disclaimer">{DILUTION_MARKET_DATA_DISCLAIMER}</p>
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
              <p className="dilution-data-disclaimer">{DILUTION_MARKET_DATA_DISCLAIMER}</p>
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

function overhangSupplyRole(row: { countedInRatio?: boolean; supplyType?: string; supplyNature?: string }) {
  if (row.countedInRatio === true) return { kind: "included", badge: "Counted" };
  if (row.countedInRatio === false) {
    if (row.supplyType === "replacement_alternative") return { kind: "alternative", badge: "Alternative" };
    if (row.supplyType === "future_exercise") return { kind: "conditional", badge: "Conditional" };
    return { kind: "reference", badge: "Reference" };
  }

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
