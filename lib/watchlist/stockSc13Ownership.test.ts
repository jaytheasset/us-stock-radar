import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier.startsWith("@/")) {
      const base = new URL(`../../${specifier.slice(2)}`, import.meta.url);
      const file = new URL(`${base.href}.ts`);
      const index = new URL(`${base.href}/index.ts`);
      return nextResolve(existsSync(fileURLToPath(file)) ? file.href : index.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { buildStockSc13OwnershipSnapshot } = await import("./stockSc13Ownership.ts");
const { fetchStockSc13Ownership } = await import("./stockSc13OwnershipServer.ts");

test("projects confirmed reader values without dropping a reported zero", () => {
  const state = availableState({
    positions: [{
      currentReporters: [{
        reportingPersonCik: "0000000201",
        reportingPersonNameRaw: "Example Reporter",
        sourceAccessionNumber: ACCESSION,
        values: currentValues("0", "0"),
      }],
      cusipsRaw: ["123456789"],
      formFamily: "SCHEDULE 13G",
      headAccessionNumber: ACCESSION,
      issuerCik: ISSUER,
      issues: [],
      orderedAccessions: [ACCESSION],
      positionKey: "position",
      rootAccessionNumber: ACCESSION,
      scope: "complete_stored_history_not_sec_global",
      securityClassRaw: "Common Stock",
      status: "available_stored_history",
      version: "sec_sc13_lineage_v1",
    }],
    reporter: reporterRow("0", "0", "0000000201"),
  });

  const result = buildStockSc13OwnershipSnapshot({ currentState: state, symbol: "test" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  const reporter = result.positions[0]!.currentReporters[0]!;
  assert.deepEqual(reporter.aggregateAmountOwned, {
    evidence: evidence(),
    status: "available",
    valueRaw: "0",
  });
  assert.equal(reporter.percentOfClass.status, "available");
  assert.equal(reporter.percentOfClass.valueRaw, "0");
  assert.equal(result.gptDependency, false);
  assert.equal(result.scope, "complete_stored_history_not_sec_global");
});

test("keeps unresolved history values separate from confirmed current reporters", () => {
  const state = availableState({
    positions: [{
      currentReporters: [],
      cusipsRaw: ["123456789"],
      formFamily: "SCHEDULE 13G",
      headAccessionNumber: null,
      issuerCik: ISSUER,
      issues: [`reporter_identity_unverified:${ACCESSION}`, "root_missing"],
      orderedAccessions: [ACCESSION],
      positionKey: "position",
      rootAccessionNumber: null,
      scope: "complete_stored_history_not_sec_global",
      securityClassRaw: "Common Stock",
      status: "unresolved",
      version: "sec_sc13_lineage_v1",
    }],
    reporter: reporterRow("0", null, null),
  });

  const result = buildStockSc13OwnershipSnapshot({ currentState: state, symbol: "TEST" });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.positions[0]!.status, "unresolved");
  assert.deepEqual(result.positions[0]!.currentReporters, []);
  assert.equal(result.positions[0]!.history[0]!.reporters[0]!.aggregateAmountOwnedRaw, "0");
  assert.equal(result.positions[0]!.history[0]!.reporters[0]!.percentOfClassRaw, null);
  assert.equal(result.positions[0]!.history[0]!.reporters[0]!.reportingPersonCik, null);
});

test("fails closed when reader provenance cannot be linked to an SEC source", () => {
  const state = availableState({
    positions: [{
      currentReporters: [{
        reportingPersonCik: "0000000201",
        reportingPersonNameRaw: "Example Reporter",
        sourceAccessionNumber: ACCESSION,
        values: currentValues("1", "1"),
      }],
      cusipsRaw: ["123456789"],
      formFamily: "SCHEDULE 13D",
      headAccessionNumber: ACCESSION,
      issuerCik: ISSUER,
      issues: [],
      orderedAccessions: [ACCESSION],
      positionKey: "position",
      rootAccessionNumber: ACCESSION,
      scope: "complete_stored_history_not_sec_global",
      securityClassRaw: "Common Stock",
      status: "available_stored_history",
      version: "sec_sc13_lineage_v1",
    }],
    reporter: reporterRow("1", "1", "0000000201"),
    sourceUrl: "https://example.com/not-sec.xml",
  });
  const result = buildStockSc13OwnershipSnapshot({ currentState: state, symbol: "TEST" });
  assert.equal(result.status, "unavailable");
  assert.equal(result.status === "unavailable" && result.reason, "reader_projection_invalid");
});

test("resolves ticker identity completely before calling the current-state reader", async () => {
  let readerIssuer = "";
  const result = await fetchStockSc13Ownership("test", {
    fetchedAt: "2026-09-12T00:00:00.000Z",
    repository: repository([
      { id: "1", issuer_cik: ISSUER, observed_at: "2026-09-12", ticker: "TEST" },
      { id: "2", issuer_cik: ISSUER, observed_at: "2026-09-11", ticker: "TEST" },
    ]),
    async readCurrentState(issuerCik) {
      readerIssuer = issuerCik;
      return { historyComplete: true, issuerCik, status: "empty" };
    },
  });
  assert.equal(readerIssuer, ISSUER);
  assert.equal(result.status, "empty");
  assert.equal(result.issuerCik, ISSUER);
});

test("rejects ambiguous, malformed, and incomplete ticker identity reads", async () => {
  let readerCalls = 0;
  const readCurrentState = async () => {
    readerCalls += 1;
    return { historyComplete: true, issuerCik: ISSUER, status: "empty" } as const;
  };
  const ambiguous = await fetchStockSc13Ownership("TEST", {
    readCurrentState,
    repository: repository([
      { issuer_cik: ISSUER, ticker: "TEST" },
      { issuer_cik: "0000000999", ticker: "TEST" },
    ]),
  });
  assert.equal(ambiguous.status === "unavailable" && ambiguous.reason, "issuer_identity_ambiguous");

  const malformed = await fetchStockSc13Ownership("TEST", {
    readCurrentState,
    repository: repository([{ issuer_cik: "bad", ticker: "TEST" }]),
  });
  assert.equal(malformed.status === "unavailable" && malformed.reason, "issuer_identity_response_invalid");

  const incompleteRepository = repository([{ issuer_cik: ISSUER, ticker: "TEST" }], 2);
  const incomplete = await fetchStockSc13Ownership("TEST", {
    readCurrentState,
    repository: incompleteRepository,
  });
  assert.equal(incomplete.status === "unavailable" && incomplete.reason, "issuer_identity_history_incomplete");
  assert.equal(readerCalls, 0);
});

test("Ownership UI is SC13-only in the reported beneficial-owner area", () => {
  const component = readFileSync(
    fileURLToPath(new URL("../../components/watchlist-v2/StockFundamentalsSections.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(component, /Reported beneficial owners \(Schedule 13\)/);
  assert.match(component, /not a\s+real-time holding/);
  assert.match(component, /joint-reporting amounts are not totaled/);
  assert.match(component, /Stored filing evidence — not a confirmed latest position/);
  assert.doesNotMatch(component, /5%\+ beneficial ownership filings/);
  assert.doesNotMatch(component, /reportedBeneficialOwners/);
});

const ISSUER = "0000000101";
const ACCESSION = "0000000101-26-000001";

function evidence() {
  return {
    accessionNumber: ACCESSION,
    eventDate: "2026-09-01",
    filedAt: "2026-09-02T12:00:00.000Z",
    formType: "SC 13G",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/101/000000010126000001/primary_doc.xml",
  };
}

function reporterRow(shares: string | null, percent: string | null, cik: string | null) {
  return {
    accession_number: ACCESSION,
    aggregate_amount_owned_raw: shares,
    percent_of_class_raw: percent,
    reporting_person_cik: cik,
    reporting_person_index: 0,
    reporting_person_name_raw: "Example Reporter",
  };
}

function currentValues(shares: string, percent: string) {
  const field = (valueRaw: string) => ({
    lastReported: { sourceAccessionNumber: ACCESSION, valueRaw },
    sourceAccessionNumber: ACCESSION,
    status: "available" as const,
    valueRaw,
  });
  return {
    aggregateAmountOwnedRaw: field(shares),
    percentOfClassRaw: field(percent),
    sharedDispositivePowerRaw: field(shares),
    sharedVotingPowerRaw: field(shares),
    soleDispositivePowerRaw: field("0"),
    soleVotingPowerRaw: field("0"),
  };
}

function availableState({
  positions,
  reporter,
  sourceUrl = evidence().sourceUrl,
}: {
  positions: readonly Record<string, unknown>[];
  reporter: Record<string, unknown>;
  sourceUrl?: string;
}) {
  return {
    history: [{
      filing: {
        accession_number: ACCESSION,
        event_date: "2026-09-01",
        filed_at: "2026-09-02T12:00:00.000Z",
        form_type_raw: "SC 13G",
        source_url: sourceUrl,
      },
      reporters: [reporter],
      status: "available",
      structural: {},
    }],
    historyComplete: true,
    issuerCik: ISSUER,
    lineage: {
      links: [],
      positions,
      scope: "complete_stored_history_not_sec_global",
      secGlobalCompleteness: "not_verified",
      version: "sec_sc13_lineage_v1",
    },
    status: "available",
  } as unknown as Extract<import("@/lib/sec-sc13-xml/currentState").Sc13IssuerCurrentStateRead, { status: "available" }>;
}

function repository(rows: readonly Record<string, unknown>[], count = rows.length) {
  return {
    async rpc() {
      return { data: null, ok: false, status: 500 };
    },
    async select(_table: string, _query: Record<string, string>) {
      return { count, data: [...rows], ok: true, status: 200 };
    },
  };
}
