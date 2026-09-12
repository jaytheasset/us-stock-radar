import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

const { readSection16IssuerCurrentState } = await import("./currentState.ts");
const { buildSection16CanonicalPayload } = await import("./canonical.ts");
const { preserveSection16XmlSource } = await import("../sources/sec/forms/section16Xml/parser.ts");

type Row = Record<string, unknown>;
type Fixture = {
  file: string;
  formType: "3" | "3/A" | "5" | "5/A";
  accessionNumber: string;
  issuerCik: string;
  filingDate: string;
  acceptedAt: string;
  sourceUrl: string;
  sha256: string;
};

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../sources/sec/forms/section16Xml/fixtures");
const manifests = ["sources.json", "lineage-sources.json"].flatMap((file) => (
  (JSON.parse(readFileSync(path.join(fixtureDir, file), "utf8")) as { fixtures: Fixture[] }).fixtures
));

test("reads complete verified storage in reverse accession order and resolves the real Stepan lineage", async () => {
  const repository = canonicalRepository([
    canonicalRows(requiredFixture("0000094049-26-000015"), "73000000-0000-4000-8000-000000000001"),
    canonicalRows(requiredFixture("0001127602-25-004959"), "73000000-0000-4000-8000-000000000002"),
  ], true);
  const result = await readSection16IssuerCurrentState("94049", { repository });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.historyComplete, true);
  assert.equal(result.historyScope, "complete_stored_history_not_sec_global");
  assert.equal(result.lineage.links[0]?.status, "linked");
  assert.equal(result.lineage.transactions.filter((row) => row.aggregationStatus === "included").length, 5);
  assert.equal(result.lineage.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 0);
  assert.equal(result.lineage.holdingCorrections[0]?.previousValueRaw, "67.214");
});

test("distinguishes empty, malformed, failed, changed-count, duplicate, and bounded history reads", async () => {
  const empty = await readSection16IssuerCurrentState("94049", {
    repository: repository(async () => ({ ok: true, status: 200, data: [], count: 0 })),
  });
  assert.deepEqual(empty, {
    status: "empty",
    issuerCik: "0000094049",
    historyComplete: true,
    historyScope: "complete_stored_history_not_sec_global",
  });

  for (const data of [null, {}, [null], ["bad"]]) {
    const malformed = await readSection16IssuerCurrentState("94049", {
      repository: repository(async () => ({ ok: true, status: 200, data, count: 0 })),
    });
    assert.equal(malformed.status === "unavailable" && malformed.reason, "history_response_invalid");
  }

  const failed = await readSection16IssuerCurrentState("94049", {
    repository: repository(async () => ({ ok: false, status: 503, data: null, error: "offline" })),
  });
  assert.equal(failed.status === "unavailable" && failed.reason, "history_read_failed");

  let page = 0;
  const changedCount = await readSection16IssuerCurrentState("94049", {
    repository: repository(async () => {
      page += 1;
      return page === 1
        ? { ok: true, status: 200, data: accessionRows(0, 100), count: 101 }
        : { ok: true, status: 200, data: accessionRows(100, 1), count: 102 };
    }),
  });
  assert.equal(changedCount.status === "unavailable" && changedCount.reason, "history_count_changed");

  const duplicate = await readSection16IssuerCurrentState("94049", {
    repository: repository(async () => ({
      ok: true,
      status: 200,
      data: [{ accession_number: "0000094049-26-000015" }, { accession_number: "0000094049-26-000015" }],
      count: 2,
    })),
  });
  assert.equal(duplicate.status === "unavailable" && duplicate.reason, "history_duplicate_accession");

  const bounded = await readSection16IssuerCurrentState("94049", {
    maxPages: 1,
    repository: repository(async () => ({ ok: true, status: 200, data: accessionRows(0, 100), count: null })),
  });
  assert.equal(bounded.status === "unavailable" && bounded.reason, "history_page_limit_exceeded");
});

test("fails closed if a canonical child read is missing or belongs to another issuer", async () => {
  const canonical = canonicalRows(requiredFixture("0000094049-26-000015"), "73000000-0000-4000-8000-000000000003");
  const missingChild = canonicalRepository([canonical], false, "sec_section16_transactions");
  const missing = await readSection16IssuerCurrentState("94049", { repository: missingChild });
  assert.equal(missing.status === "unavailable" && missing.reason, "transaction_count_mismatch");

  const wrongIssuer = structuredClone(canonical);
  wrongIssuer.filing.issuer_cik = "0000000001";
  const mismatch = await readSection16IssuerCurrentState("94049", { repository: canonicalRepository([wrongIssuer]) });
  assert.equal(mismatch.status === "unavailable" && mismatch.reason, "filing_columns_mismatch");
});

function canonicalRows(fixture: Fixture, rawItemId: string) {
  const xml = readFileSync(path.join(fixtureDir, fixture.file), "utf8");
  const preserved = preserveSection16XmlSource({
    formType: fixture.formType,
    sourceUrl: fixture.sourceUrl,
    text: xml,
    sha256: fixture.sha256,
  });
  const rawItem = {
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: fixture.accessionNumber,
    raw_payload: {
      form_type: fixture.formType,
      accession_number: fixture.accessionNumber,
      ownership_issuer_cik: fixture.issuerCik,
      filing_date: fixture.filingDate,
      accepted_at: fixture.acceptedAt,
      ...preserved,
    },
  };
  const payload = buildSection16CanonicalPayload(rawItemId, rawItem);
  assert.ok(payload);
  return {
    filing: payload.filing as Row,
    reportingOwners: payload.reportingOwners as Row[],
    transactions: payload.transactions as Row[],
    holdings: payload.holdings as Row[],
    footnotes: payload.footnotes as Row[],
    signatures: payload.signatures as Row[],
  };
}

function canonicalRepository(
  filings: ReturnType<typeof canonicalRows>[],
  reverseHistory = false,
  omitTable = "",
) {
  const tables = new Map<string, keyof ReturnType<typeof canonicalRows>>([
    ["sec_section16_reporting_owners", "reportingOwners"],
    ["sec_section16_transactions", "transactions"],
    ["sec_section16_holdings", "holdings"],
    ["sec_section16_footnotes", "footnotes"],
    ["sec_section16_signatures", "signatures"],
  ]);
  return repository(async (table, query) => {
    if (table === "sec_section16_filings" && query.select === "accession_number") {
      const rows = filings.map((item) => ({ accession_number: item.filing.accession_number }));
      return { ok: true, status: 200, data: reverseHistory ? rows.reverse() : rows, count: rows.length };
    }
    const accession = query.accession_number?.replace(/^eq\./, "") ?? "";
    const filing = filings.find((item) => item.filing.accession_number === accession);
    if (table === "sec_section16_filings") {
      return { ok: true, status: 200, data: filing ? [filing.filing] : [], count: filing ? 1 : 0 };
    }
    const key = tables.get(table);
    if (!key || !filing) return { ok: true, status: 200, data: [], count: 0 };
    const data = table === omitTable ? [] : filing[key] as Row[];
    return { ok: true, status: 200, data, count: data.length };
  });
}

function repository(
  select: (table: string, query: Record<string, string>) => Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    count?: number | null;
    error?: string;
  }>,
) {
  return {
    select,
    async rpc() {
      return { ok: false, status: 500, data: null, error: "not used" };
    },
  };
}

function requiredFixture(accessionNumber: string) {
  const fixture = manifests.find((item) => item.accessionNumber === accessionNumber);
  assert.ok(fixture);
  return fixture;
}

function accessionRows(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    accession_number: `0000094049-26-${String(start + index).padStart(6, "0")}`,
  }));
}
