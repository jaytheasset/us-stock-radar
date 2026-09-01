import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { SEC_FETCH_TIMEOUT_MS, secFetch } from "./secFetch.ts";
import { fetchSecEdgarRawItems } from "./parser.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function hangUntilAborted(signal: AbortSignal | null | undefined) {
  assert.ok(signal, "SEC fetch attempt must include an abort signal");

  return new Promise<Response>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("secFetch returns a normal response with the 30-second production boundary", async () => {
  let attemptSignal: AbortSignal | null | undefined;
  const expected = new Response("ok", { status: 200 });

  globalThis.fetch = (async (_input, init) => {
    attemptSignal = init?.signal;
    return expected;
  }) as typeof fetch;

  const response = await secFetch("https://www.sec.gov/example");

  assert.equal(SEC_FETCH_TIMEOUT_MS, 30_000);
  assert.equal(response, expected);
  assert.ok(attemptSignal);
  assert.equal(attemptSignal.aborted, false);
});

test("secFetch retries a timed-out attempt with a fresh timeout signal", async () => {
  const attemptSignals: AbortSignal[] = [];

  globalThis.fetch = (async (_input, init) => {
    assert.ok(init?.signal);
    attemptSignals.push(init.signal);
    if (attemptSignals.length === 1) return hangUntilAborted(init.signal);
    return new Response("recovered", { status: 200 });
  }) as typeof fetch;

  const response = await secFetch("https://www.sec.gov/example", { timeoutMs: 10 });

  assert.equal(await response.text(), "recovered");
  assert.equal(attemptSignals.length, 2);
  assert.notEqual(attemptSignals[0], attemptSignals[1]);
  assert.equal(attemptSignals[0]?.aborted, true);
  assert.equal(attemptSignals[1]?.aborted, false);
});

test("secFetch clearly fails after the existing maximum attempts all time out", async () => {
  const attemptSignals: AbortSignal[] = [];

  globalThis.fetch = (async (_input, init) => {
    assert.ok(init?.signal);
    attemptSignals.push(init.signal);
    return hangUntilAborted(init.signal);
  }) as typeof fetch;

  await assert.rejects(
    secFetch("https://www.sec.gov/example", { timeoutMs: 5 }),
    (error: unknown) =>
      error instanceof Error && error.name === "TimeoutError" && /timeout/i.test(error.message),
  );

  assert.equal(attemptSignals.length, 3);
  assert.equal(new Set(attemptSignals).size, 3);
  assert.equal(attemptSignals.every((signal) => signal.aborted), true);
});

test("secFetch preserves 429 and 5xx retry behavior", async (context) => {
  for (const retryStatus of [429, 503]) {
    await context.test(`retries HTTP ${retryStatus}`, async () => {
      let attempts = 0;

      globalThis.fetch = (async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("transient", {
            status: retryStatus,
            headers: { "Retry-After": "0" },
          });
        }
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const response = await secFetch("https://www.sec.gov/example", { timeoutMs: 50 });

      assert.equal(response.status, 200);
      assert.equal(attempts, 2);
    });
  }
});

test("40-F collection retains annual EX-99 source documents and excludes unrelated certifications", async () => {
  const base = "https://www.sec.gov/Archives/edgar/data/756894/000119312526079253/";
  const detailHtml = `
    <html><body>
      <div class="companyInfo"><span class="companyName">BARRICK MINING CORP (Filer)</span></div>
      <div class="infoHead">Filing Date</div><div class="info">2026-02-27</div>
      <div class="infoHead">Accepted</div><div class="info">2026-02-27 07:39:52</div>
      <table summary="Document Format Files">
        <tr><td>1</td><td>40-F</td><td><a href="d833573d40f.htm">d833573d40f.htm</a></td><td>40-F</td><td>527978</td></tr>
        <tr><td>2</td><td>EX-99.1</td><td><a href="d833573dex991.htm">d833573dex991.htm</a></td><td>EX-99.1</td><td>1854512</td></tr>
        <tr><td>3</td><td>EX-99.2</td><td><a href="d833573dex992.htm">d833573dex992.htm</a></td><td>EX-99.2</td><td>3291</td></tr>
        <tr><td>4</td><td>EX-99.3</td><td><a href="d833573dex993.htm">d833573dex993.htm</a></td><td>EX-99.3</td><td>5799657</td></tr>
        <tr><td>5</td><td>EX-99.4</td><td><a href="d833573dex994.htm">d833573dex994.htm</a></td><td>EX-99.4</td><td>4237416</td></tr>
        <tr><td>6</td><td>EX-99.5</td><td><a href="d833573dex995.htm">d833573dex995.htm</a></td><td>EX-99.5</td><td>3322</td></tr>
      </table>
    </body></html>`;
  const sources = new Map<string, string>([
    ["d833573d40f.htm", "<html><body>FORM 40-F. For the fiscal year ended December 31, 2025.</body></html>"],
    ["d833573dex991.htm", "<html><body>BARRICK MINING CORPORATION ANNUAL INFORMATION FORM. Results of Operations in 2025.</body></html>"],
    ["d833573dex992.htm", "<html><body>Consent of independent qualified person.</body></html>"],
    ["d833573dex993.htm", `<html><body><div>${"introductory filing text ".repeat(11_000)}</div><h1>AUDITED CONSOLIDATED FINANCIAL STATEMENTS</h1><p>For the fiscal year ended December 31, 2025, revenue increased compared with 2024, while operating income, net income, and cash flows from operating activities reflected the annual performance.</p></body></html>`],
    ["d833573dex994.htm", "<html><body>MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL AND OPERATING RESULTS. Revenue increased from 2024.</body></html>"],
    ["d833573dex995.htm", "<html><body>Consent of Independent Registered Public Accounting Firm. We consent to incorporation by reference of our report relating to the consolidated financial statements appearing in Exhibit 99.3.</body></html>"],
  ]);

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("index.json")) return Response.json({ directory: { item: [] } });
    if (url.endsWith("0001193125-26-079253-index.html")) return new Response(detailHtml, { status: 200, headers: { "content-type": "text/html" } });
    if (url.endsWith("company_tickers_exchange.json")) {
      return Response.json({ fields: ["cik", "name", "ticker", "exchange"], data: [[756894, "Barrick Mining Corp", "B", "NYSE"]] });
    }
    const filename = [...sources.keys()].find((candidate) => url === `${base}${candidate}`);
    if (filename) return new Response(sources.get(filename), { status: 200, headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await fetchSecEdgarRawItems({
    accessionNumber: "0001193125-26-079253",
    cik: "756894",
    formTypes: ["40-F"],
    attachmentLimit: 8,
    includeDocuments: true,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.items[0]?.raw_payload.form_type, "40-F");
  const attachments = result.items[0]?.raw_payload.attachment_texts as Array<Record<string, unknown>>;
  assert.deepEqual(attachments.map((item) => item.type), ["EX-99.1", "EX-99.3", "EX-99.4"]);
  assert.match(result.items[0]?.body_text || "", /ANNUAL INFORMATION FORM/);
  assert.match(result.items[0]?.body_text || "", /MANAGEMENT'S DISCUSSION AND ANALYSIS/);
  assert.doesNotMatch(result.items[0]?.body_text || "", /Consent of independent qualified person/);
  assert.doesNotMatch(result.items[0]?.body_text || "", /Consent of Independent Registered Public Accounting Firm/);
  const documents = result.items[0]?.raw_payload.documents as Array<Record<string, unknown>>;
  assert.equal(documents.find((item) => item.type === "EX-99.3")?.textExtractionStatus, "text_extracted");
  assert.equal(documents.find((item) => item.type === "EX-99.2")?.textExtractionStatus, "text_extracted_not_retained_unrelated_40f_exhibit");
  assert.equal(documents.find((item) => item.type === "EX-99.5")?.textExtractionStatus, "text_extracted_not_retained_unrelated_40f_exhibit");
});
