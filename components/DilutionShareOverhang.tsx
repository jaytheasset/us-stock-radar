export type DilutionShareOverhangBarSegment = {
  key: string;
  className: string;
  label: string;
  value: string;
  note?: string;
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

type DilutionShareOverhangModel = {
  canRenderOverhangChart: boolean;
  currentSharesCompact: string;
  dilutionRatioPercentValue: string;
  dilutionRatioValue: string;
  overhangAriaLabel?: string;
  overhangBarSegments: DilutionShareOverhangBarSegment[];
  overhangBreakdownRows?: DilutionShareOverhangBreakdownRow[];
  overhangLevel: string;
  overhangNote?: string;
  overhangScoreCaption?: string;
  overhangScoreNote?: string;
  overhangSubtitle: string;
  overhangUnavailableMessage?: string;
  potentialSupplyCompact: string;
  supplyDetailLabel: string;
};

const OVERHANG_SEGMENT_CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function DilutionShareOverhang({ model }: { model: DilutionShareOverhangModel }) {
  const caption = model.overhangScoreCaption || model.overhangScoreNote || "Total potential dilution vs. current shares";
  const breakdownRows = model.overhangBreakdownRows || [];

  return (
    <section className="stock-detail-card dilution-overhang-card dilution-overhang-wide-card">
      <div className="dilution-overhang-body">
        <div
          className="dilution-overhang-chart"
          aria-label={model.overhangAriaLabel || `Potential supply equals ${model.dilutionRatioValue} of current shares`}
        >
          <div className="dilution-overhang-heading">
            <div>
              <h2>Share Overhang</h2>
              <p>{model.overhangSubtitle}</p>
            </div>
            <div className="dilution-overhang-score">
              <span>{model.overhangLevel}</span>
              <strong>{model.dilutionRatioPercentValue}</strong>
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
                      <>
                        <b>{OVERHANG_SEGMENT_CODES[index] || index + 1}</b>
                        <span>
                          <em>{segment.label}</em>
                          <strong>{segment.value}</strong>
                        </span>
                      </>
                    )}
                  </span>
                ))}
              </div>
              <div className="dilution-overhang-segment-legend">
                {model.overhangBarSegments.map((segment, index) => (
                  <span key={segment.key}>
                    <b>
                      {OVERHANG_SEGMENT_CODES[index] || index + 1}. {segment.label}
                    </b>
                    <strong>
                      <span>{segment.value}</span>
                      {segment.note ? <em>({segment.note})</em> : null}
                    </strong>
                  </span>
                ))}
              </div>
              <div className="dilution-overhang-total-note">
                <strong>Total Potential Overhang</strong>
                <span>
                  <b>{model.potentialSupplyCompact}</b>
                  <i>/</i>
                  <b>{model.currentSharesCompact}</b>
                  <i>=</i>
                  <strong>{model.dilutionRatioValue}</strong>
                  <em>potential supply vs. current shares</em>
                </span>
              </div>
            </div>
          ) : (
            <div className="dilution-overhang-unavailable">
              <div>
                <span>Current shares</span>
                <strong>{model.currentSharesCompact}</strong>
              </div>
              <div>
                <span>{model.supplyDetailLabel}</span>
                <strong>Not disclosed</strong>
              </div>
              <p>{model.overhangUnavailableMessage || "Potential supply could not be calculated from disclosed share counts."}</p>
            </div>
          )}
        </div>

        <div className="dilution-overhang-detail-grid">
          <section className="dilution-overhang-panel">
            <h3>Supply Details</h3>
            <div className="dilution-overhang-facts">
              <div>
                <span>Current Shares Outstanding</span>
                <strong>{model.currentSharesCompact}</strong>
              </div>
              <div>
                <span>{model.supplyDetailLabel}</span>
                <strong>{model.potentialSupplyCompact}</strong>
              </div>
              <div>
                <span>Total Overhang</span>
                <strong className="danger">{model.dilutionRatioValue}</strong>
              </div>
              <div>
                <span>Overhang Level</span>
                <strong>
                  <mark>{model.overhangLevel}</mark>
                </strong>
              </div>
            </div>
          </section>

          <section className="dilution-overhang-panel">
            <div className="dilution-breakdown-heading">
              <h3>Breakdown</h3>
              <span>% of current</span>
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
        </div>
      </div>
    </section>
  );
}
