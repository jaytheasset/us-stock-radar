import type {FactEvidence} from "@/lib/sec425/evidence";
import {announcementLabels,transactionLabels} from "@/lib/sec425/conditions";
import type { SecondaryMonitorDisplay } from "@/lib/monitor/secondaryMonitorEvidence";
import { MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS } from "@/lib/monitor/conditionRegistry";
import { formatSecondaryMonitorValue } from "@/lib/monitor/secondaryMonitorDisplay";
import type { ReportedHoldingsDisplay } from "@/lib/monitor/reportedHoldingsEvidence";
import { reportedHoldingsConditionText } from "@/lib/monitor/reportedHoldings";

/** Renders only the saved snapshot supplied by the owner-scoped alert API. */
export function SecondaryMonitorAlertDetails({ display, createdAt, sec425Evidence }: {
  display?: SecondaryMonitorDisplay | ReportedHoldingsDisplay;
  createdAt: string;
  sec425Evidence?:FactEvidence;
}) {
  if(sec425Evidence){const e=sec425Evidence;return <div style={{minWidth:0,width:"100%",overflowWrap:"anywhere"}}>
    <strong>{announcementLabels[e.announcementType]}</strong><p>{e.statement}</p><p>Announcement only; not confirmation of a completed transaction.</p>
    <p>{e.companies.map(c=>[c.name,c.ticker,c.role].filter(Boolean).join(" · ")).join(" / ")}</p>
    <details><summary>View matched conditions and SEC evidence</summary>
      <p>Form 425 · {e.accession} · Filed {formatTimestamp(e.filedAt)}</p>
      <p>{e.transactionTypes.map(t=>transactionLabels[t as keyof typeof transactionLabels]??t).join(" · ")}</p>
      {e.terms.map((t,i)=><p key={i}>{t}</p>)}
      <ul>{e.conditions.map((c,i)=><li key={i}>{c.key.replace("sec425.","").replaceAll("_"," ")} · {String(c.value).replaceAll("_"," ")}</li>)}</ul>
      {e.quotes.map((q,i)=><blockquote key={i}>{q.sourceQuote}</blockquote>)}
      <p>Matched {formatTimestamp(e.evaluatedAt)}. Evidence recorded at matching time.</p>
      <a href={e.sourceUrl} target="_blank" rel="noreferrer">SEC original filing</a>
    </details></div>;}
  const evidence = display?.evidence;
  if (!evidence) return <>
    <strong>Alert delivered</strong>
    <span>{formatTimestamp(createdAt)}</span>
    <span>{display?.status === "invalid" ? "Saved evidence unavailable" : "Match evidence was not preserved for this alert"}</span>
  </>;
  if (evidence.family === "section16_holdings") return <>
    <strong>{evidence.target.companyName} · {evidence.target.ticker}</strong>
    <span>Form {evidence.filingForm} · Reported non-derivative holding</span>
    <span>Reported in this filing; not a purchase, holding change, or current account balance.</span>
    <span>Selected issuer CIK {evidence.issuerCik} · Accession {evidence.accessionNumber}</span>
    <span>SEC {evidence.filingTime.precision === "second" ? "accepted" : "filing date"}: {evidence.filingTime.rawAcceptedAt ?? evidence.filingTime.rawFilingDate} · {evidence.filingTime.timeZone}</span>
    <span>Period of report: {evidence.periodOfReport ?? "Not stated"} · Monitor active since {formatTimestamp(evidence.monitorCreatedAt)}</span>
    <p>Saved condition: {reportedHoldingsConditionText(evidence.settings)}</p>
    <div aria-label="Matched reported holding rows">{evidence.matches.map(m => <div key={m.rowOrdinal}>
      <strong>Holding row {m.rowOrdinal + 1}: {m.securityTitle.rawValue} · {m.amountOwned.rawValue} shares</strong>
      <p>Direct/indirect: {m.directOrIndirect.rawValue ?? m.directOrIndirect.status} · Nature of ownership: {m.natureOfOwnership.rawValue ?? m.natureOfOwnership.status}</p>
      {m.footnotes.map(f => <p key={f.id}>Footnote {f.id}: {f.text}</p>)}
      <span>XML path: {m.xmlPath}</span>
    </div>)}</div>
    <span>Match-time evidence preserved · Matched {formatTimestamp(evidence.evaluatedAt)}</span>
    <a href={evidence.sourceUrl} target="_blank" rel="noreferrer">SEC original filing</a>
  </>;
  return <>
    <strong>{evidence.companyName ?? "Company unconfirmed"} · {evidence.ticker ?? "Ticker unconfirmed"}</strong>
    <span>Form {evidence.filingForm} · Proposed sale notice</span>
    <span>Proposed sale only; not an executed sale or sale proceeds.</span>
    <span>Filed: {evidence.filedAt ? formatTimestamp(evidence.filedAt) : "Unconfirmed"}</span>
    <span>Accession: {evidence.accessionNumber} · Filing row {evidence.rowIndex + 1}</span>
    <div aria-label="Matched facts and saved conditions">
      {evidence.conditions.map((condition, index) => <p key={`${condition.key}-${index}`}>
        <b>{condition.label}</b>: {condition.factStatus === "stored" ? formatSecondaryMonitorValue(condition.key, condition.fact) : "Fact not preserved"}
        {" · Saved condition: "}{MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[condition.operator]} {formatSecondaryMonitorValue(condition.key, condition.expected)}
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
