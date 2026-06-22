import type { S8ApprovedEventType, S8ParserOutput, S8RouterDecision } from "./types";
import { S8_APPROVED_EVENT_TYPES } from "./types";

export type S8SourceBlockPromptInput = {
  cleaned_source_blocks: Array<{
    block_type: string;
    label: string | null;
    source: string | null;
    text: string;
  }>;
};

export function buildS8RouterPrompt(parserOutput: S8ParserOutput): string {
  return [
    "You are routing an SEC S-8 / S-8/A filing for investor-facing analysis.",
    "Use only one of these approved event_type values:",
    S8_APPROVED_EVENT_TYPES.join(", "),
    "",
    "Primary routing rules:",
    "- S-8 filings that register meaningful equity compensation securities usually route to dilution_risk.",
    "- Do not finalize archive from parser facts or parser signals.",
    "- Do not use parser-generated facts, signals, routingHints, route hints, extraction summaries, event labels, display labels, or investment labels as classification authority.",
    "- Any case requiring interpretation, parent comparison, unusual context, or uncertainty must be sent to analysis; do not use a human-review route.",
    "- Reoffer prospectus and selling-securityholder sections should not be collapsed into ordinary plan-share facts.",
    "- Map reoffer prospectus filings to insider_ownership only when insider, officer, director, affiliate, or control-person evidence is explicit; otherwise use other.",
    "- Inducement awards should preserve award type, grant date, recipient count, and share amount.",
    "- Exhibit 107 fee-table rows are source facts; fee-calculation prices are not live market context.",
    "- S-8/A filings are update filings; do not treat them as new events unless they materially change the prior registration.",
    "- Administrative, correction-only, exhibit-only, signature-only, or no-additional-securities amendments still require analysis scoring unless integration supplies a separate parent-context policy.",
    "- If original filing comparison is needed, rely only on supplied fixture parent context; do not query live DB.",
    "- If market context is needed, rely only on supplied fixture JSON; do not call live market-data APIs.",
    "",
    "Return JSON with:",
    '{ "route_action": "finalize_archive|send_to_analysis", "event_type": "...", "s8_bucket": "...", "score_hint": 0, "reason": "...", "evidence": [], "final_output": "only when route_action is finalize_archive" }',
    "",
    "Internal fields such as route_action, s8_bucket, analysis_reason, and score_hint must never appear inside final_output.",
    "",
    "Cleaned source blocks:",
    JSON.stringify(buildS8SourceBlockPromptInput({ parserOutput }), null, 2),
  ].join("\n");
}

export function buildS8SourceBlockPromptInput({
  parserOutput,
  marketContext,
  parentFilingContext,
}: {
  parserOutput: S8ParserOutput;
  marketContext?: Record<string, unknown> | null;
  parentFilingContext?: Record<string, unknown> | null;
}): S8SourceBlockPromptInput {
  const blocks: S8SourceBlockPromptInput["cleaned_source_blocks"] = [];

  addSourceBlock(blocks, {
    block_type: "filing_metadata",
    label: "SEC S-8 filing metadata",
    source: "parser_identity",
    text: compactJson({
      parserVersion: parserOutput.parserVersion,
      parserGroup: parserOutput.parserGroup,
      formType: parserOutput.formType,
      accessionNumber: parserOutput.accessionNumber,
      isSupported: parserOutput.isSupported,
      issuerName: parserOutput.facts.issuerName,
      ticker: parserOutput.facts.ticker,
      exchange: parserOutput.facts.exchange,
      filedAt: parserOutput.facts.filedAt,
    }),
  });

  for (const document of parserOutput.raw.sourceDocuments.slice(0, 8)) {
    const chunks = splitSourceText(document.text, document.source === "primary" ? 8 : 4);
    chunks.forEach((chunk, index) => {
      addSourceBlock(blocks, {
        block_type: document.documentRole === "fee_exhibit" ? "table_source_block" : "cleaned_source_block",
        label: [document.documentRole, document.documentType, document.description, chunks.length > 1 ? `part ${index + 1}` : ""]
          .filter(Boolean)
          .join(" - "),
        source: document.source,
        text: chunk,
      });
    });
  }

  addSourceBlock(blocks, {
    block_type: "document_inventory",
    label: "Document inventory",
    source: "parser_source_inventory",
    text: compactJson(
      parserOutput.raw.sourceDocuments.map((document) => ({
        id: document.id,
        documentRole: document.documentRole,
        source: document.source,
        documentType: document.documentType,
        description: document.description,
        textKind: document.textKind,
        textChars: document.text.length,
      })),
    ),
  });

  addSourceBlock(blocks, {
    block_type: "attachment_inventory",
    label: "Attachment inventory",
    source: "parser_source_inventory",
    text: compactJson(
      parserOutput.raw.attachments.map((attachment, index) => ({
        index,
        documentType: attachment.documentType ?? null,
        description: attachment.description ?? null,
        textChars: attachment.text?.length ?? 0,
      })),
    ),
  });

  addSourceBlock(blocks, {
    block_type: "section_inventory",
    label: "Detected S-8 sections",
    source: "parser_sections",
    text: compactJson(
      (parserOutput.raw.sections ?? []).map((section) => ({
        key: section.key,
        heading: section.heading,
        confidence: section.confidence,
      })),
    ),
  });

  addSourceBlock(blocks, {
    block_type: "parser_warnings",
    label: "Parser warnings",
    source: "parser",
    text: parserOutput.warnings.join("\n"),
  });

  const suppliedParentContext = parentFilingContext || parserOutput.raw.parentFilingContext;
  if (suppliedParentContext) {
    addSourceBlock(blocks, {
      block_type: "parent_filing_context",
      label: "Site-provided parent filing context",
      source: "integration",
      text: compactJson(suppliedParentContext),
    });
  }

  if (marketContext || parserOutput.raw.marketContext) {
    addSourceBlock(blocks, {
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      text: compactJson(marketContext || parserOutput.raw.marketContext),
    });
  }

  if (!blocks.some((block) => block.block_type === "cleaned_source_block" || block.block_type === "table_source_block")) {
    addSourceBlock(blocks, {
      block_type: "source_excerpt",
      label: "Fallback source excerpt",
      source: "parser_raw_excerpt",
      text: parserOutput.raw.sourceTextExcerpt,
    });
  }

  return {
    cleaned_source_blocks: dedupeSourceBlocks(blocks).slice(0, 60),
  };
}

export function routeS8Filing(parserOutput: S8ParserOutput): S8RouterDecision {
  return {
    parserGroup: "s8",
    route_action: "send_to_analysis",
    event_type: "other",
    s8_bucket: "parser_uncertain",
    analysis_reason: "parser_uncertainty_analysis_needed",
    score_hint: 0,
    reason: "S-8 classification and scoring are analysis-only; parser output is limited to cleaned source blocks and source-backed extraction.",
    evidence: parserOutput.warnings,
  };
}

export function assertS8RouterEventType(value: string): asserts value is S8ApprovedEventType {
  if (!S8_APPROVED_EVENT_TYPES.includes(value as S8ApprovedEventType)) {
    throw new Error(`Unsupported S-8 router event type: ${value}`);
  }
}

function addSourceBlock(
  blocks: S8SourceBlockPromptInput["cleaned_source_blocks"],
  block: S8SourceBlockPromptInput["cleaned_source_blocks"][number],
) {
  const text = compactSourceText(block.text);
  if (!text || text === "{}" || text === "[]") {
    return;
  }

  blocks.push({
    block_type: block.block_type || "cleaned_source_block",
    label: block.label || null,
    source: block.source || null,
    text,
  });
}

function splitSourceText(text: string, maxChunks: number): string[] {
  const normalized = normalizeSourceTextForPrompt(text);
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  const paragraphs = normalized
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z][A-Za-z\s]{2,40}:)/)
    .map((part) => part.trim())
    .filter(Boolean);
  let current = "";

  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= 5_000) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= 5_000) {
      current = paragraph;
    } else {
      for (let index = 0; index < paragraph.length && chunks.length < maxChunks; index += 5_000) {
        chunks.push(paragraph.slice(index, index + 5_000).trim());
      }
    }

    if (chunks.length >= maxChunks) {
      break;
    }
  }

  if (current && chunks.length < maxChunks) {
    chunks.push(current);
  }

  return chunks.slice(0, maxChunks);
}

function dedupeSourceBlocks(blocks: S8SourceBlockPromptInput["cleaned_source_blocks"]) {
  const seen = new Set<string>();
  const result: S8SourceBlockPromptInput["cleaned_source_blocks"] = [];

  for (const block of blocks) {
    const key = `${block.block_type}:${block.label || ""}:${block.source || ""}:${block.text.slice(0, 240)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(block);
  }

  return result;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function normalizeSourceTextForPrompt(value: string): string {
  const withInlineFacts = value
    .replace(
      /<ix:(?:nonNumeric|nonFraction)\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/ix:(?:nonNumeric|nonFraction)>/gi,
      (_match, name: string, body: string) => `${name}: ${body}\n`,
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");

  return compactSourceText(withInlineFacts, 40_000);
}

function compactSourceText(value: string, maxChars = 5_000): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxChars ? `${normalized.slice(0, Math.max(0, maxChars - 3)).trim()}...` : normalized;
}
