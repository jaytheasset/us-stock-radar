import assert from "node:assert/strict";

import {
  parseSecS4F4RuntimeInput,
  secS4F4Adapter,
  SEC_S4_F4_ADAPTER_KEY,
  SEC_S4_F4_ANALYSIS_MODE,
  SEC_S4_F4_SUPPORTED_FORMS,
} from "./adapter.ts";
import type { SecFormParserInput } from "../common/parserContract.ts";

runAdapterContractTests();

function runAdapterContractTests(): void {
  assert.equal(secS4F4Adapter.key, SEC_S4_F4_ADAPTER_KEY);
  assert.equal(secS4F4Adapter.parserGroup, "s4-f4");
  assert.equal(secS4F4Adapter.analysisMode, SEC_S4_F4_ANALYSIS_MODE);
  assert.deepEqual([...secS4F4Adapter.supportedForms], [...SEC_S4_F4_SUPPORTED_FORMS]);

  const parsed = parseSecS4F4RuntimeInput(runtimeInput());
  assert.equal(parsed.parserGroup, "s4-f4");
  assert.equal(parsed.facts.secFormType, "S-4/A");
  assert.equal(parsed.accessionNumber, "0000000000-26-000001");
  assert.equal(parsed.isSupported, true);
  assert.ok(parsed.raw.selectedExhibitSnippets, "adapter should preserve attachment text as parser-visible exhibit snippets");

  assert.equal("buildDisplayPayload" in secS4F4Adapter, false);

  const parsedFromBodyText = parseSecS4F4RuntimeInput(runtimeInputWithBodyTextOnly());
  const sourceDocuments = Array.isArray(parsedFromBodyText.raw.sourceDocuments) ? parsedFromBodyText.raw.sourceDocuments : [];
  assert.equal(parsedFromBodyText.isSupported, true);
  assert.ok(
    sourceDocuments.some(
      (document) =>
        isRecord(document) &&
        document.role === "primary" &&
        typeof document.textSnippet === "string" &&
        document.textSnippet.includes("proxy statement/prospectus"),
    ),
    "adapter should use bodyText as primary document text when primaryDocumentText is absent",
  );

  const parsedWithParentContext = parseSecS4F4RuntimeInput(runtimeInputWithParentContext());
  assert.ok(
    parsedWithParentContext.cleaned_source_blocks.some((block) => block.title === "Parent filing context"),
    "adapter should pass parent_filing_context into S-4/F-4 parser source blocks",
  );
}

function runtimeInput(): SecFormParserInput {
  return {
    rawItemId: "raw_s4f4_test",
    accessionNumber: "0000000000-26-000001",
    formType: "S-4/A",
    filedAt: "2026-05-27",
    ticker: "TEST",
    companyName: "Test PubCo Ltd.",
    title: "Amendment No. 1 to Form S-4",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/s4a.htm",
    primaryDocumentText: [
      "Amendment No. 1 to Form S-4 Registration Statement.",
      "Test PubCo Ltd. entered into a business combination agreement with Test Acquisition Corp., a SPAC.",
      "The proxy statement/prospectus includes Questions and Answers about the Business Combination.",
      "The special meeting will be held on June 30, 2026.",
      "The amendment includes a non-redemption agreement and updates the minimum cash condition.",
    ].join(" "),
    attachments: [
      {
        type: "EX-2.1",
        filename: "ex21.htm",
        description: "Amendment to Business Combination Agreement",
        text: "The Business Combination Agreement is amended to update the minimum cash condition.",
      },
    ],
    metadata: null,
    rawPayload: null,
  };
}

function runtimeInputWithBodyTextOnly(): SecFormParserInput {
  return {
    rawItemId: "raw_s4f4_body_text_test",
    accessionNumber: "0000000000-26-000002",
    formType: "S-4",
    filedAt: "2026-05-28",
    ticker: "BODY",
    companyName: "Body Text Merger Corp.",
    title: "Form S-4 Registration Statement",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026000002/s4.htm",
    bodyText: [
      "Registration Statement on Form S-4.",
      "The proxy statement/prospectus describes a proposed merger and special meeting.",
      "Shareholders will vote on the transaction.",
    ].join(" "),
    attachments: [],
    metadata: null,
    rawPayload: null,
  } as SecFormParserInput & { bodyText: string };
}

function runtimeInputWithParentContext(): SecFormParserInput {
  return {
    rawItemId: "raw_s4f4_parent_context_test",
    accessionNumber: "0000000000-26-000003",
    formType: "S-4/A",
    filedAt: "2026-05-29",
    ticker: "PCTX",
    companyName: "Parent Context Merger Corp.",
    title: "Amendment No. 1 to Form S-4",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026000003/s4a.htm",
    bodyText: [
      "Amendment No. 1 to Form S-4.",
      "The proxy statement/prospectus updates the merger consideration and shareholder vote disclosure.",
    ].join(" "),
    attachments: [],
    metadata: {
      parent_filing_context: {
        status: "found",
        parent: {
          accession_number: "0000000000-26-000002",
          form_type: "S-4",
          summary: "Initial S-4 described the original merger consideration.",
        },
      },
    },
    rawPayload: null,
  } as SecFormParserInput & { bodyText: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
