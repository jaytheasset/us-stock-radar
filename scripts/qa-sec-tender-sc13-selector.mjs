#!/usr/bin/env node

import assert from "node:assert/strict";
import { runSecFormAdapterParser } from "../lib/sources/sec/forms/formWorkerRegistry.ts";

const cases = [
  {
    name: "SC TO-T/A + SC 13D/A combined filing selects tender",
    formType: "SC 13D/A",
    documentType: "SC TO-T/A",
    bodyText: ["### SC TO-T/A", "SCHEDULE TO", "Third-Party Tender Offer"].join("\n"),
    expectedKey: "tender",
    expectedSecondary: ["sc13"],
  },
  {
    name: "SC TO-I/A + SC 13D/A combined filing selects tender",
    formType: "SC 13D/A",
    documentType: "SC TO-I/A",
    bodyText: ["### SC TO-I/A", "SCHEDULE TO", "Issuer Tender Offer"].join("\n"),
    expectedKey: "tender",
    expectedSecondary: ["sc13"],
  },
  {
    name: "SC 13E3/A + SC 13D/A combined filing selects tender",
    formType: "SC 13D/A",
    documentType: "SC 13E3/A",
    bodyText: ["### SC 13E3/A", "SCHEDULE 13E-3", "Going-Private Transaction"].join("\n"),
    expectedKey: "tender",
    expectedSecondary: ["sc13"],
  },
  {
    name: "plain SC 13D/A with weak future tender mention stays sc13",
    formType: "SC 13D/A",
    documentType: "SC 13D/A",
    bodyText: "The reporting person may consider a possible tender offer, and Schedule TO may be filed in the future.",
    expectedKey: "sc13",
    expectedSecondary: [],
  },
];

const results = [];

for (const item of cases) {
  const result = runSecFormAdapterParser(rawItemForCase(item), item.formType);
  const worker = result.worker || {};
  assert.equal(worker.key, item.expectedKey, item.name);
  assert.deepEqual(worker.secondary_form_context || [], item.expectedSecondary, item.name);
  if (item.expectedKey === "tender") {
    assert.equal(worker.primary_adapter, "tender", item.name);
    assert.ok(worker.selector_signal, item.name);
  } else {
    assert.equal(worker.primary_adapter || null, null, item.name);
    assert.equal(worker.selector_signal || null, null, item.name);
  }
  results.push({
    name: item.name,
    adapter: worker.key,
    parserGroup: worker.parserGroup,
    secondaryFormContext: worker.secondary_form_context || [],
    selectorSignal: worker.selector_signal || null,
  });
}

console.log(JSON.stringify({ ok: true, liveCalls: false, dbWrites: false, openAiCalls: false, results }, null, 2));

function rawItemForCase(item) {
  return {
    id: `qa-${item.documentType}`,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: "0000000000-00-000000",
    source_url: "https://www.sec.gov/Archives/edgar/data/0/000000000000000000/0000000000-00-000000-index.htm",
    title: `${item.formType} selector QA`,
    published_at: "2026-06-06T00:00:00.000Z",
    body_text: item.bodyText,
    analysis_text: item.bodyText,
    raw_payload: {
      accession_number: "0000000000-00-000000",
      form_type: item.formType,
      documents: [
        {
          sequence: 1,
          type: item.documentType,
          description: item.documentType,
          document: `${item.documentType.toLowerCase().replace(/[^a-z0-9]+/g, "")}.htm`,
          url: "https://www.sec.gov/Archives/edgar/data/0/mock.htm",
          isPrimary: true,
          textCharCount: item.bodyText.length,
        },
      ],
      attachment_texts: [],
    },
    metadata: {
      form_type: item.formType,
    },
  };
}
