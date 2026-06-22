import type { SecFormParserInput } from "../common/parserContract";

import { buildSec425AnalysisPromptDraft, buildSec425DeterministicRoomResult } from "./analysisPrompt";
import { buildSec425DisplayPayload } from "./displayPayload";
import { parseSec425Filing } from "./parser";
import { buildSec425RouterPromptDraft, routeSec425ParserOutput } from "./routerPrompt";
import { SEC_425_PARSER_GROUP, type Sec425ParseInput } from "./types";

export const SEC_425_ADAPTER_KEY = "sec_425";
export const SEC_425_SUPPORTED_FORMS = ["425"] as const;
export const SEC_425_ANALYSIS_MODE = "router_required" as const;

export function parseSec425AdapterInput(input: SecFormParserInput) {
  return parseSec425Filing(toSec425ParseInput(input));
}

export const sec425Adapter = {
  adapterKey: SEC_425_ADAPTER_KEY,
  parserGroup: SEC_425_PARSER_GROUP,
  supportedForms: SEC_425_SUPPORTED_FORMS,
  analysisMode: SEC_425_ANALYSIS_MODE,
  parse: parseSec425AdapterInput,
  parser: parseSec425AdapterInput,
  parseSec425Filing,
  route: routeSec425ParserOutput,
  buildRouterPrompt: buildSec425RouterPromptDraft,
  buildDisplayPayload: buildSec425DisplayPayload,
  buildAnalysisPrompt: buildSec425AnalysisPromptDraft,
  buildDeterministicRoomResult: buildSec425DeterministicRoomResult,
} as const;

export const sec425FormAdapter = sec425Adapter;

function toSec425ParseInput(input: SecFormParserInput): Sec425ParseInput {
  return {
    rawItemId: input.rawItemId,
    sourceUniqueId: input.accessionNumber,
    sourceUrl: input.sourceUrl,
    title: input.title,
    publishedAt: input.filedAt,
    formType: input.formType,
    accessionNumber: input.accessionNumber,
    companyName: input.companyName,
    primaryTicker: input.ticker,
    filingText: input.primaryDocumentText,
    attachments: (input.attachments || []).map((attachment) => ({
      documentType: attachment.type,
      description: attachment.description || attachment.filename,
      text: attachment.text,
      url: attachment.url,
    })),
    rawPayload: input.rawPayload,
    metadata: input.metadata,
  };
}
