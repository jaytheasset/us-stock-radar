import { createHash } from "node:crypto";
import { parseNtFiling } from "../sources/sec/forms/nt/parser.ts";
import { normalizePeriodicReportingPeriod } from "../secStores/periodicParentPeriod.ts";

export const NT_LIFECYCLE_VERSION = "nt_lifecycle_v1.2";
export const NT_LIFECYCLE_ANALYZER = "nt_lifecycle";
export const NT_FORMS = ["NT 10-K", "NT 10-Q", "NT 20-F", "NT 10-K/A", "NT 10-Q/A", "NT 20-F/A"];
export const NT_REPORT_FORMS = ["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"];
type Raw = Record<string, unknown>;
export type NtSource = {
  rawItemId: string; accession: string; issuerCik: string; form: string;
  filedDate: string; reportForm: string; reportPeriod: string | null;
  sourceUrl: string; sourceHash: string; periodEvidence: string[];
  notice: boolean; amendment: boolean; linkEligible: boolean; issues: string[];
};
export type NtLifecycleFacts = {
  version: typeof NT_LIFECYCLE_VERSION; gptDependency: false;
  source: NtSource;
  noticeFiled: true | null;
  reportFiled: true | null;
  followUp: { status: "linked" | "unresolved"; reason: string; notice: NtSource | null; report: NtSource | null };
};

/** Direct filing facts only. Never reads Primary prose, Part IV answers, or extensionDays. */
export function readNtLifecycleSource(raw: Raw): NtSource {
  const p = object(raw.raw_payload), m = object(raw.metadata);
  const accession = text(p.accession_number);
  const form = text(p.form_type).toUpperCase().replace(/\s+/g, " ");
  const ciks = [p.cik, p.issuer_cik, m.cik].filter(v => v !== undefined && v !== null && v !== "")
    .map(v => /^\d{1,10}$/.test(String(v)) ? String(v).padStart(10, "0") : "invalid");
  const dates = [p.filing_date, p.filed_date].filter(v => v !== undefined && v !== null && v !== "").map(calendarDate);
  const filedDate = dates.length ? dates[0] : calendarDate(text(raw.published_at).slice(0, 10));
  const sourceUrl = text(p.primary_document_url) || text(raw.source_url);
  let url: URL; try { url = new URL(sourceUrl); } catch { throw new Error("nt_source_url_invalid"); }
  if (raw.source_code !== "sec_edgar" || !text(raw.id) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
    || text(raw.source_unique_id) !== accession || !ciks.length || new Set(ciks).size !== 1 || ciks[0] === "invalid"
    || !filedDate || dates.some(v => !v || v !== filedDate)
    || ![...NT_FORMS, ...NT_REPORT_FORMS].includes(form)
    || url.protocol !== "https:" || !["www.sec.gov", "sec.gov"].includes(url.hostname)
    || !url.pathname.includes(accession.replaceAll("-", ""))) throw new Error("nt_source_identity_invalid");
  const primary = text(p.primary_document_html) || text(p.primary_document_text) || text(raw.body_text);
  if (!primary) throw new Error("nt_source_missing");
  const notice = NT_FORMS.includes(form), amendment = form.endsWith("/A");
  const reportForm = form.replace(/^NT /, "").replace(/\/A$/, "");
  const periodEvidence: string[] = [];
  const periodValues: string[] = [];
  const issues: string[] = [];
  for (const key of ["period_of_report", "reporting_period", "document_period_end_date"]) {
    if (!text(p[key])) continue;
    const value = normalizePeriodicReportingPeriod(p[key]);
    if (!value) issues.push("invalid_report_period"); else periodValues.push(value);
    periodEvidence.push(`${key}: ${text(p[key])}`);
  }
  if (notice) {
    // Do not supply a guessed period to the parser: require its source-local evidence.
    const parsed = parseNtFiling({ formType: form, filingText: primary, primaryDocumentText: primary,
      accessionNumber: accession, filedAt: filedDate });
    const f = parsed.facts;
    if (!parsed.isSupported) throw new Error("nt_notice_body_unavailable");
    if (f.periodOfReportEvidence && f.periodOfReport) {
      const date = normalizePeriodicReportingPeriod(f.periodOfReport);
      if (date) periodValues.push(date);
      periodEvidence.push(f.periodOfReportEvidence);
    }
    if (f.targetReportCheckboxGroup.ambiguous || f.submissionBodyFormMismatch
      || f.delayedReport !== reportForm) issues.push("ambiguous_report_kind");
    if (f.isTransitionReport) issues.push("transition_period_not_supported");
    if (f.amendmentPartialBody) issues.push("partial_amendment");
  } else {
    // Reuse the existing ingestion parser's DEI observations (including rendered month-name dates).
    for (const value of Array.isArray(p.periodic_report_core_xbrl_facts) ? p.periodic_report_core_xbrl_facts : []) {
      const fact = object(value);
      if (!/^(?:dei:)?DocumentPeriodEndDate$/i.test(text(fact.name)) || fact.hasDimensions === true) continue;
      const date = normalizePeriodicReportingPeriod(fact.value);
      if (date) periodValues.push(date); else issues.push("invalid_report_period");
      periodEvidence.push(JSON.stringify({ name: fact.name, value: fact.value, contextRef: fact.contextRef, sourceDocument: fact.sourceDocument }));
    }
    // Explicit DEI field only; never infer a period from a filename or narrative date.
    const pattern = /<(?:[\w.-]+:)?(?:nonNumeric|DocumentPeriodEndDate)\b[^>]*(?:name\s*=\s*["'](?:\w+:)?DocumentPeriodEndDate["'][^>]*)?>\s*(\d{4}-\d{2}-\d{2})\s*<\//gi;
    for (const match of primary.matchAll(pattern)) {
      if (!/DocumentPeriodEndDate/i.test(match[0])) continue;
      const value = calendarDate(match[1]);
      if (value) periodValues.push(value); else issues.push("invalid_report_period");
      periodEvidence.push(match[0]);
    }
  }
  const periods = [...new Set(periodValues)];
  if (periods.length !== 1) issues.push(periods.length ? "conflicting_report_period" : "report_period_unavailable");
  if (amendment) issues.push("amendment_link_unresolved");
  return { rawItemId: text(raw.id), accession, issuerCik: ciks[0], form, filedDate, reportForm,
    reportPeriod: periods.length === 1 ? periods[0] : null, sourceUrl,
    sourceHash: createHash("sha256").update(JSON.stringify({ accession, cik: ciks[0], form, filedDate, primary,
      periodEvidence })).digest("hex"), periodEvidence: [...new Set(periodEvidence)].sort(), notice, amendment,
    linkEligible: issues.length === 0, issues };
}

/** A missing local counterpart is unknown, never a negative assertion about SEC submission. */
export function buildNtLifecycleFacts(source: NtSource, candidates: readonly NtSource[]): NtLifecycleFacts {
  const byAccession = new Map<string, NtSource>();
  let conflictingAccession = false;
  for (const item of [source, ...candidates].filter(s => s.issuerCik === source.issuerCik)) {
    const prior = byAccession.get(item.accession);
    if (prior && JSON.stringify(prior) !== JSON.stringify(item)) conflictingAccession = true;
    else byAccession.set(item.accession, item);
  }
  const same = [...byAccession.values()];
  const relevant = same.filter(s => s.reportForm === source.reportForm && s.reportPeriod === source.reportPeriod);
  const uncertain = same.some(s => s.reportForm === source.reportForm
    && (!s.reportPeriod || (s.reportPeriod === source.reportPeriod && !s.linkEligible)));
  const notices = relevant.filter(s => s.notice), reports = relevant.filter(s => !s.notice);
  let reason = "counterpart_not_observed_locally";
  let notice: NtSource | null = null, report: NtSource | null = null;
  if (conflictingAccession) reason = "conflicting_accession_evidence";
  else if (!source.linkEligible) reason = source.issues.join(",");
  else if (uncertain) reason = "ambiguous_or_amended_candidate";
  else if (notices.length > 1 || reports.length > 1) reason = "multiple_counterparts";
  else if (notices.length === 1 && reports.length === 1) {
    if (notices[0].filedDate < reports[0].filedDate) { notice = notices[0]; report = reports[0]; reason = "exact_issuer_form_period_order"; }
    else reason = "filing_order_not_established";
  }
  return { version: NT_LIFECYCLE_VERSION, gptDependency: false, source,
    // Notification facts belong to their own filing event. The notice still exposes
    // its linked follow-up, but must not emit the report's notification a second time.
    noticeFiled: source.notice ? true : null, reportFiled: report && !source.notice ? true : null,
    followUp: { status: report ? "linked" : "unresolved", reason, notice, report } };
}

export function calendarDate(v: unknown): string {
  const s = text(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s ? s : "";
}
export function text(v: unknown) { return typeof v === "string" ? v.trim() : ""; }
export function object(v: unknown): Raw { return v && typeof v === "object" && !Array.isArray(v) ? v as Raw : {}; }
