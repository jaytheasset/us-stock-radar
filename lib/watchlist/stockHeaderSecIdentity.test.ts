import assert from "node:assert/strict";
import test from "node:test";
import { readStockHeaderSecIdentity } from "./stockHeaderSecIdentity.ts";

const cik = "0001840317";
const sourceId = "11111111-1111-4111-8111-111111111111";
const olderSourceId = "22222222-2222-4222-8222-222222222222";

function fixture(options: {
  catalog?: unknown[];
  listings?: unknown[];
  sources?: unknown[];
  names?: unknown[];
} = {}) {
  const queries: Array<{ table: string; search: Record<string, string> }> = [];
  return {
    queries,
    readCanonicalExchange: async () => "",
    readCatalog: async (_ticker: string, search: { exactTicker: true }) => {
      assert.equal(search.exactTicker, true);
      return { ok: true, data: options.catalog ?? [{ cik_str: 1840317, ticker: "VEEAW" }] };
    },
    selectRows: async (table: string, search: Record<string, string>) => {
      queries.push({ table, search });
      const data = table === "sec_structured_raw_sources"
        ? options.sources ?? [
            { id: sourceId, fetched_at: "2026-08-28T20:47:12Z" },
            { id: olderSourceId, fetched_at: "2026-08-01T00:00:00Z" },
          ]
        : table === "sec_issuer_source_observations"
          ? options.names ?? [{ entity_name: "VEEA INC." }]
          : options.listings ?? [
              { ticker: "VEEAW", exchange: "Nasdaq" },
            ];
      return { ok: true, data };
    },
  };
}

test("uses the latest main submissions source and the exact current ticker/exchange pair", async () => {
  const dependencies = fixture();
  const identity = await readStockHeaderSecIdentity("veeaw", dependencies);
  assert.equal(dependencies.queries.length, 3);
  assert.deepEqual(identity, {
    companyName: "VEEA INC.", exchange: "Nasdaq",
  });
  assert.equal(dependencies.queries[0]?.search.source_identity,
    `eq.https://data.sec.gov/submissions/CIK${cik}.json`);
  assert.equal(dependencies.queries[1]?.search.source_raw_id, `eq.${sourceId}`);
  assert.equal(dependencies.queries[2]?.search.source_raw_id, `eq.${sourceId}`);
  assert.equal(dependencies.queries[2]?.search.ticker, "eq.VEEAW");
});

test("missing submissions/exchange can use revalidated canonical identity for the current catalog pair", async () => {
  for (const options of [{ sources: [] }, { listings: [] }, { listings: [{ ticker: "VEEAW", exchange: "" }] }]) {
    const dependencies = fixture(options);
    let calls = 0;
    dependencies.readCanonicalExchange = async (...args: unknown[]) => {
      assert.deepEqual(args, ["VEEAW", cik]); calls++; return "Nasdaq";
    };
    assert.equal((await readStockHeaderSecIdentity("VEEAW", dependencies)).exchange, "Nasdaq");
    assert.equal(calls, 1);
  }
});

test("fallback cannot bypass absent current ticker, conflicting catalog or submissions pairs", async () => {
  for (const options of [{ catalog: [] }, { catalog: [{ cik_str: 1, ticker: "VEEAW" }, { cik_str: 2, ticker: "VEEAW" }] },
    { listings: [{ ticker: "VEEAW", exchange: "NYSE" }, { ticker: "VEEAW", exchange: "Nasdaq" }] },
    { listings: [{ ticker: "VEEA", exchange: "NYSE" }] }]) {
    const dependencies = fixture(options);
    dependencies.readCanonicalExchange = async () => { assert.fail("must not bypass current identity ambiguity"); };
    assert.equal((await readStockHeaderSecIdentity("VEEAW", dependencies)).exchange, "");
  }
});

test("a missing or mismatched ticker pair cannot borrow another class's exchange", async () => {
  for (const listings of [[], [{ ticker: "VEEA", exchange: "NYSE" }]]) {
    const dependencies = fixture({ listings });
    assert.deepEqual(await readStockHeaderSecIdentity("VEEAW", dependencies), {
      companyName: "VEEA INC.", exchange: "",
    });
  }
});

test("ambiguous current catalog or simultaneous source snapshots fail closed", async () => {
  const duplicateCatalog = fixture({ catalog: [
    { cik_str: 1840317, ticker: "VEEAW" },
    { cik_str: 9999999, ticker: "VEEAW" },
  ] });
  assert.deepEqual(await readStockHeaderSecIdentity("VEEAW", duplicateCatalog), {
    companyName: "", exchange: "",
  });
  assert.equal(duplicateCatalog.queries.length, 0);

  const tiedSources = fixture({ sources: [
    { id: sourceId, fetched_at: "2026-08-28T20:47:12Z" },
    { id: olderSourceId, fetched_at: "2026-08-28T20:47:12Z" },
  ] });
  assert.deepEqual(await readStockHeaderSecIdentity("VEEAW", tiedSources), {
    companyName: "", exchange: "",
  });
});
