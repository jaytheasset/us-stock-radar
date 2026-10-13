import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reportedHoldingsCreateSchema, reportedHoldingsSettingsSchema, reportedHoldingsConditions, type ReportedHoldingsMonitor } from "./reportedHoldings.ts";
import { readReportedHoldingsFilingTime as time, reportedHoldingsWasActive as active } from "./reportedHoldingsTime.ts";
import { consumeReportedHoldings } from "./reportedHoldingsConsumer.ts";
import { reportedHoldingsEvidenceSchema, type ReportedHoldingsEvidence } from "./reportedHoldingsEvidence.ts";
import { buildSection16CanonicalPayload } from "../sec-section16-xml/canonical.ts";
import { readSection16FilingByAccession, type Section16CanonicalRepository } from "../sec-section16-xml/persistence.ts";
import { preserveSection16XmlSource } from "../sources/sec/forms/section16Xml/parser.ts";
import { readSection16MonitorFacts } from "./section16MonitorFacts.ts";
import { evaluateSection16MonitorConditions } from "../section16MonitorMatcher.ts";

const id = "75000000-0000-4000-8000-000000000001";
const fixture = JSON.parse(readFileSync(new URL("../sources/sec/forms/section16Xml/fixtures/lineage-sources.json", import.meta.url), "utf8")).fixtures[1];
const xml = readFileSync(new URL(`../sources/sec/forms/section16Xml/fixtures/${fixture.file}`, import.meta.url), "utf8");
const raw = { source_code: "sec_edgar", source_group: "filings", source_unique_id: fixture.accessionNumber, raw_payload: { form_type: "5", accession_number: fixture.accessionNumber, cik: fixture.issuerCik, ownership_issuer_cik: fixture.issuerCik, filing_date: fixture.filingDate, accepted_at: "2025-02-14 17:50:36", ...preserveSection16XmlSource({ formType: "5", text: xml, sourceUrl: fixture.sourceUrl, sha256: fixture.sha256 }) } };
const payload = buildSection16CanonicalPayload(id, raw)!;
assert(payload);
const repository: Section16CanonicalRepository = {
  rpc: async () => { throw Error("read only unit repository"); },
  select: async (table, query) => {
    if (table === "sec_section16_filings") return { ok: true, status: 200, count: 1, data: query.select === "accession_number" ? [{ accession_number: fixture.accessionNumber }] : [payload.filing] };
    const tables = { sec_section16_reporting_owners: payload.reportingOwners, sec_section16_transactions: payload.transactions, sec_section16_holdings: payload.holdings, sec_section16_footnotes: payload.footnotes, sec_section16_signatures: payload.signatures };
    const data = tables[table as keyof typeof tables] ?? [];
    return { ok: true, status: 200, data, count: data.length };
  },
};
const target = { version: "financial_monitor_target_v1" as const, scope: "issuer" as const, ticker: "SCL", issuerCik: fixture.issuerCik, companyName: "STEPAN CO", exchange: "NYSE", sourceRawId: id, refreshSequence: "1", contentHash: "a".repeat(64), confirmedAt: "2026-10-13T00:00:00Z", verifiedAt: "2026-10-13T00:00:00Z" };
const monitor: ReportedHoldingsMonitor = { id, userId: id, target, settings: { form: "5", securityTitle: "Common Stock", operator: "eq", amount: "0" }, isActive: true, createdAt: "2024-01-01T00:00:00Z" };
const input = { rawItemId: id, accessionNumber: fixture.accessionNumber, sourceSha256: fixture.sha256 };

test("public contract accepts only fixed Form 3/5 holding subset and rejects creation clock overrides", () => {
  for (const form of ["3", "5"]) assert(reportedHoldingsSettingsSchema.safeParse({ ...monitor.settings, form }).success);
  for (const patch of [{ form: "3/A" }, { form: "5/A" }, { form: "4" }, { operator: "neq" }, { amount: "-1" }, { amount: "1,000" }, { amount: 0 }, { rowKind: "derivative" }, { securityTitle: "" }]) assert(!reportedHoldingsSettingsSchema.safeParse({ ...monitor.settings, ...patch }).success);
  const selection = { ticker: "SCL", issuerCik: fixture.issuerCik, sourceRawId: id, refreshSequence: "1" };
  assert(reportedHoldingsCreateSchema.safeParse({ target: selection, settings: monitor.settings }).success);
  for (const patch of [{ createdAt: monitor.createdAt }, { historical: true }, { isActive: true }, { userId: id }]) assert(!reportedHoldingsCreateSchema.safeParse({ target: selection, settings: monitor.settings, ...patch }).success);
});
test("SEC acceptance is Eastern with DST; invalid, ambiguous and date-only ordering fail closed", () => {
  assert.equal(time("2025-02-14 17:50:36", null)?.instant, "2025-02-14T22:50:36.000Z");
  assert.equal(time("2026-08-04 17:04:45", null)?.instant, "2026-08-04T21:04:45.000Z");
  assert.equal(time("2025-02-14T17:50:36-05:00", null)?.instant, "2025-02-14T22:50:36.000Z");
  for (const bad of ["2025-02-30T00:00:00Z", "2025-01-01T24:00:00Z", "2025-11-02 01:30:00", "2025-03-09 02:30:00", "invalid"]) assert.equal(time(bad, "2025-01-01"), null);
  const exact = time("2025-02-14 17:50:36", null), day = time(null, "2025-02-14");
  assert(active("2025-02-14T22:50:35Z", exact)); assert(!active("2025-02-14T22:50:37Z", exact));
  assert(active("2025-02-14T04:59:59Z", day)); assert(!active("2025-02-14T05:00:00Z", day));
  assert(!active("2024-01-01T00:00:00Z", time(null, null)));
});
test("official canonical reader + unchanged Matcher + consumer preserve explicit zero and immutable source evidence", async () => {
  const writes: ReportedHoldingsEvidence[] = [];
  const dependencies = deps([monitor], async (_m, e) => { writes.push(e); return { status: "created" }; });
  const result = await consumeReportedHoldings(input, dependencies);
  assert.equal(result.createdCount, 1);
  const evidence = writes[0];
  assert.equal(evidence.sourceSha256, fixture.sha256); assert.equal(evidence.matches.length, 1);
  assert.equal(evidence.matches[0].amountOwned.rawValue, "0"); assert(evidence.matches[0].footnotes.some(f => f.id === "F4"));
  assert.equal(evidence.filingTime.instant, "2025-02-14T22:50:36.000Z");
  for (const patch of [{ issuerCik: "0000000001" }, { monitorCreatedAt: "2026-01-01T00:00:00Z" }, { settings: { ...monitor.settings, amount: "1" } }, { matches: [{ ...evidence.matches[0], amountOwned: { ...evidence.matches[0].amountOwned, rawValue: "garbage" } }] }]) assert(!reportedHoldingsEvidenceSchema.safeParse({ ...evidence, ...patch }).success);
});
test("consumer rejects pre-activation, wrong issuer/form/title, inactive, unknown identity and hash mismatch", async () => {
  const variants = [{ ...monitor, createdAt: "2026-10-14T00:00:00Z" }, { ...monitor, target: { ...target, issuerCik: "0000000001" } }, { ...monitor, settings: { ...monitor.settings, form: "3" as const } }, { ...monitor, settings: { ...monitor.settings, securityTitle: "Preferred Stock" } }, { ...monitor, isActive: false }];
  const result = await consumeReportedHoldings(input, deps(variants)); assert.equal(result.createdCount, 0);
  const unavailable = deps([monitor]); unavailable.readTarget = async () => ({ status: "unavailable" });
  assert.equal((await consumeReportedHoldings(input, unavailable)).createdCount, 0);
  assert.equal((await consumeReportedHoldings({ ...input, sourceSha256: "f".repeat(64) }, deps([monitor]))).createdCount, 0);
  for (const form of ["3/A", "5/A"] as const) {
    const d = deps([monitor]), original = await d.readCanonical(input.accessionNumber); assert(original.status === "available");
    d.readCanonical = async () => ({ ...original, parsed: { ...original.parsed, formType: form } });
    assert.equal((await consumeReportedHoldings(input, d)).createdCount, 0);
  }
  const d = deps([monitor]), original = await d.readCanonical(input.accessionNumber); assert(original.status === "available");
  d.readCanonical = async () => ({ ...original, parsed: { ...original.parsed, filing: { ...original.parsed.filing, noSecuritiesOwned: { ...original.parsed.filing.noSecuritiesOwned, value: true } } } });
  assert.equal((await consumeReportedHoldings(input, d)).reason, "no_securities_owned");
});
test("public same-row subset never joins titles and quantities or turns missing/footnote-only into zero", async () => {
  const facts = await readSection16MonitorFacts(fixture.accessionNumber, repository); assert(facts.status === "available");
  const row = facts.rows.find(r => r.rowFamily === "holding")!;
  const field = (status: "exact" | "missing" | "empty" | "footnote_only", value: string | null) => ({ xmlPath: "/unit-only", status, value, rawValue: value, footnoteIds: [] });
  const conditions = reportedHoldingsConditions(monitor.settings);
  for (const status of ["missing", "empty", "footnote_only"] as const) {
    assert.notEqual(evaluateSection16MonitorConditions({ ...facts, rows: [{ ...row, fields: { ...row.fields, amountOwned: field(status, null) } }] }, conditions, "holding").status, "match");
  }
  const rows = [{ ...row, fields: { ...row.fields, securityTitle: field("exact", "Common Stock"), amountOwned: field("exact", "100") } }, { ...row, rowOrdinal: 1, fields: { ...row.fields, securityTitle: field("exact", "Preferred Stock"), amountOwned: field("exact", "0") } }];
  assert.notEqual(evaluateSection16MonitorConditions({ ...facts, rows }, conditions, "holding").status, "match");
  assert.notEqual(evaluateSection16MonitorConditions({ ...facts, rows: [{ ...row, fields: { ...row.fields, rowKind: "derivative", amountOwned: field("exact", "0") } }] }, conditions, "holding").status, "match");
});
function deps(monitors: ReportedHoldingsMonitor[], write: NonNullable<Parameters<typeof consumeReportedHoldings>[1]>["write"] = async () => { throw Error("unexpected alert"); }): NonNullable<Parameters<typeof consumeReportedHoldings>[1]> {
  return { readCanonical: a => readSection16FilingByAccession(a, repository), readFacts: a => readSection16MonitorFacts(a, repository), listMonitors: async () => ({ monitors, invalidIds: [] }), readTarget: async () => ({ status: "available", target }), write, now: () => new Date("2026-10-14T00:00:00Z") };
}
