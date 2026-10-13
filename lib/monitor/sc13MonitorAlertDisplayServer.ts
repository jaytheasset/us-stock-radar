import "server-only";
import { readSc13FilingByAccession } from "../sec-sc13-xml/persistence.ts";
import type { Sc13MonitorAlertItem } from "./sc13MonitorAlertConsumer.ts";
import { isSc13AlertEvidenceConsistent, safeSc13SourceUrl, type Sc13DisplayAlert, type Sc13AlertSource } from "./sc13MonitorDisplay.ts";
import { normalizeSc13Cusips, normalizeSc13SecurityClass } from "./sc13MonitorPersistence.ts";

export async function buildSc13AlertDisplay(alerts: readonly Sc13MonitorAlertItem[], readFiling = readSc13FilingByAccession): Promise<readonly Sc13DisplayAlert[]> {
  const valid = alerts.filter(isSc13AlertEvidenceConsistent);
  const sources = new Map<string, { issuerCik: unknown; sourceSha256: unknown; securityClass: string; cusips: string[] | null; reporters: readonly Record<string, unknown>[]; source: Sc13AlertSource }>();
  const accessions = [...new Set(valid.map((alert) => alert.headAccessionNumber))];
  for (let offset = 0; offset < accessions.length; offset += 5) {
    await Promise.all(accessions.slice(offset, offset + 5).map(async (accession) => {
      try {
        const read = await readFiling(accession);
        if (read.status !== "available" || read.filing.accession_number !== accession) return;
        const url = safeSc13SourceUrl(read.filing.source_url, accession);
        if (!url || typeof read.filing.form_type_raw !== "string" || typeof read.filing.event_date !== "string") return;
        const reporters = read.reporters.map((reporter) => read.verifiedReporterIdentity?.reportingPersonIndex === Number(reporter.reporting_person_index) && !reporter.reporting_person_cik
          ? { ...reporter, reporting_person_cik: read.verifiedReporterIdentity.reportingPersonCik } : reporter);
        sources.set(accession, { issuerCik: read.filing.issuer_cik, sourceSha256: read.filing.source_sha256, securityClass: normalizeSc13SecurityClass(read.filing.security_class_raw), cusips: normalizeSc13Cusips(read.filing.cusips_raw), reporters, source: { accessionNumber: accession, issuerName: typeof read.filing.issuer_name_raw === "string" ? read.filing.issuer_name_raw : null, sourceUrl: url, formType: read.filing.form_type_raw, eventDate: read.filing.event_date, filedAt: typeof read.filing.filed_at === "string" ? read.filing.filed_at : null } });
      } catch { /* Immutable evidence remains visible when source metadata cannot be read. */ }
    }));
  }
  return valid.map((alert) => {
    const source = sources.get(alert.headAccessionNumber);
    const evidence = alert.evidence;
    const reporters = source?.reporters.filter((reporter) => evidence.reporterScope === "all"
      ? reporter.reporting_person_index === evidence.reportingPersonIndex && (reporter.reporting_person_cik ?? null) === evidence.reportingPersonCik && reporter.reporting_person_name_raw === evidence.reportingPersonNameRaw
      : reporter.reporting_person_cik === evidence.reportingPersonCik) ?? [];
    const matches = source?.issuerCik === alert.evidence.issuerCik && source.securityClass === alert.securityClass
      && JSON.stringify(source.cusips) === JSON.stringify(alert.cusips) && reporters.length === 1
      && (evidence.reporterScope !== "all" || source.sourceSha256 === evidence.sourceSha256);
    return { ...alert, sources: matches && source ? [source.source] : [] };
  });
}
