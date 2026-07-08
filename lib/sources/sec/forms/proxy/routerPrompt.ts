import {
  APPROVED_PROXY_EVENT_TYPES,
  type ProxyEventType,
  type ProxyParserOutput,
} from "./parser.ts";
import type { ProxyDisplayType } from "./displayPayload.ts";
import { buildCurrentFilingIdentity, currentFilingIdentityText } from "../common/currentFilingIdentity.ts";

export interface ProxyRouterDecision {
  stage: "parser" | "router";
  usesLlm: boolean;
  analysis_needed: boolean;
  event_type: ProxyEventType;
  display_type: ProxyDisplayType;
  display_version: string;
  preliminary_action: "archive" | "analyze";
  preliminary_score: number;
  rationale: string;
  analysis_focus: string[];
}

export function buildProxyRouterPrompt(parserOutput: ProxyParserOutput): string {
  return [
    "You are routing/classifying an SEC Proxy filing for investor analysis and display payload selection.",
    "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same Proxy family.",
    "",
    "Use exactly one approved event_type. Approved event types:",
    ...APPROVED_PROXY_EVENT_TYPES.map((eventType) => `- ${eventType}`),
    "",
    "Choose the already supported display_type/display_version from cleaned_source_blocks.",
    "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as classification authority.",
    "Supported display specs:",
    "- generic / proxy_generic_v1",
    "- offering_terms / proxy_equity_plan_vote_v1",
    "- candidate_special / proxy_transaction_vote_v1",
    "- candidate_special / proxy_capital_structure_vote_v1",
    "- candidate_special / proxy_governance_vote_v1",
    "- spac_transaction_status / proxy_spac_transaction_status_v1",
    "",
    "Routing rules:",
    "- Traditional IPOs, SPAC IPOs, direct listings, IPO pricing, first trading/listing dates, or registration effectiveness tied to a new public listing route to ipo_listing.",
    "- Do not use ipo_listing for ordinary resale registrations, shelf offerings, ATM/offering dilution, already-listed issuer resale, post-closing business updates, or SPAC redemption/liquidation/de-SPAC cases unless the main event is the IPO/listing itself.",
    "- For IPO listings, keep event_type as ipo_listing and put traditional vs SPAC detail in display_payload.data.ipo_kind through the UI payload builder.",
    "- For SPAC/de-SPAC business-combination status, merger vote, redemption result, closing condition, ticker change, minimum cash condition, or de-SPAC closing update, use display_type spac_transaction_status when enough transaction facts exist.",
    "- Do not use spac_transaction_status for a plain blank-check IPO registration with no target or deal status.",
    "- Deterministic archive handling is allowed only for mechanically clear no-impact source text. Otherwise classify from cleaned_source_blocks.",
    "- Merger, acquisition, sale, or business-combination votes route to strategic_transaction.",
    "- Preliminary merger proxies can still route to strategic_transaction, but preserve warnings about placeholder dates or draft terms.",
    "- Equity-plan share reserves, authorized-share increases, or reverse splits with dilution route to dilution_risk unless the filing is mainly about exchange listing compliance.",
    "- Additional soliciting material that urges votes on an authorized-share increase, share-authorization proposal, or articles/certificate amendment to increase authorized shares routes to dilution_risk, not generic shareholder_vote.",
    "- Delisting, minimum-bid, exchange-compliance, or listing-transfer votes route to listing_risk.",
    "- Reverse stock split proposals tied to Nasdaq or NYSE minimum-bid/listing compliance route to listing_risk.",
    "- Board, governance, poison-pill, bylaw, or director-control issues route to leadership_governance unless ownership control is the clearer market issue.",
    "- Contested solicitations, third-party proxy cards, and director nominee withdrawals route to leadership_governance.",
    "- Beneficial ownership or control-block changes route to insider_ownership.",
    "- Shareholder proposals about investigations, litigation, compliance, sanctions, antitrust, or regulatory exposure route to legal_risk.",
    "- Notice-only additional materials with limited proposal detail route to shareholder_vote unless another extracted signal is stronger.",
    "- Routine meeting agendas and generic shareholder proposals route to shareholder_vote.",
    "- Use other only when the proxy facts do not fit a more specific approved type.",
    "- Return whether investor-facing analysis LLM is needed; deterministic parser archive cases do not need it.",
    "- Do not request or rely on full raw filing text. Use cleaned_source_blocks.",
    "",
    "Return compact JSON only:",
    "{",
    '  "event_type": "one approved event type",',
    '  "display_type": "generic | offering_terms | candidate_special | spac_transaction_status",',
    '  "display_version": "one supported display version",',
    '  "preliminary_action": "archive | analyze",',
    '  "analysis_needed": true,',
    '  "rationale": "short source-backed reason",',
    '  "analysis_focus": ["specific facts the analysis prompt must cover"]',
    "}",
    "",
    "cleaned_source_blocks_input:",
    JSON.stringify(buildProxySourceBlockPromptInput(parserOutput), null, 2),
  ].join("\n");
}

export function buildProxySourceBlockPromptInput(
  parserOutput: ProxyParserOutput,
  marketContext?: Record<string, unknown> | null,
): Record<string, unknown> {
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: "Proxy",
  });
  const input: Record<string, unknown> = {
    current_filing: currentFiling,
    parserVersion: parserOutput.parserVersion,
    parserGroup: parserOutput.parserGroup,
    accessionNumber: parserOutput.accessionNumber,
    source_inventory: {
      secFormType: parserOutput.raw.secFormType,
      primaryTextChars: parserOutput.raw.primaryTextChars,
      combinedTextChars: parserOutput.raw.combinedTextChars,
      attachmentNames: parserOutput.raw.attachmentNames,
      textCoverage: parserOutput.raw.textCoverage,
    },
    attachment_inventory: parserOutput.raw.attachmentInventory,
    document_inventory: parserOutput.raw.documentInventory,
    cleaned_source_blocks: [
      {
        block_type: "current_filing",
        label: "Current SEC filing identity",
        text: currentFilingIdentityText(currentFiling),
      },
      ...buildProxyCleanedSourceBlocks(parserOutput),
    ],
    parser_warnings: parserOutput.warnings,
  };

  if (marketContext) input.market_context = marketContext;
  if (parserOutput.facts.deterministic.canFinishWithoutLlm) {
    input.deterministic_archive = {
      can_finish_without_llm: true,
      reason: parserOutput.facts.deterministic.reason,
    };
  }

  return input;
}

function buildProxyCleanedSourceBlocks(parserOutput: ProxyParserOutput) {
  const blocks: Array<Record<string, unknown>> = [];

  for (const block of parserOutput.raw.importantBlocks) {
    blocks.push({
      block_type: "proxy_source_block",
      label: block.label,
      text: block.text,
    });
  }

  for (const table of parserOutput.raw.keyTableExtraction.tables) {
    blocks.push({
      block_type: "table_source_block",
      label: table.heading || table.caption || table.id,
      text: JSON.stringify(
        {
          caption: table.caption,
          heading: table.heading,
          headers: table.headers,
          sampleRows: table.sampleRows,
          warnings: table.warnings,
        },
        null,
        2,
      ),
    });
  }

  for (const reference of parserOutput.raw.supplementalAnalysis.parentReferences) {
    blocks.push({
      block_type: "proxy_parent_reference_source",
      label: "Parent proxy reference",
      text: reference.evidence,
    });
  }

  for (const signal of parserOutput.raw.supplementalAnalysis.changeSignals) {
    blocks.push({
      block_type: "proxy_supplement_source_block",
      label: signal.label,
      text: signal.sourceText,
    });
  }

  return blocks.slice(0, 60);
}

export function routeProxyFiling(parserOutput: ProxyParserOutput): ProxyRouterDecision {
  const deterministic = parserOutput.facts.deterministic;

  if (deterministic.canFinishWithoutLlm && deterministic.eventType && deterministic.suggestedScore !== null) {
    return {
      stage: "parser",
      usesLlm: false,
      analysis_needed: false,
      event_type: deterministic.eventType,
      display_type: "generic",
      display_version: "proxy_generic_v1",
      preliminary_action: "archive",
      preliminary_score: deterministic.suggestedScore,
      rationale: deterministic.reason ?? "Parser identified a deterministic proxy case.",
      analysis_focus: ["Routine annual proxy agenda", "Meeting and record dates"],
    };
  }

  return {
    stage: "router",
    usesLlm: true,
    analysis_needed: true,
    event_type: "other",
    display_type: "generic",
    display_version: "proxy_generic_v1",
    preliminary_action: "analyze",
    preliminary_score: 50,
    rationale: "Non-deterministic proxy filings must be classified by the router LLM from cleaned source blocks.",
    analysis_focus: ["Classify event_type, display_type, score urgency, and key proxy facts from cleaned_source_blocks."],
  };
}
