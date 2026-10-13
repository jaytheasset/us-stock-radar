import type { SecondaryMonitorDisplay } from "@/lib/monitor/secondaryMonitorEvidence";
import { MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS } from "@/lib/monitor/conditionRegistry";

/** Renders only the saved snapshot supplied by the owner-scoped alert API. */
export function SecondaryMonitorAlertDetails({ display, createdAt }: {
  display?: SecondaryMonitorDisplay;
  createdAt: string;
}) {
  const evidence = display?.evidence;
  if (!evidence) return <>
    <strong>Alert delivered</strong>
    <span>{formatTimestamp(createdAt)}</span>
    <span>{display?.status === "invalid" ? "Saved evidence unavailable" : "Match evidence was not preserved for this alert"}</span>
  </>;
  return <>
    <strong>{evidence.companyName ?? "Company unconfirmed"} · {evidence.ticker ?? "Ticker unconfirmed"}</strong>
    <span>Form {evidence.filingForm} · Proposed sale notice</span>
    <span>Proposed sale only; not an executed sale or sale proceeds.</span>
    <span>Filed: {evidence.filedAt ? formatTimestamp(evidence.filedAt) : "Unconfirmed"}</span>
    <span>Accession: {evidence.accessionNumber} · Filing row {evidence.rowIndex + 1}</span>
    <div aria-label="Matched facts and saved conditions">
      {evidence.conditions.map((condition, index) => <p key={`${condition.key}-${index}`}>
        <b>{condition.label}</b>: {condition.factStatus === "stored" ? formatValue(condition.fact) : "Fact not preserved"}
        {" · Saved condition: "}{MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[condition.operator]} {formatValue(condition.expected)}
        {condition.operator === "within_days" ? " days at evaluation time" : ""}
      </p>)}
    </div>
    <span>Matched: {formatTimestamp(evidence.evaluatedAt)} · {display.status === "partial" ? "Some fact evidence was not preserved" : "Match-time evidence preserved"}</span>
    <a href={`/filings/${encodeURIComponent(evidence.eventId)}`}>View filing</a>
    {evidence.sourceUrl ? <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">SEC original filing</a> : <span>Source link unavailable</span>}
  </>;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-US", { timeZoneName: "short" });
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 20 }) : String(value ?? "Unconfirmed");
}
