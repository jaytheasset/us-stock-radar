import assert from "node:assert/strict";

import {
  SEC_425_ADAPTER_KEY,
  SEC_425_ANALYSIS_MODE,
  SEC_425_SUPPORTED_FORMS,
  parseSec425AdapterInput,
  sec425Adapter,
  sec425FormAdapter,
} from "./adapter";

assert.equal(SEC_425_ADAPTER_KEY, "sec_425");
assert.equal(SEC_425_ANALYSIS_MODE, "router_required");
assert.deepEqual([...SEC_425_SUPPORTED_FORMS], ["425"]);
assert.equal(sec425Adapter.adapterKey, SEC_425_ADAPTER_KEY);
assert.equal(sec425FormAdapter, sec425Adapter);
assert.equal(sec425Adapter.parserGroup, "425");
assert.equal(sec425Adapter.analysisMode, SEC_425_ANALYSIS_MODE);
assert.equal(sec425Adapter.supportedForms.includes("425"), true);
assert.equal(typeof sec425Adapter.parse, "function");
assert.equal(typeof sec425Adapter.route, "function");
assert.equal(typeof sec425Adapter.buildRouterPrompt, "function");
assert.equal(typeof sec425Adapter.buildDisplayPayload, "function");
assert.equal(typeof sec425Adapter.buildAnalysisPrompt, "function");

const parserOutput = parseSec425AdapterInput({
  formType: "425",
  accessionNumber: "0000000000-26-042500",
  ticker: "TST",
  companyName: "Adapter Test Corp.",
  filedAt: "2026-05-27T00:00:00Z",
  title: "Form 425 Adapter Smoke Test",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/0000000000/adapter-test.htm",
  primaryDocumentText: `
Filed pursuant to Rule 425
Subject Company: Adapter Target Inc.
Press Release
Adapter Test Corp. announced a merger agreement to acquire Adapter Target Inc. for $10.75 per share in cash.
The transaction is expected to close in the second half of 2026.
`,
  attachments: [
    {
      type: "EX-99.1",
      description: "Press Release",
      filename: "ex991.htm",
      url: "https://www.sec.gov/Archives/edgar/data/0000000000/ex991.htm",
      text: "The companies will host a conference call to discuss the transaction.",
    },
  ],
  rawPayload: {
    documents: [
      { type: "425", description: "Primary document", url: "https://example.test/primary.htm", isPrimary: true },
      { type: "EX-99.1", description: "Press Release", url: "https://example.test/ex991.htm" },
    ],
  },
});

assert.equal(parserOutput.parserGroup, "425");
assert.equal(parserOutput.formType, "425");
assert.equal(parserOutput.accessionNumber, "0000000000-26-042500");
assert.equal(parserOutput.facts.primary_ticker, "TST");
assert.equal(parserOutput.facts.deal.cash_component, "$10.75 per share in cash");
assert.ok(parserOutput.facts.documents.some((document) => document.document_type === "EX-99.1"));

const route = sec425Adapter.route(parserOutput);
assert.equal(route.event_type, "strategic_transaction");
assert.equal(route.needs_analysis_llm, true);

console.log("sec 425 adapter fixtures passed");
