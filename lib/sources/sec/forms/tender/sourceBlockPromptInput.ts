import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
  type SecCurrentFilingIdentity,
} from "../common/currentFilingIdentity.ts";

export type SecTenderCleanedSourceBlock = {
  block_type: string;
  label: string | null;
  source: string | null;
  text: string;
};

export type SecTenderSourceBlockPromptInput = {
  current_filing: SecCurrentFilingIdentity;
  cleaned_source_blocks: SecTenderCleanedSourceBlock[];
};

const DEFAULT_BLOCK_LIMIT = 64;
const DEFAULT_BLOCK_CHAR_LIMIT = 4_000;
const TARGETED_SECTION_CHAR_LIMIT = 3_600;

const JUDGMENT_KEY_PATTERN =
  /(?:^|_)(?:facts?|signals?|signal|event_type|display_type|route_hint|routing|classification|classifier|score|delivery|impact|bullish|bearish|suggested|candidate|deterministic|analysis_case)(?:$|_)/i;

export function buildSecTenderSourceBlockPromptInput({
  filingPackage,
  parserOutput,
  fallbackText,
  parentFilingContext,
  marketContext,
  maxBlocks = DEFAULT_BLOCK_LIMIT,
  maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT,
}: {
  filingPackage?: Record<string, unknown> | null;
  parserOutput?: Record<string, unknown> | null;
  fallbackText?: string | null;
  parentFilingContext?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
  maxBlocks?: number;
  maxBlockChars?: number;
}): SecTenderSourceBlockPromptInput {
  const blocks: SecTenderCleanedSourceBlock[] = [];
  const filing = toRecord(filingPackage);
  const rawPayload = toRecord(filing.rawPayload);
  const parser = toRecord(parserOutput);
  const parserFacts = toRecord(parser.facts);
  const raw = toRecord(parser.raw);
  const sourcePackage = toRecord(raw.source_package);
  const sourceText = toRecord(sourcePackage.text);
  const currentFiling = buildCurrentFilingIdentity({
    filingPackage: filing,
    parserOutput: parser,
    formFamily: firstString(parser.formType),
  });

  addBlock(blocks, {
    block_type: "current_filing",
    label: "Current SEC filing identity",
    source: "filing_package",
    text: currentFilingIdentityText(currentFiling),
  });

  addBlock(blocks, {
    block_type: "filing_metadata",
    label: "SEC filing metadata",
    source: "filing_package",
    text: compactJson(
      removeJudgmentKeys({
        form_type: currentFiling.form_type,
        form_family: currentFiling.form_family,
        accession_number: firstString(parser.accessionNumber, filing.accession_number, filing.accessionNumber, rawPayload.accession_number),
        company_name: firstString(filing.company_name, filing.companyName, rawPayload.company_name),
        ticker: firstString(filing.ticker, toRecord(filing.primary_ticker).ticker, rawPayload.ticker),
        exchange: firstString(filing.exchange, toRecord(filing.primary_ticker).exchange, rawPayload.exchange),
        filed_at: firstString(filing.filed_at, filing.filedAt, filing.publishedAt, rawPayload.filing_date),
        source_url: firstString(filing.source_url, filing.sourceUrl, rawPayload.source_url, sourcePackage.source_url),
        primary_document_url: firstString(filing.primary_document_url, filing.primaryDocumentUrl, rawPayload.primary_document_url),
      }),
    ),
  });

  const filingIssuerName = firstString(filing.company_name, filing.companyName, rawPayload.company_name);
  const filingIssuerTicker = firstString(filing.ticker, toRecord(filing.primary_ticker).ticker, rawPayload.ticker);
  if (filingIssuerName || filingIssuerTicker) {
    addBlock(blocks, {
      block_type: "sec_filed_by_company",
      label: "SEC filed-by company (authoritative for filed/disclosed/submitted wording)",
      source: "filing_package",
      text: compactJson({
        company_name: filingIssuerName || null,
        ticker: filingIssuerTicker || null,
        exchange: firstString(filing.exchange, toRecord(filing.primary_ticker).exchange, rawPayload.exchange) || null,
        rule: "Use this company as the filing actor for event_title, quick_take, and summary. Other company names in exhibits are transaction parties unless this block names them.",
      }),
    });
  }

  // Preserve actual Recommendation paragraphs before the generic 14-section budget.
  // Do not turn this source coverage into a Parser recommendation classification.
  if (/^SC\s*14D-?9(?:\/A)?$/i.test(firstString(filing.form_type, rawPayload.form_type, currentFiling.form_type))) {
    for (const [value, source] of [[fallbackText, "filing_excerpt"], [sourceText.primary_excerpt, "raw.source_package.text.primary_excerpt"]] as const) {
      const text = normalizeSourceText(stringValue(value));
      const pattern = /\b(?:Item\s*4\s*[.\-]?\s*(?:The\s+)?Solicitation\s+(?:or|and)\s+Recommendation|Recommendation\s+of\s+(?:the\s+)?Board|Reasons\s+for\s+(?:the\s+)?Recommendation|recommend(?:s|ed)?\b[^.]{0,240}\b(?:accept|reject|not\s+tender|take\s+no\s+action))\b/gi;
      for (const match of findPatternMatches(text, pattern, 10)) {
        addBlock(blocks, { block_type: "tender_section_source_block", label: "Item 4 / Board Recommendation source", source, text: text.slice(Math.max(0, match.index - 240), match.index + 2800) }, maxBlockChars);
      }
    }
  }

  collectExistingSourceBlocks(raw.cleaned_source_blocks, blocks, "cleaned_source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.cleanedSourceBlocks, blocks, "cleaned_source_block", maxBlockChars);
  collectExistingSourceBlocks(parser.cleaned_source_blocks, blocks, "cleaned_source_block", maxBlockChars);
  collectExistingSourceBlocks(sourcePackage.targeted_source_blocks, blocks, "tender_attachment_section", maxBlockChars);

  collectSourceTextCandidate(sourceText.primary_excerpt, blocks, "primary_source_block", "raw.source_package.text.primary_excerpt", maxBlockChars);
  collectTargetedSectionBlocks(sourceText.primary_excerpt, blocks, "raw.source_package.text.primary_excerpt", maxBlockChars);
  collectTargetedSectionBlocks(fallbackText, blocks, "filing_excerpt", maxBlockChars, { skipWholeTextInventoryCheck: true });

  collectAttachmentTextBlocks(sourcePackage.attachment_texts, blocks, maxBlockChars);
  collectAttachmentTextBlocks(rawPayload.attachment_texts, blocks, maxBlockChars);

  collectInventoryBlocks({
    filing,
    rawPayload,
    parser,
    raw,
    sourcePackage,
    parentFilingContext,
    marketContext,
    blocks,
    maxBlockChars,
  });

  if (!hasSourceContentBlock(blocks)) {
    collectSourceTextCandidate(fallbackText, blocks, "source_excerpt", "filing_excerpt", maxBlockChars);
  }

  return {
    current_filing: currentFiling,
    cleaned_source_blocks: dedupeBlocks(blocks).slice(0, maxBlocks),
  };
}

export function removeJudgmentKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeJudgmentKeys);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (JUDGMENT_KEY_PATTERN.test(key)) continue;
    result[key] = removeJudgmentKeys(item);
  }
  return result;
}

function collectExistingSourceBlocks(
  value: unknown,
  blocks: SecTenderCleanedSourceBlock[],
  defaultType: string,
  maxBlockChars: number,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      addBlock(blocks, {
        block_type: defaultType,
        label: null,
        source: null,
        text: item,
      }, maxBlockChars);
      continue;
    }
    const record = toRecord(item);
    const text = firstString(record.text, record.sourceText, record.evidence, record.snippet, record.content);
    if (!text) continue;
    addBlock(blocks, {
      block_type: firstString(record.block_type, record.kind, record.type) || defaultType,
      label: firstString(record.label, record.heading, record.caption, record.title) || null,
      source: firstString(record.source, record.filename, record.documentType, record.document_type) || null,
      text,
    }, maxBlockChars);
  }
}

function collectAttachmentTextBlocks(value: unknown, blocks: SecTenderCleanedSourceBlock[], maxBlockChars: number) {
  const attachments = arrayRecords(value).slice(0, 12);
  for (const attachment of attachments) {
    if (isInventoryOnlyAttachment(attachment)) continue;
    const previewText = firstString(attachment.text_excerpt, attachment.snippet, attachment.text);
    const fullText = firstString(attachment.text, attachment.text_excerpt, attachment.snippet);
    if (!previewText && !fullText) continue;
    const label = firstString(attachment.description, attachment.type, attachment.role) || "Attachment source text";
    const source = firstString(attachment.url, attachment.type, attachment.role) || null;
    if (isBroadPresentationAttachment(attachment, fullText)) continue;
    collectTargetedSectionBlocks(fullText, blocks, `${label}${source ? ` (${source})` : ""}`, maxBlockChars);
    addBlock(blocks, {
      block_type: "attachment_source_block",
      label,
      source,
      text: previewText || fullText,
    }, maxBlockChars);
  }
}

function collectTargetedSectionBlocks(
  value: unknown,
  blocks: SecTenderCleanedSourceBlock[],
  source: string,
  maxBlockChars: number,
  options: { skipWholeTextInventoryCheck?: boolean } = {},
) {
  const text = stringValue(value);
  if (!text || (!options.skipWholeTextInventoryCheck && looksLikeInventoryOnlyText(text))) return;
  const matches = findTenderSectionSnippets(text);
  for (const match of matches) {
    if (looksLikeInventoryOnlyText(match.text)) continue;
    addBlock(blocks, {
      block_type: "tender_section_source_block",
      label: match.label,
      source,
      text: match.text,
    }, Math.min(maxBlockChars, TARGETED_SECTION_CHAR_LIMIT));
  }
}

function collectSourceTextCandidate(
  value: unknown,
  blocks: SecTenderCleanedSourceBlock[],
  blockType: string,
  source: string,
  maxBlockChars: number,
) {
  const text = stringValue(value);
  if (!text) return;
  addBlock(blocks, {
    block_type: blockType,
    label: source,
    source,
    text,
  }, maxBlockChars);
}

function collectInventoryBlocks({
  filing,
  rawPayload,
  parser,
  raw,
  sourcePackage,
  parentFilingContext,
  marketContext,
  blocks,
  maxBlockChars,
}: {
  filing: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  parser: Record<string, unknown>;
  raw: Record<string, unknown>;
  sourcePackage: Record<string, unknown>;
  parentFilingContext?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
  blocks: SecTenderCleanedSourceBlock[];
  maxBlockChars: number;
}) {
  const rawDataAudit = firstObject(sourcePackage.raw_data_audit, raw.raw_data_audit);
  const sourceNoise = firstObject(sourcePackage.source_noise, raw.source_noise);
  const documents = firstArray(filing.documents, sourcePackage.documents, rawPayload.documents);
  const attachmentInventory = firstArray(filing.attachment_inventory, filing.attachments, sourcePackage.attachment_texts, rawPayload.attachment_texts);
  const warnings = stringArray(parser.warnings);

  if (rawDataAudit) {
    addBlock(blocks, {
      block_type: "source_inventory",
      label: "Source inventory",
      source: "parser.raw.source_package.raw_data_audit",
      text: compactJson(removeJudgmentKeys(rawDataAudit)),
    }, maxBlockChars);
  }
  if (sourceNoise) {
    addBlock(blocks, {
      block_type: "source_noise",
      label: "Source noise summary",
      source: "parser.raw.source_package.source_noise",
      text: compactJson(removeJudgmentKeys(sourceNoise)),
    }, maxBlockChars);
  }
  if (documents.length) {
    addBlock(blocks, {
      block_type: "document_inventory",
      label: "Document inventory",
      source: "parser/raw",
      text: compactJson(removeJudgmentKeys(documents)),
    }, maxBlockChars);
  }
  if (attachmentInventory.length) {
    addBlock(blocks, {
      block_type: "attachment_inventory",
      label: "Attachment inventory",
      source: "parser/raw",
      text: compactJson(removeJudgmentKeys(compactAttachmentInventory(attachmentInventory))),
    }, maxBlockChars);
  }
  if (warnings.length) {
    addBlock(blocks, {
      block_type: "parser_warnings",
      label: "Parser warnings",
      source: "parser",
      text: warnings.join("\n"),
    }, maxBlockChars);
  }
  if (parentFilingContext) {
    addBlock(blocks, {
      block_type: "parent_filing_context",
      label: "Parent filing compact context",
      source: "integration",
      text: compactJson(removeJudgmentKeys(parentFilingContext)),
    }, maxBlockChars);
  }
  if (marketContext) {
    addBlock(blocks, {
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      text: compactJson(removeJudgmentKeys(marketContext)),
    }, maxBlockChars);
  }
}

function hasSourceContentBlock(blocks: SecTenderCleanedSourceBlock[]): boolean {
  return blocks.some((block) => {
    return ![
      "filing_metadata",
      "current_filing",
      "source_inventory",
      "source_noise",
      "attachment_inventory",
      "document_inventory",
      "parser_warnings",
      "parent_filing_context",
      "site_market_context",
    ].includes(block.block_type);
  });
}

function findTenderSectionSnippets(text: string) {
  const mustKeepPatterns = [
    {
      label: "Exchange / Ticker Identification",
      pattern: /\b(?:NYSE(?:\s+American|\s+Arca)?|Nasdaq|NASDAQ|OTC(?:QB|QX)?|Cboe)\s*:\s*[A-Z][A-Z0-9.\-]{0,9}\b/i,
      before: 700,
      after: 1_100,
    },
    {
      label: "Offer Size / Purchase Size",
      pattern: /\b(?:purchase\s+size|maximum\s+(?:purchase|repurchase)\s+(?:amount|size)|amount\s+up\s+to\s+the\s+purchase\s+size|up\s+to\s+(?:\d+(?:\.\d+)?%|all|substantially\s+all)[^.;]{0,220}(?:net\s+asset\s+value|NAV|outstanding\s+shares|shares\s+outstanding)|specifically,\s+(?:the\s+)?(?:fund|company|issuer)\s+is\s+offering\s+to\s+purchase)\b/i,
      before: 520,
      after: 3_000,
    },
    {
      label: "Aggregate Offer Value",
      pattern: /\b(?:aggregate\s+(?:purchase\s+price|offer\s+value|consideration)|maximum\s+aggregate\s+(?:purchase\s+price|amount)|not\s+to\s+exceed\s+\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion)?|up\s+to\s+\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:million|billion)?[^.;]{0,180}(?:cash|shares|aggregate|purchase))\b/i,
      before: 520,
      after: 2_800,
    },
    {
      label: "Merger Consideration / Cash-Out Price",
      pattern: /\b(?:each\s+(?:share|ADS|outstanding\s+share)[\s\S]{0,700}(?:converted\s+into|right\s+to\s+receive|cancelled\s+and\s+converted|converted\s+into\s+the\s+right\s+to\s+receive|cancelled\s+and\s+cease\s+to\s+exist)[\s\S]{0,700}(?:cash|(?:US\$|\$)\s?\d)|(?:cash\s+amount|merger\s+consideration|offer\s+price|per\s+(?:share|ADS)\s+price|per\s+(?:share|ADS)\s+merger\s+consideration)[\s\S]{0,260}(?:US\$|\$)\s?\d[\d,]*(?:\.\d+)?|(?:US\$|\$)\s?\d[\d,]*(?:\.\d+)?[\s\S]{0,160}(?:in\s+cash|per\s+(?:share|ADS)|Merger\s+Consideration|Per\s+(?:Share|ADS)\s+Price))\b/i,
      before: 700,
      after: 3_000,
    },
    {
      label: "Per-Share Cash Consideration",
      pattern: /\b(?:cash\s+equal\s+to|cash\s+in\s+an\s+amount\s+per\s+(?:share|ADS)\s+equal\s+to|amount\s+in\s+cash\s+equal\s+to|right\s+to\s+receive\s+cash\s+in\s+an\s+amount\s+per\s+(?:share|ADS)\s+equal\s+to|right\s+to\s+receive\s+an\s+amount\s+in\s+cash\s+equal\s+to|right\s+to\s+receive)\s*(?:US\$|\$)\s?\d[\d,]*(?:\.\d+)?[\s\S]{0,260}(?:per\s+(?:share|ADS)|Merger\s+Consideration|Per\s+(?:Share|ADS)\s+Price)\b/i,
      before: 900,
      after: 3_200,
    },
    {
      label: "Unaffected / Reference Market Price",
      pattern: /\b(?:unaffected\s+(?:closing\s+)?price|last\s+full\s+(?:trading\s+day|day\s+of\s+trading)[\s\S]{0,420}(?:before|prior\s+to)[\s\S]{0,260}(?:public\s+announcement|announcement\s+of\s+the\s+(?:transaction|offer|merger)|merger\s+agreement)|closing\s+(?:sale\s+)?price[\s\S]{0,220}(?:before|prior\s+to)[\s\S]{0,220}(?:public\s+announcement|announcement\s+of\s+the\s+(?:transaction|offer|merger)))\b/i,
      before: 700,
      after: 3_000,
    },
    {
      label: "NAV Purchase Price",
      pattern: /\b(?:(?:purchased|purchase\s+price|price|proceeds)[^.;]{0,260}(?:net\s+asset\s+value|NAV)[^.;]{0,220}(?:valuation\s+date|per\s+share|shares?\s+tendered)|net\s+asset\s+value\s+per\s+share\s+calculated\s+as\s+of\s+the\s+valuation\s+date|amount\s+of\s+which\s+will\s+be\s+determined\s+as\s+of\s+the\s+valuation\s+date)\b/i,
      before: 520,
      after: 3_000,
    },
    {
      label: "Shares Sought / Tender Cap",
      pattern: /\b(?:all\s+(?:outstanding\s+)?shares\s+tendered|shares\s+in\s+excess\s+of\s+\d+(?:\.\d+)?%|increase\s+the\s+number\s+of\s+shares\s+accepted|accepted\s+for\s+payment\s+on\s+a\s+pro\s+rata\s+basis)\b/i,
      before: 520,
      after: 2_800,
    },
  ];
  const sectionPatterns = [
    { label: "Summary Term Sheet", pattern: /\bsummary\s+term\s+sheet\b/i },
    { label: "Terms of the Offer", pattern: /\b(?:terms\s+of\s+(?:the\s+)?offer|terms\s+of\s+(?:the\s+)?transaction|the\s+offer)\b/i },
    { label: "Tender / CB Rule / Transaction Type", pattern: /\b(?:Rule\s+13e-4\s*\(\s*h\s*\)\s*\(\s*8\s*\)|Rule\s+14d-1\s*\(\s*c\s*\)|Rule\s+14e-2\s*\(\s*d\s*\)|rights\s+offering|exchange\s+offer|issuer\s+tender\s+offer|third-party\s+tender\s+offer|subject\s+company\s+response)\b/i },
    { label: "Home Jurisdiction Disclosure", pattern: /\b(?:home\s+jurisdiction|foreign\s+private\s+issuer|foreign\s+issuer|English\s+(?:translation|summary)|summary\s+of\s+the\s+foreign|local\s+jurisdiction|jurisdiction\s+of\s+incorporation)\b/i },
    { label: "Shareholder Meeting / Scheme", pattern: /\b(?:notice\s+of\s+(?:special|extraordinary|annual)\s+meeting|shareholders?\s+meeting|general\s+meeting|extraordinary\s+general\s+meeting|scheme\s+of\s+arrangement|plan\s+of\s+arrangement|explanatory\s+(?:statement|notes?))\b/i },
    { label: "Transaction / Offer Document", pattern: /\b(?:cross-border|business\s+combination|arrangement\s+agreement|implementation\s+agreement|takeover\s+bid|take-over\s+bid|tender\s+offer|offer\s+document|offer\s+circular|product\s+disclosure\s+statement)\b/i },
    { label: "Purchase Price / Offer Price / NAV", pattern: /\b(?:purchase\s+price|offer\s+price|price\s+range|net\s+asset\s+value|NAV)\b/i },
    { label: "Expiration Date", pattern: /\b(?:expiration\s+(?:date|time)|offer\s+will\s+expire|unless\s+(?:the\s+)?offer\s+is\s+extended)\b/i },
    { label: "Withdrawal Rights", pattern: /\bwithdrawal\s+rights?\b/i },
    { label: "Conditions of the Offer", pattern: /\bconditions?\s+(?:of|to)\s+(?:the\s+)?(?:offer|tender\s+offer)\b/i },
    { label: "Financing", pattern: /\b(?:financing|source\s+and\s+amount\s+of\s+funds|source\s+of\s+funds)\b/i },
    { label: "Proration / Oversubscription", pattern: /\b(?:proration|prorated|oversubscription|oversubscribed)\b/i },
    { label: "Purpose of the Offer", pattern: /\bpurpose\s+of\s+(?:the\s+)?offer\b/i },
    { label: "Extension / Amendment / Termination", pattern: /\b(?:extension|extended|amendment|amends\s+and\s+supplements|termination|terminated)\b/i },
  ];
  const seen = new Set<string>();
  const snippets: Array<{ label: string; text: string }> = [];
  for (const section of mustKeepPatterns) {
    const matches = findPatternMatches(text, section.pattern, 2);
    for (const match of matches) {
      addSnippet(section.label, match.index, section.before, section.after);
    }
  }
  for (const section of sectionPatterns) {
    const match = section.pattern.exec(text);
    if (!match || match.index === undefined) continue;
    addSnippet(section.label, match.index, 280, 2_200);
  }

  return snippets.slice(0, 14);

  function addSnippet(label: string, index: number, before: number, after: number) {
    const start = Math.max(0, index - before);
    const end = Math.min(text.length, index + after);
    const snippet = text.slice(start, end);
    const key = `${label}:${compactText(snippet, 180).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    snippets.push({ label, text: snippet });
  }
}

function findPatternMatches(text: string, pattern: RegExp, limit: number) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const matches: Array<{ index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = globalPattern.exec(text)) && matches.length < limit) {
    matches.push({ index: match.index });
    if (match.index === globalPattern.lastIndex) globalPattern.lastIndex += 1;
  }
  return matches;
}

function isInventoryOnlyAttachment(attachment: Record<string, unknown>) {
  const descriptor = [
    attachment.type,
    attachment.description,
    attachment.role,
    attachment.url,
    attachment.filename,
    attachment.document,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
  return looksLikeInventoryOnlyDescriptor(descriptor) || looksLikeInventoryOnlyText(firstString(attachment.text_excerpt, attachment.text, attachment.snippet));
}

function looksLikeInventoryOnlyDescriptor(value: string) {
  return /\b(?:EX-FILING\s*FEES?|EX-107|FILING\s+FEE|GRAPHIC|IMAGE|XML|XBRL|JSON|ZIP)\b/i.test(value) ||
    /\.(?:xml|xsd|json|zip|jpg|jpeg|png|gif|svg|css|js)(?:\b|$)/i.test(value);
}

function isBroadPresentationAttachment(attachment: Record<string, unknown>, text: string) {
  const descriptor = [
    attachment.type,
    attachment.description,
    attachment.role,
    attachment.url,
    attachment.filename,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
  const sample = text.slice(0, 4_000);
  return /\b(?:EX-99\.\(C\)|fairness|presentation|discussion\s+materials|board\s+materials|financial\s+advisor|banker)\b/i.test(descriptor) ||
    /\b(?:CONFIDENTIAL\s+PROJECT|Confidential\s+Discussion\s+Materials|Preliminary\s+Discussion\s+Materials|DRAFT\s+[-–]\s+Preliminary|Table\s+of\s+Contents|Financial\s+Advisor\s+Presentation)\b/i.test(sample);
}

function compactAttachmentInventory(attachments: unknown[]) {
  return attachments.map((item) => {
    const attachment = toRecord(item);
    return {
      index: attachment.index,
      type: attachment.type,
      description: attachment.description,
      role: attachment.role,
      noise_category: attachment.noise_category,
      llm_relevance: attachment.llm_relevance,
      noise_flags: attachment.noise_flags,
      text_char_count: attachment.text_char_count,
      text_available: attachment.text_available,
      url: attachment.url,
      filename: attachment.filename,
    };
  });
}

function looksLikeInventoryOnlyText(value: string) {
  const text = stringValue(value);
  if (!text) return false;
  if (/\b(?:calculation\s+of\s+filing\s+fee|filing\s+fee\s+table|transaction\s+valuation)\b/i.test(text)) return true;
  if (/\bfiling\s+fee\b/i.test(text) && /\b(?:calculated\s+solely|Rule\s*0-?11|fee\s+rate|value\s+of\s+the\s+transaction)\b/i.test(text)) {
    return true;
  }
  if (/<(?:script|style)\b/i.test(text)) return true;
  if (/\b(?:XBRL\s+DOCUMENT|XML\s+DOCUMENT)\b/i.test(text)) return true;
  const tagHits = (text.match(/<\/?[a-z][^>]{0,120}>/gi) || []).length;
  const wordHits = (text.match(/[A-Za-z]{3,}/g) || []).length;
  return tagHits > 100 && wordHits < tagHits * 2;
}

function addBlock(blocks: SecTenderCleanedSourceBlock[], block: SecTenderCleanedSourceBlock, maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT) {
  const text = compactText(block.text, maxBlockChars);
  if (!text) return;
  blocks.push({
    block_type: block.block_type || "source_block",
    label: block.label || null,
    source: block.source || null,
    text,
  });
}

function dedupeBlocks(blocks: SecTenderCleanedSourceBlock[]) {
  const seen = new Set<string>();
  const result: SecTenderCleanedSourceBlock[] = [];
  for (const block of blocks) {
    const key = `${block.block_type}:${block.label || ""}:${block.text.slice(0, 240)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(block);
  }
  return result;
}

function firstObject(...values: unknown[]) {
  for (const value of values) {
    const record = toRecord(value);
    if (Object.keys(record).length) return record;
  }
  return null;
}

function firstArray(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function compactText(value: string, maxChars: number) {
  const text = normalizeSourceText(value);
  if (!text || text === "{}" || text === "[]") return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}

function normalizeSourceText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|table|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, (entity) => decodeHtmlEntities(entity))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;|&#x00a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&ldquo;|&rdquo;/gi, "\"")
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&mdash;|&ndash;/gi, "-")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}
