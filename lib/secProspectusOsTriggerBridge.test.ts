import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D%3B" };
    }
    return nextResolve(specifier, context);
  },
});

const { runSecProspectusOsTriggerBridge } = await import("./secProspectusOsTriggerBridge.ts");

const RAW_ITEM_ID = "11111111-1111-4111-8111-111111111111";

test("voting plus non-voting common classes return Review with zero persistence writes", async () => {
  const html = `<html><body>
    <p>Our Voting Common Stock was approved for listing on the Nasdaq Capital Market under the symbol "DUAL".</p>
    <p>The Company is authorized to issue two classes of stock. The total authorized capital consists of 90,000,000 shares of Common Stock and 10,000,000 shares of preferred stock.</p>
    <p>Holders of our separate non-voting Common Stock class have no voting rights.</p>
    <p>As of March 31, 2025, we had 24,000,000 shares of Common Stock issued and outstanding.</p>
  </body></html>`;
  const { result, queries } = await runWithStoredHtml(html);

  assertReviewWithoutWrites(result, queries, "MULTIPLE_COMMON_CLASSES");
});

test("missing positive single-class capital evidence returns Review with zero persistence writes", async () => {
  const html = `<html><body>
    <p>Our Common Stock was approved for listing on the Nasdaq Capital Market under the symbol "UNKNOWN".</p>
    <p>Each share of Common Stock is entitled to one vote.</p>
    <p>As of March 31, 2025, we had 24,000,000 shares of Common Stock issued and outstanding.</p>
  </body></html>`;
  const { result, queries } = await runWithStoredHtml(html);

  assertReviewWithoutWrites(result, queries, "COMMON_CLASS_BASIS_INCOMPLETE");
});

async function runWithStoredHtml(html: string) {
  const queries: string[] = [];
  const client = {
    async query<Row extends Record<string, unknown>>(sql: string) {
      queries.push(sql);
      if (!sql.includes("from public.raw_items")) {
        throw new Error(`unexpected persistence query: ${sql}`);
      }
      return {
        rows: [{
          id: RAW_ITEM_ID,
          source_url: "https://www.sec.gov/Archives/edgar/data/2025942/000149315225012350/",
          body_text: html,
          raw_payload: {
            form_type: "424B4",
            cik_padded: "0002025942",
            accession_number: "0001493152-25-012350",
            filing_date: "2025-08-25",
            accepted_at: "2025-08-25T16:00:00Z",
            primary_document_url: "https://www.sec.gov/Archives/edgar/data/2025942/000149315225012350/form424b4.htm",
            primary_document_html: html,
            primary_document_html_char_count: html.length,
            primary_document_html_truncated: false,
          },
        }] as unknown as Row[],
        rowCount: 1,
      };
    },
    release() {},
  };
  const result = await runSecProspectusOsTriggerBridge({
    rawItemIds: [RAW_ITEM_ID],
    environment: {
      SEC_USER_AGENT: "Stock Radar engineering contact@example.com",
      SUPABASE_DB_URL: "postgresql://unused",
    },
    pool: {
      async connect() { return client; },
      async end() {},
    },
  });
  return { result, queries };
}

function assertReviewWithoutWrites(
  result: Awaited<ReturnType<typeof runSecProspectusOsTriggerBridge>>,
  queries: string[],
  expectedReason: "MULTIPLE_COMMON_CLASSES" | "COMMON_CLASS_BASIS_INCOMPLETE",
) {
  assert.equal(result.status, "completed");
  assert.equal(result.results[0]?.decision.status, "REVIEW");
  if (result.results[0]?.decision.status === "REVIEW") {
    assert.equal(result.results[0].decision.reason, expectedReason);
  }
  assert.equal(result.results[0]?.persistence, "NOT_WRITTEN");
  assert.equal(result.results[0]?.historyInserted, 0);
  assert.equal(result.results[0]?.snapshotInserted, 0);
  assert.equal(queries.length, 1);
  assert.ok(queries.every((sql) => !/\b(?:begin|insert|update|delete)\b/i.test(sql)));
}
