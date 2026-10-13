import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSc13CanonicalPayload, validateSc13CanonicalRead } from "./canonical.ts";
import { captureSc13ReporterIdentitySource, sc13SingleReporterIdentityCandidate, verifySc13ReporterIdentitySupplement } from "./reporterIdentity.ts";
import { parseSc13StructuralXml } from "../sources/sec/forms/sc13/structuralParser.ts";
import { readSc13FilingByAccession, readSc13FilingHistoryByIssuer, type Sc13CanonicalRepository } from "./persistence.ts";
import { readSc13IssuerCurrentState } from "./currentState.ts";
import { buildStockSc13OwnershipSnapshot } from "../watchlist/stockSc13Ownership.ts";
import { sc13TargetChoices } from "../monitor/sc13MonitorDisplay.ts";
import { buildSc13AlertDisplay } from "../monitor/sc13MonitorAlertDisplayServer.ts";
import { evaluateSc13Monitor } from "../sc13MonitorMatcher.ts";
import { sc13ReporterIdentityLinks } from "./reporterIdentityDisplay.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/agco-13g-single-reporter-source.json", import.meta.url), "utf8"));
const rawXml = fixture.submissionText.match(/<XML>\r?\n([\s\S]*?)<\/XML>/)[1] as string;
const rawId = "99000000-0000-4000-8000-000000000001";
const submissionUrl = fixture.indexUrl.replace("-index.html", ".txt");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function structural(xml = rawXml) { return parseSc13StructuralXml({ rawXml: xml, sourceFormat: "sec_schedule_13_xml", sourceUrl: fixture.xmlSourceUrl,
  expectedAccessionNumber: fixture.accessionNumber, expectedFormType: fixture.formType, sourceTextCharCount: xml.length,
  indexSubjectCik: "0000880266", indexSubjectCikCount: 1, indexFiledByCiks: ["0000354204"], indexCanonicalXmlUrl: fixture.xmlSourceUrl }); }
function capture(xml = rawXml, overrides = {}) {
  return captureSc13ReporterIdentitySource({ structural: structural(xml), rawXml: xml, indexUrl: fixture.indexUrl, indexHtml: fixture.indexHtml,
    submissionUrl, submissionText: fixture.submissionText.replace(rawXml, xml), ...overrides });
}
function canonical(xml = rawXml) { return buildSc13CanonicalPayload(rawId, { source_unique_id: fixture.accessionNumber, raw_payload: {
  form_type: fixture.formType, accession_number: fixture.accessionNumber, accepted_at: fixture.filedAt,
  sc13_source_text: xml, sc13_source_format: "sec_schedule_13_xml", sc13_source_url: fixture.xmlSourceUrl, sc13_source_text_char_count: xml.length,
  sc13_index_subject_cik: "0000880266", sc13_index_subject_cik_count: 1, sc13_index_filed_by_ciks: ["0000354204"], sc13_index_canonical_xml_url: fixture.xmlSourceUrl,
} })!; }
function repository(xml = rawXml, source: unknown = capture()) {
  const stored = canonical(xml), calls: string[] = [];
  // Simulate existing DB generated columns, while retaining every raw string exactly.
  for (const reporter of stored.reporters) {
    for (const key of ["sole_voting_power", "shared_voting_power", "sole_dispositive_power", "shared_dispositive_power", "aggregate_amount_owned", "percent_of_class"]) reporter[key] = reporter[`${key}_raw`];
    reporter.aggregate_excludes_certain_shares = reporter.aggregate_excludes_certain_shares_flag_raw === "Y" ? true : reporter.aggregate_excludes_certain_shares_flag_raw === "N" ? false : null;
  }
  const repo: Sc13CanonicalRepository = {
    async rpc() { throw new Error("No read may write or invoke RPC"); },
    async select(table, query) {
      calls.push(table);
      if (table === "sec_sc13_filings") return { ok: true, status: 200, data: [query.select === "accession_number" ? { accession_number: fixture.accessionNumber } : stored.filing], count: 1 };
      if (table === "sec_sc13_reporting_persons") return { ok: true, status: 200, data: stored.reporters, count: 1 };
      assert.equal(table, "raw_items"); assert.equal(query.id, `eq.${rawId}`);
      return { ok: true, status: 200, data: [{ id: rawId, source_code: "sec_edgar", source_unique_id: fixture.accessionNumber, identity_source: source }], count: 1 };
    },
  };
  return { repo, stored, calls };
}

test("actual AGCO SEC originals bind one reporting person without replacing cover XML CIK or facts", () => {
  assert.equal(hash(rawXml), fixture.xmlSha256);
  assert.equal(rawXml.length, 6699); assert.equal(rawXml.endsWith("\n"), true);
  const source = capture(); assert.ok(source);
  assert.equal(source.xmlSourceSha256, fixture.xmlSha256);
  assert.equal(source.submission.header.includes("<DOCUMENT>"), false);
  assert.equal(JSON.stringify(source).includes("3722188.00"), false, "no duplicate full XML in supplement");
  const identity = verifySc13ReporterIdentitySupplement(structural(), rawXml, source);
  assert.equal(identity?.reportingPersonCik, "0000354204");
  assert.equal(identity?.basis, "sec_header_index_single_reporter");
  assert.equal(structural().filing?.reportingPersons[0]?.reportingPersonCikRaw, null);
  assert.equal(structural().filing?.reportingPersons[0]?.percentOfClassRaw, "5.3");
  assert.equal(structural().filing?.reportingPersons[0]?.aggregateAmountOwnedRaw, "3722188.00");
  assert.deepEqual(capture(), source, "replay is deterministic");
});

test("capture proves embedded primary XML equality and rejects wrong accession/source URLs", () => {
  assert.equal(capture(rawXml, { submissionText: fixture.submissionText.replace("<classPercent>5.3", "<classPercent>9.9") }), null);
  assert.equal(capture(rawXml, { submissionText: fixture.submissionText + "<DOCUMENT><TYPE>EX-99\n</DOCUMENT>" }), null);
  for (const field of ["indexUrl", "submissionUrl"] as const) {
    const value = field === "indexUrl" ? fixture.indexUrl : submissionUrl;
    for (const invalid of [value.replace("001092", "001093"), value + "?x=1", value.replace("www.sec.gov", "evil.example")]) assert.equal(capture(rawXml, { [field]: invalid }), null);
  }
});

test("supplement requires exact single cover/signature/Item2 identity and explicit Item8 N/A", () => {
  const cover = rawXml.match(/<coverPageHeaderReportingPersonDetails>[\s\S]*?<\/coverPageHeaderReportingPersonDetails>/)![0];
  const signature = rawXml.match(/<signatureInformation>[\s\S]*?<\/signatureInformation>/)![0];
  for (const xml of [
    rawXml.replace("<memberGroup>b</memberGroup>", "<memberGroup>a</memberGroup>"),
    rawXml.replace("<memberGroup>b</memberGroup>", "<memberGroup>unknown</memberGroup>"),
    rawXml.replace(/<item8>[\s\S]*?<\/item8>/, "<item8><notApplicableFlag>N</notApplicableFlag></item8>"),
    rawXml.replace(/<item8>[\s\S]*?<\/item8>/, ""),
    rawXml.replace(cover, cover + cover), rawXml.replace(signature, signature + signature),
    rawXml.replace("<filingPersonName>Dimensional Fund Advisors LP", "<filingPersonName>Different Person"),
    rawXml.replace(signature, signature.replace("Dimensional Fund Advisors LP", "Different Person")),
  ]) assert.equal(capture(xml), null);
});

test("stored source revalidation rejects ambiguity, contradictions, name-only joins and hash tampering", () => {
  const source = capture()!;
  const verify = (candidate: unknown) => verifySc13ReporterIdentitySupplement(structural(), rawXml, candidate);
  assert.equal(verify({ ...source, xmlSourceSha256: "0".repeat(64) }), null);
  assert.equal(verify({ ...source, accessionNumber: "0000354204-26-001093" }), null);
  assert.equal(verify({ ...source, submission: { ...source.submission, embeddedDocument: { ...source.submission.embeddedDocument, xmlSha256: "0".repeat(64) } } }), null);
  for (const header of [
    source.submission.header.replace("0000354204\r", "0000880266\r").replace("0000354204\n", "0000880266\n"),
    source.submission.header.replace("DIMENSIONAL FUND ADVISORS LP", "Different Person"),
    source.submission.header.replace("FILED BY:", "FILER:"),
    source.submission.header.replace("</SEC-HEADER>", "FILED BY:\n\tCOMPANY CONFORMED NAME: Another\n\tCENTRAL INDEX KEY: 0000000001\n</SEC-HEADER>"),
  ]) assert.equal(verify({ ...source, submission: { ...source.submission, header, headerSha256: hash(header) } }), null);
  for (const indexText of [
    source.index.text.replace("DIMENSIONAL FUND ADVISORS LP (Filed by)", "Different Person (Filed by)"),
    source.index.text.replace(">0000354204 (see all company filings)", ">0000880266 (see all company filings)"),
    source.index.text.replace("CIK=0000354204", "CIK=0000880266"),
    source.index.text.replace("(Filed by)", "(Subject)"),
  ]) assert.equal(verify({ ...source, index: { ...source.index, text: indexText, sha256: hash(indexText) } }), null);
  for (const zeroXml of [rawXml.replace("<cik>0000354204</cik>", "<cik>0000000000</cik>"), rawXml.replace("<issuerCik>0000880266</issuerCik>", "<issuerCik>0000000000</issuerCik>")]) assert.equal(capture(zeroXml), null);
});

test("official reads, stock projection, specific monitor and Alert source share one separate verified identity", async () => {
  const { repo, stored } = repository(); const before = JSON.stringify(stored);
  const read = await readSc13FilingByAccession(fixture.accessionNumber, repo);
  assert.equal(read.status, "available", read.status === "unavailable" ? read.reason : read.status); if (read.status !== "available") return;
  assert.equal(read.reporters[0]!.reporting_person_cik, null);
  assert.equal(read.verifiedReporterIdentity?.reportingPersonCik, "0000354204");
  const history = await readSc13FilingHistoryByIssuer("0000880266", { repository: repo });
  assert.equal(history.status === "available" && history.filings[0]!.verifiedReporterIdentity?.reportingPersonCik, "0000354204");
  const state = await readSc13IssuerCurrentState("0000880266", { repository: repo });
  const snapshot = buildStockSc13OwnershipSnapshot({ currentState: state, symbol: "AGCO" });
  const choices = sc13TargetChoices(snapshot); assert.equal(choices.length, 1); assert.equal(choices[0]!.identitySupplemented, true);
  assert.equal(snapshot.positions[0]!.history[0]!.reporters[0]!.reportingPersonCik, null, "historical cover CIK remains absent");
  const match = evaluateSc13Monitor(state, { id: rawId, userId: rawId, domain: "sc13", target: choices[0]!.target,
    conditions: [{ key: "sc13.percent_of_class", operator: "gte", value: "5" }], isActive: true, createdAt: fixture.filedAt, updatedAt: fixture.filedAt });
  assert.equal(match.status, "match"); assert.equal(match.evidence?.conditions[0]!.valueRaw, "5.3");
  assert.deepEqual(match.evidence?.reportingPersonIdentity, read.verifiedReporterIdentity);
  const evidence = match.evidence!;
  const alerts = await buildSc13AlertDisplay([{ id: rawId, monitorId: rawId, rootAccessionNumber: evidence.rootAccessionNumber,
    headAccessionNumber: evidence.headAccessionNumber, reportingPersonCik: evidence.reportingPersonCik, securityClass: evidence.securityClass,
    cusips: evidence.cusips, evidence, createdAt: fixture.filedAt }], async () => read);
  assert.equal(alerts[0]!.sources[0]!.sourceUrl, fixture.xmlSourceUrl);
  const unavailableSource = await buildSc13AlertDisplay(alerts, async () => { throw new Error("Supplement source unavailable later"); });
  assert.deepEqual(unavailableSource[0]!.evidence.reportingPersonIdentity, evidence.reportingPersonIdentity);
  assert.equal(sc13ReporterIdentityLinks(unavailableSource[0]!.evidence.reportingPersonIdentity).length, 2);
  assert.equal(sc13ReporterIdentityLinks({ ...evidence.reportingPersonIdentity!, indexSourceUrl: "https://evil.example/" }).length, 1);
  assert.equal(JSON.stringify(stored), before);
  assert.equal(validateSc13CanonicalRead(stored.filing, stored.reporters).ok, true);
});

test("missing or invalid supplement stays unresolved; existing XML CIK path remains authoritative", async () => {
  const absent = repository(rawXml, null);
  const state = await readSc13IssuerCurrentState("0000880266", { repository: absent.repo });
  assert.equal(sc13TargetChoices(buildStockSc13OwnershipSnapshot({ currentState: state, symbol: "AGCO" })).length, 0);
  const xml = rawXml.replace("<reportingPersonName>Dimensional", "<reportingCik>0000354204</reportingCik><reportingPersonName>Dimensional");
  const strict = repository(xml, { forged: true });
  const read = await readSc13FilingByAccession(fixture.accessionNumber, strict.repo);
  assert.equal(read.status, "available", read.status === "unavailable" ? read.reason : read.status);
  assert.equal(strict.calls.includes("raw_items"), false);
  assert.equal(read.status === "available" && read.reporters[0]!.reporting_person_cik, "0000354204");
});
