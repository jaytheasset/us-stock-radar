import { validateCanonicalSc13Conditions, validateSc13MonitorTarget, type Sc13MonitorTarget } from "./sc13MonitorPersistence.ts";
import type { Sc13MonitorAlertItem } from "./sc13MonitorAlertConsumer.ts";
import type { StockSc13OwnershipSnapshot } from "../watchlist/stockSc13Ownership.ts";

export const SC13_FIELDS = [
  { key: "sc13.aggregate_owned", label: "Aggregate shares owned" },
  { key: "sc13.percent_of_class", label: "Percent of class (%)" },
  { key: "sc13.sole_voting", label: "Sole voting power" },
  { key: "sc13.shared_voting", label: "Shared voting power" },
  { key: "sc13.sole_dispositive", label: "Sole dispositive power" },
  { key: "sc13.shared_dispositive", label: "Shared dispositive power" },
] as const;
export const SC13_OPERATORS = [
  { value: "gte", label: "At least" }, { value: "gt", label: "More than" },
  { value: "eq", label: "Equal to" }, { value: "lte", label: "At most" },
  { value: "lt", label: "Less than" },
] as const;
export const SC13_MEANING = "Latest reported values in complete stored filing history; not real-time ownership or a complete SEC-wide history. All conditions apply to the same reporting person and security.";
export type Sc13TargetChoice = Readonly<{ id: string; name: string; issuerName: string | null; target: Sc13MonitorTarget }>;
export type Sc13AlertSource = Readonly<{ accessionNumber: string; issuerName: string | null; sourceUrl: string; formType: string; eventDate: string; filedAt: string | null }>;
export type Sc13DisplayAlert = Sc13MonitorAlertItem & Readonly<{ sources: readonly Sc13AlertSource[] }>;

export function sc13TargetChoices(snapshot: StockSc13OwnershipSnapshot): readonly Sc13TargetChoice[] {
  if (snapshot.status !== "available" || !snapshot.historyComplete) return [];
  const choices = snapshot.positions.flatMap((position) => position.status !== "available_stored_history" ? [] : position.currentReporters.flatMap((reporter) => {
    const parsed = validateSc13MonitorTarget({ issuerCik: snapshot.issuerCik, reportingPersonCik: reporter.reportingPersonCik, securityClass: position.securityClass, cusips: position.cusips });
    if (!parsed.ok || !parsed.target) return [];
    const target = parsed.target;
    return [{ id: JSON.stringify(target), name: reporter.reportingPersonName, issuerName: position.issuerName ?? null, target }];
  }));
  // Multiple positions for one identity are ambiguous to the Matcher too.
  return choices.filter((choice) => choices.filter((other) => other.id === choice.id).length === 1);
}

export function sc13ConditionText(condition: { key: string; operator: string; value?: string; threshold?: string }) {
  return `${SC13_FIELDS.find((field) => field.key === condition.key)?.label ?? condition.key} ${SC13_OPERATORS.find((operator) => operator.value === condition.operator)?.label.toLowerCase() ?? condition.operator} ${condition.value ?? condition.threshold ?? ""}`;
}

/** Display only internally consistent immutable match evidence; never repair it. */
export function isSc13AlertEvidenceConsistent(alert: Sc13MonitorAlertItem): boolean {
  const evidence = alert.evidence;
  if (!evidence || evidence.scope !== "complete_stored_history_not_sec_global" || evidence.meaning !== "latest_saved_filing_value_not_realtime_ownership") return false;
  const parsed = validateSc13MonitorTarget({ issuerCik: evidence.issuerCik, reportingPersonCik: evidence.reportingPersonCik, securityClass: evidence.securityClass, cusips: evidence.cusips });
  if (!parsed.ok || !parsed.target || typeof evidence.reportingPersonNameRaw !== "string" || typeof evidence.positionKey !== "string" || !evidence.positionKey) return false;
  if (parsed.target.issuerCik !== evidence.issuerCik || parsed.target.reportingPersonCik !== evidence.reportingPersonCik || parsed.target.securityClass !== evidence.securityClass || JSON.stringify(parsed.target.cusips) !== JSON.stringify(evidence.cusips)) return false;
  if (!/^\d{10}-\d{2}-\d{6}$/.test(evidence.rootAccessionNumber) || !/^\d{10}-\d{2}-\d{6}$/.test(evidence.headAccessionNumber)) return false;
  if (alert.rootAccessionNumber !== evidence.rootAccessionNumber || alert.headAccessionNumber !== evidence.headAccessionNumber || alert.reportingPersonCik !== evidence.reportingPersonCik || alert.securityClass !== evidence.securityClass || JSON.stringify(alert.cusips) !== JSON.stringify(evidence.cusips)) return false;
  if (!Array.isArray(evidence.conditions) || !evidence.conditions.length || evidence.conditions.some((condition) => !condition || typeof condition !== "object")) return false;
  return validateCanonicalSc13Conditions(evidence.conditions.map((condition) => ({ key: condition.key, operator: condition.operator, value: condition.threshold }))).ok
    && evidence.conditions.every((condition) => condition.sourceAccessionNumber === evidence.headAccessionNumber && validateCanonicalSc13Conditions([{ key: condition.key, operator: condition.operator, value: condition.valueRaw }]).ok);
}

export function safeSc13SourceUrl(value: unknown, accession: string): string | null {
  if (typeof value !== "string" || !/^https:\/\/(?:www\.)?sec\.gov\//i.test(value) || value.includes("?") || value.includes("#")) return null;
  try {
    const url = new URL(value);
    const expectedPath = /^\d{10}-\d{2}-\d{6}$/.test(accession) && new RegExp(`^/Archives/edgar/data/[0-9]+/${accession.replaceAll("-", "")}/[A-Za-z0-9_.-]+$`).test(url.pathname);
    return url.protocol === "https:" && /^(?:www\.)?sec\.gov$/i.test(url.hostname) && !url.username && !url.password && !url.port && !url.search && !url.hash && expectedPath ? url.href : null;
  } catch { return null; }
}
