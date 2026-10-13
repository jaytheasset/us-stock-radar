import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isSc13AlertEvidenceConsistent, safeSc13SourceUrl, sc13TargetChoices, sc13ConditionText } from "./sc13MonitorDisplay.ts";
import type { Sc13MonitorAlertItem } from "./sc13MonitorAlertConsumer.ts";
import type { StockSc13OwnershipSnapshot } from "../watchlist/stockSc13Ownership.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
  if (specifier.startsWith("@/")) {
    const base = new URL(`../../${specifier.slice(2)}`, import.meta.url);
    const file = new URL(`${base.href}.ts`);
    return nextResolve(existsSync(fileURLToPath(file)) ? file.href : new URL(`${base.href}/index.ts`).href, context);
  }
  return nextResolve(specifier, context);
} });
const { buildSc13AlertDisplay } = await import("./sc13MonitorAlertDisplayServer.ts");
const accession = "0000947871-26-000814";
const alert: Sc13MonitorAlertItem = {
  id: "98000000-0000-4000-8000-000000000001", monitorId: "98000000-0000-4000-8000-000000000002",
  rootAccessionNumber: accession, headAccessionNumber: accession, reportingPersonCik: "0001055951", securityClass: "COMMON STOCK", cusips: ["10567X101"], createdAt: "2026-10-14T00:00:00Z",
  evidence: { scope: "complete_stored_history_not_sec_global", meaning: "latest_saved_filing_value_not_realtime_ownership", positionKey: "position", rootAccessionNumber: accession, headAccessionNumber: accession, issuerCik: "0002131524", reportingPersonCik: "0001055951", reportingPersonNameRaw: "Reporting person", securityClass: "COMMON STOCK", cusips: ["10567X101"], conditions: [{ key: "sc13.aggregate_owned", operator: "gte", threshold: "9007199254740993.01", valueRaw: "9007199254740993.010", sourceAccessionNumber: accession }] },
};

test("display preserves exact decimal strings and rejects cross-identity or malformed evidence", () => {
  assert.equal(isSc13AlertEvidenceConsistent(alert), true);
  assert.match(sc13ConditionText(alert.evidence.conditions[0]!), /9007199254740993\.01$/);
  for (const patch of [{ reportingPersonCik: "0000000001" }, { headAccessionNumber: "0000947871-26-000815" }, { securityClass: "OTHER" }, { cusips: ["123456789"] }]) assert.equal(isSc13AlertEvidenceConsistent({ ...alert, ...patch }), false);
  for (const patch of [{ conditions: [null] }, { conditions: [{ ...alert.evidence.conditions[0], valueRaw: 0 }] }, { issuerCik: "2131524" }, { conditions: [{ ...alert.evidence.conditions[0], sourceAccessionNumber: "0000947871-26-000815" }] }]) assert.equal(isSc13AlertEvidenceConsistent({ ...alert, evidence: { ...alert.evidence, ...patch } } as Sc13MonitorAlertItem), false);
});

test("stored targets omit missing CIK, unresolved and duplicate identities without choosing a default", () => {
  const position = { status: "available_stored_history", securityClass: "Common Stock", cusips: ["10567X101"], currentReporters: [{ reportingPersonCik: "0001055951", reportingPersonName: "Reporting person" }] };
  const snapshot = { status: "available", historyComplete: true, issuerCik: "0002131524", positions: [position] } as unknown as StockSc13OwnershipSnapshot;
  assert.equal(sc13TargetChoices(snapshot).length, 1);
  assert.equal(sc13TargetChoices({ ...snapshot, positions: [position, position] } as unknown as StockSc13OwnershipSnapshot).length, 0);
  assert.equal(sc13TargetChoices({ ...snapshot, positions: [{ ...position, currentReporters: [{ reportingPersonCik: "", reportingPersonName: "Missing" }] }] } as unknown as StockSc13OwnershipSnapshot).length, 0);
  assert.equal(sc13TargetChoices({ ...snapshot, positions: [{ ...position, status: "unresolved" }] } as unknown as StockSc13OwnershipSnapshot).length, 0);
});

test("source URLs are only safe SEC archive URLs", () => {
  assert.equal(safeSc13SourceUrl("https://www.sec.gov/Archives/edgar/data/1/000094787126000814/filing.xml", accession), "https://www.sec.gov/Archives/edgar/data/1/000094787126000814/filing.xml");
  for (const value of ["javascript:alert(1)", "https://sec.gov.evil.test/Archives/edgar/data/1/x", "http://sec.gov/Archives/edgar/data/1/x", "https://user@sec.gov/Archives/edgar/data/1/x", "https://sec.gov/other"]) assert.equal(safeSc13SourceUrl(value, accession), null);
  for (const suffix of ["?download=1", "#fragment"]) assert.equal(safeSc13SourceUrl(`https://www.sec.gov/Archives/edgar/data/1/000094787126000814/filing.xml${suffix}`, accession), null);
  assert.equal(safeSc13SourceUrl("https://www.sec.gov/Archives/edgar/data/1/000094787126000815/filing.xml", accession), null);
  assert.equal(safeSc13SourceUrl("https://www.sec.gov:8443/Archives/edgar/data/1/000094787126000814/filing.xml", accession), null);
  assert.equal(safeSc13SourceUrl("https://www.sec.gov:443/Archives/edgar/data/1/000094787126000814/filing.xml", accession), null);
});

test("source enrichment requires canonical issuer, reporter, class and CUSIP; never changes evidence", async () => {
  const validRead = { status: "available", filing: { accession_number: accession, issuer_cik: alert.evidence.issuerCik, security_class_raw: "Common Stock", cusips_raw: ["10567X101"], source_url: "https://www.sec.gov/Archives/edgar/data/1/000094787126000814/filing.xml", form_type_raw: "SCHEDULE 13D", event_date: "2026-07-10" }, reporters: [{ reporting_person_cik: alert.reportingPersonCik }], structural: {} };
  const reader = async () => validRead as unknown as Awaited<ReturnType<typeof import("../sec-sc13-xml/persistence.ts").readSc13FilingByAccession>>;
  const result = await buildSc13AlertDisplay([alert], reader);
  assert.equal(result[0]?.sources.length, 1);
  assert.equal(result[0]?.evidence, alert.evidence);
  for (const patch of [{ issuer_cik: "0000000001" }, { security_class_raw: "Other" }, { cusips_raw: ["123456789"] }, { accession_number: "0000947871-26-000815" }]) {
    const mismatch = await buildSc13AlertDisplay([alert], async () => ({ ...await reader(), filing: { ...validRead.filing, ...patch } }) as Awaited<ReturnType<typeof reader>>);
    assert.equal(mismatch[0]?.sources.length, 0);
  }
  const differentReporter = await buildSc13AlertDisplay([alert], async () => ({ ...await reader(), reporters: [{ reporting_person_cik: "0000000001" }] }) as Awaited<ReturnType<typeof reader>>);
  assert.equal(differentReporter[0]?.sources.length, 0);
  const failedRead = await buildSc13AlertDisplay([alert], async () => { throw new Error("read unavailable"); });
  assert.equal(failedRead[0]?.evidence, alert.evidence);
  assert.equal(failedRead[0]?.sources.length, 0);
  assert.equal((await buildSc13AlertDisplay([{ ...alert, securityClass: "OTHER" }], reader)).length, 0);
});

