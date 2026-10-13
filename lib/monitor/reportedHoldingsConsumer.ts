import { readSection16FilingByAccession } from "../sec-section16-xml/persistence.ts";
import { readSection16MonitorFacts } from "./section16MonitorFacts.ts";
import { evaluateSection16MonitorConditions } from "../section16MonitorMatcher.ts";
import { readFinancialMonitorTarget } from "./financialMonitorTargetReader.ts";
import { listReportedHoldingsMonitors } from "./reportedHoldingsPersistence.ts";
import { reportedHoldingsConditions, type ReportedHoldingsMonitor } from "./reportedHoldings.ts";
import { readReportedHoldingsFilingTime, reportedHoldingsWasActive } from "./reportedHoldingsTime.ts";
import { reportedHoldingsEvidenceSchema, type ReportedHoldingsEvidence, type ReportedHoldingsAlert } from "./reportedHoldingsEvidence.ts";
import type { Section16XmlField } from "../sources/sec/forms/section16Xml/parser.ts";

type Dependencies = {
  readCanonical: typeof readSection16FilingByAccession; readFacts: typeof readSection16MonitorFacts;
  listMonitors: typeof listReportedHoldingsMonitors; readTarget: typeof readFinancialMonitorTarget;
  write: typeof writeReportedHoldingsAlert; now(): Date;
};
const defaults: Dependencies = { readCanonical: readSection16FilingByAccession, readFacts: readSection16MonitorFacts, listMonitors: listReportedHoldingsMonitors, readTarget: readFinancialMonitorTarget, write: writeReportedHoldingsAlert, now: () => new Date() };

/** Called only after canonical XML insertion or exact replay. No Primary or provider. */
export async function consumeReportedHoldings(input: { rawItemId: string; accessionNumber: string; sourceSha256: string }, dependencies: Dependencies = defaults) {
  const canonical = await dependencies.readCanonical(input.accessionNumber);
  if (canonical.status !== "available" || canonical.filing.raw_item_id !== input.rawItemId || canonical.filing.source_sha256 !== input.sourceSha256) return { status: "not_ready", reason: "canonical_identity_unavailable", createdCount: 0 };
  if (canonical.parsed.formType !== "3" && canonical.parsed.formType !== "5") return { status: "not_applicable", reason: "amendments_preserved_manual_only", createdCount: 0 };
  if (canonical.parsed.filing.noSecuritiesOwned.value === true) return { status: "not_applicable", reason: "no_securities_owned", createdCount: 0 };
  const facts = await dependencies.readFacts(input.accessionNumber);
  if (facts.status !== "available" || facts.sourceSha256 !== input.sourceSha256 || facts.issuerCik !== canonical.filing.issuer_cik) return { status: "not_ready", reason: "official_facts_unavailable", createdCount: 0 };
  const filingTime = readReportedHoldingsFilingTime(canonical.filing.accepted_at_raw, canonical.filing.filing_date_raw);
  const { monitors, invalidIds } = await dependencies.listMonitors();
  const targetReads = new Map<string, ReturnType<Dependencies["readTarget"]>>();
  const evaluations: { monitorId: string; status: string; reason: string }[] = [];
  const writes: { monitorId: string; status: "created" | "existing" | "failed"; alertId?: string }[] = [];
  for (const monitor of monitors) {
    let reason = !monitor.isActive ? "inactive" : monitor.target.issuerCik !== facts.issuerCik ? "issuer_mismatch"
      : monitor.settings.form !== facts.formType ? "form_mismatch"
      : !reportedHoldingsWasActive(monitor.createdAt, filingTime) ? "monitor_activation_not_met" : "";
    if (reason) { evaluations.push({ monitorId: monitor.id, status: "ineligible", reason }); continue; }
    const matched = evaluateSection16MonitorConditions(facts, reportedHoldingsConditions(monitor.settings), "holding");
    if (matched.status !== "match" || !matched.evidence) { evaluations.push({ monitorId: monitor.id, status: matched.status, reason: matched.reasonCode }); continue; }
    if (!targetReads.has(monitor.target.ticker)) targetReads.set(monitor.target.ticker, dependencies.readTarget(monitor.target.ticker).catch(() => ({ status: "unavailable" as const })));
    const current = await targetReads.get(monitor.target.ticker)!;
    if (current.status !== "available" || current.target.issuerCik !== facts.issuerCik || current.target.ticker !== monitor.target.ticker) { evaluations.push({ monitorId: monitor.id, status: "ineligible", reason: "target_unconfirmed" }); continue; }
    try {
      const evidence = reportedHoldingsEvidenceSchema.parse({
        version: "reported_holdings_evidence_v1", family: "section16_holdings", rawItemId: input.rawItemId,
        accessionNumber: facts.accessionNumber, issuerCik: facts.issuerCik, filingForm: facts.formType,
        sourceSha256: facts.sourceSha256, sourceUrl: canonical.parsed.source.url, parserVersion: canonical.parsed.parserVersion,
        target: monitor.target, confirmedTarget: current.target, settings: monitor.settings,
        monitorCreatedAt: monitor.createdAt, evaluatedAt: dependencies.now().toISOString(), filingTime,
        periodOfReport: canonical.parsed.filing.periodOfReport.rawValue,
        matches: matched.evidence.matchedRows.map(({ rowOrdinal }) => {
          const row = canonical.parsed.holdings[rowOrdinal];
          if (!row || row.rowKind !== "non_derivative") throw new Error("holding_row_identity_invalid");
          const ids = new Set([...row.footnoteIds, ...row.securityTitle.footnoteIds, ...row.amountOwned.footnoteIds, ...row.directOrIndirectOwnership.footnoteIds, ...row.natureOfOwnership.footnoteIds]);
          return { rowOrdinal, xmlPath: row.xmlPath, securityTitle: copy(row.securityTitle), amountOwned: copy(row.amountOwned), directOrIndirect: copy(row.directOrIndirectOwnership), natureOfOwnership: copy(row.natureOfOwnership), footnotes: canonical.parsed.footnotes.filter(f => ids.has(f.id)).map(f => ({ id: f.id, text: f.text })) };
        }),
      });
      writes.push({ monitorId: monitor.id, ...await dependencies.write(monitor, evidence) });
      evaluations.push({ monitorId: monitor.id, status: "match", reason: "same_holding_row" });
    } catch { writes.push({ monitorId: monitor.id, status: "failed" }); }
  }
  return { status: writes.some(w => w.status === "failed") ? "partial_failure" : "completed", accessionNumber: input.accessionNumber, filingTime, invalidIds, evaluations, writes, createdCount: writes.filter(w => w.status === "created").length, existingCount: writes.filter(w => w.status === "existing").length, failedCount: writes.filter(w => w.status === "failed").length };
}
function copy(f: Section16XmlField) { return { xmlPath: f.xmlPath, status: f.status, rawValue: f.rawValue, footnoteIds: f.footnoteIds }; }
async function writeReportedHoldingsAlert(monitor: ReportedHoldingsMonitor, evidence: ReportedHoldingsEvidence): Promise<{ status: "created" | "existing"; alertId?: string }> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("user_alert_deliveries", {
    user_id: monitor.userId, alert_event_id: null, ticker: null, title: "Reported holding matched", category: "insider_ownership", source_type: "other", source_label: "Form 3/5 Reported Holdings", alert_lane: "reported_holdings", alert_domain: "reported_holdings", delivered_channels: [], delivery_status: "queued", delivered_at: evidence.evaluatedAt,
    reported_holding_monitor_id: monitor.id, reported_holding_accession: evidence.accessionNumber, reported_holding_evidence: evidence,
  }, { onConflict: "reported_holding_monitor_id,reported_holding_accession", prefer: "resolution=ignore-duplicates,return=representation" });
  if (!result.ok) throw new Error("reported_holding_alert_write_failed");
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return row ? { status: "created", alertId: String(row.id) } : { status: "existing" };
}
export async function listReportedHoldingsAlerts(ownerId: string): Promise<ReportedHoldingsAlert[]> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseSelect("user_alert_deliveries", { select: "id,reported_holding_monitor_id,reported_holding_accession,reported_holding_evidence,created_at", user_id: `eq.${ownerId}`, alert_lane: "eq.reported_holdings", order: "created_at.desc,id.desc", limit: "100" });
  if (!result.ok || !Array.isArray(result.data)) throw new Error("reported_holding_alert_read_failed");
  return result.data.map(row => {
    const parsed = reportedHoldingsEvidenceSchema.safeParse(row.reported_holding_evidence);
    const valid = parsed.success && parsed.data.accessionNumber === row.reported_holding_accession;
    return { id: row.id, monitorId: row.reported_holding_monitor_id, createdAt: row.created_at, display: { status: valid ? "stored" : "invalid", evidence: valid ? parsed.data : null } };
  });
}
