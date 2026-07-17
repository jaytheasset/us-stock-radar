import {
  buildCurrentFilingIdentity,
  type SecCurrentFilingIdentity,
} from "../common/currentFilingIdentity.ts";
import { PERIODIC_REPORTS_FORM_SCOPE, type PeriodicParserOutput, type PeriodicReportSection } from "./types.ts";

// Keep the analysis bundle broad enough for a full periodic report, but bounded so
// large Inline XBRL filings cannot crowd out the highest-value original sections.
const MAX_ANALYSIS_BLOCKS = 24;
const MAX_ANALYSIS_CHARS = 48_000;
const MAX_BLOCK_CHARS = 4_000;
const MAX_SECTION_BLOCKS = 14;
const MAX_TABLE_BLOCKS = 6;
const MAX_XBRL_BLOCKS = 4;
const MAX_ATTACHMENT_BLOCKS = 3;

export type SecPeriodicReportsPromptInput = {
  filing_package?: Record<string, unknown>;
  parser_output: PeriodicParserOutput;
  filing_excerpt?: string | null;
  market_context?: Record<string, unknown> | null;
  parent_filing_context?: Record<string, unknown> | null;
};

export type SecPeriodicReportsSourceBlock = {
  block_id: string;
  block_type: string;
  label: string | null;
  source: string | null;
  origin: "filing" | "xbrl" | "attachment" | "parent_context" | "market_context";
  priority: number;
  item_number: string | null;
  section_key: string | null;
  document_type: string | null;
  source_scope?: "segment_or_subset" | "unknown";
  text: string;
};

export type SecPeriodicReportsSourceBlockPromptInput = {
  current_filing: SecCurrentFilingIdentity;
  source_bundle: {
    selection_method: "periodic_report_structure";
    selected_block_count: number;
    selected_text_chars: number;
    omitted_block_count: number;
  };
  cleaned_source_blocks: SecPeriodicReportsSourceBlock[];
};

export function buildSecPeriodicReportsSourceBlockPromptInput(
  input: SecPeriodicReportsPromptInput,
): SecPeriodicReportsSourceBlockPromptInput {
  const parserOutput = input.parser_output;
  const facts = parserOutput.facts;
  const raw = parserOutput.raw || {};
  const normalized = toRecord(raw.normalized_primary_document) || {};
  const fiscalPeriodResolution = toRecord(raw.fiscal_period_resolution) || {};
  const currentFiling = buildCurrentFilingIdentity({
    filingPackage: input.filing_package,
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: PERIODIC_REPORTS_FORM_SCOPE,
  });
  const candidates: SecPeriodicReportsSourceBlock[] = [];

  addBlock(candidates, {
    block_id: "periodic-report-context",
    block_type: "report_context",
    label: "Periodic report context",
    source: "filing_package",
    origin: "filing",
    priority: 0,
    item_number: null,
    section_key: null,
    document_type: parserOutput.formType,
    text: compactJson({
      form_type: currentFiling.form_type,
      accession_number: parserOutput.accessionNumber,
      company_name: facts.companyName,
      ticker: facts.primaryTicker,
      exchange: facts.exchange,
      reporting_period: facts.reportingPeriod,
      fiscal_year: facts.fiscalYear,
      fiscal_quarter: facts.fiscalQuarter,
      fiscal_period_resolution: fiscalPeriodResolution,
      is_amendment: facts.isAmendment,
      source_url: nullableString(raw.source_url),
      published_at: nullableString(raw.published_at),
    }),
  });

  addAmendmentBlock(candidates, parserOutput);
  addAnnualCorePerformanceBlock(candidates, parserOutput);
  addQuarterlyCorePerformanceBlock(candidates, parserOutput);
  addQuarterlyCoreStatementBlock(candidates, normalized, parserOutput);
  addContextSnippetBlocks(candidates, parserOutput);
  addSectionBlocks(candidates, facts.sections);
  addTableBlocks(candidates, normalized);
  addXbrlBlocks(candidates, parserOutput);
  addAttachmentBlocks(candidates, input.filing_package);

  if (!hasSubstantiveSourceBlock(candidates)) {
    addFallbackBlocks(candidates, normalized, input.filing_excerpt);
  }

  if (input.parent_filing_context) {
    addBlock(candidates, {
      block_id: "periodic-parent-filing-context",
      block_type: "parent_filing_context",
      label: "Parent filing context",
      source: "integration",
      origin: "parent_context",
      priority: facts.isAmendment ? 2 : 30,
      item_number: null,
      section_key: null,
      document_type: null,
      text: compactJson(input.parent_filing_context),
    });
  }

  if (input.market_context) {
    addBlock(candidates, {
      block_id: "periodic-market-context",
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      origin: "market_context",
      priority: 35,
      item_number: null,
      section_key: null,
      document_type: null,
      text: compactJson(input.market_context),
    });
  }

  const deduped = dedupeBlocks(candidates).sort(compareBlocks);
  const selected = selectWithinBudget(deduped);

  return {
    current_filing: currentFiling,
    source_bundle: {
      selection_method: "periodic_report_structure",
      selected_block_count: selected.length,
      selected_text_chars: selected.reduce((total, block) => total + block.text.length, 0),
      omitted_block_count: Math.max(0, deduped.length - selected.length),
    },
    cleaned_source_blocks: selected,
  };
}

function addAnnualCorePerformanceBlock(
  blocks: SecPeriodicReportsSourceBlock[],
  parserOutput: PeriodicParserOutput,
) {
  if (
    (!parserOutput.facts.isAnnualReport && !parserOutput.facts.isForeignIssuerAnnualReport) ||
    parserOutput.facts.isAmendment
  ) return;
  const facts = selectAnnualCorePerformanceFacts(parserOutput);
  if (!facts.length) return;

  addBlock(blocks, {
    block_id: "periodic-annual-core-performance",
    block_type: "annual_core_performance_facts",
    label: "Current and immediately preceding annual performance facts",
    source: "source_package.xbrlFacts",
    origin: "xbrl",
    priority: 3,
    item_number: null,
    section_key: "annual_core_performance",
    document_type: "XBRL",
    text: compactJson(
      facts.map((fact) => ({
        name: fact.name,
        label: fact.label,
        value: fact.value,
        unit: fact.unitRef,
        period: fact.period,
        statement: fact.statement,
        source_document: fact.sourceDocument,
        has_dimensions: false,
      })),
    ),
  });
}

function selectAnnualCorePerformanceFacts(parserOutput: PeriodicParserOutput) {
  const facts = parserOutput.facts.sourcePackage.xbrlFacts.filter((fact) =>
    typeof fact.value === "number" && fact.hasDimensions !== true,
  );
  const fiscalYear = Number(parserOutput.facts.fiscalYear);
  const preferredYears = Number.isInteger(fiscalYear) ? new Set([fiscalYear, fiscalYear - 1]) : null;
  const groups: Array<{ pattern: RegExp; maximum: number }> = [
    { pattern: /^(?:revenues?|totalrevenues?|salesrevenuenet|salesrevenuegoodsnet|salesrevenueservicesnet|revenuefromcontractwithcustomerexcludingassessedtax|revenuefromcontractwithcustomerincludingassessedtax)$/i, maximum: 2 },
    { pattern: /^(?:operatingincomeloss|operatingprofitloss|profitlossfromoperatingactivities)$/i, maximum: 2 },
    { pattern: /^(?:netincomeloss|profitloss)$/i, maximum: 2 },
    { pattern: /^netcashprovidedbyusedinoperatingactivities/i, maximum: 2 },
  ];
  const selected: typeof facts = [];

  for (const group of groups) {
    const concepts = new Map<string, typeof facts>();
    for (const fact of facts) {
      const concept = fact.name.split(":").pop() || fact.name;
      if (!group.pattern.test(concept)) continue;
      const values = concepts.get(concept) || [];
      values.push(fact);
      concepts.set(concept, values);
    }

    const candidates = Array.from(concepts.values())
      .map((values) => selectComparableAnnualFacts(values, preferredYears, group.maximum))
      .filter((values) => values.length)
      .sort((left, right) => right.length - left.length);
    if (candidates[0]) selected.push(...candidates[0]);
  }

  return selected;
}

const CORE_PERFORMANCE_FACT_GROUPS = [
  {
    key: "revenue",
    pattern: /^(?:revenues?|totalrevenues?|salesrevenuenet|salesrevenuegoodsnet|salesrevenueservicesnet|revenuefromcontractwithcustomerexcludingassessedtax|revenuefromcontractwithcustomerincludingassessedtax)$/i,
  },
  {
    key: "operating_income",
    pattern: /^(?:operatingincomeloss|operatingprofitloss|profitlossfromoperatingactivities)$/i,
  },
  {
    key: "continuing_operations",
    pattern: /^(?:incomelossfromcontinuingoperations|incomelossfromcontinuingoperationsincludingportionattributabletononcontrollinginterest|profitlossfromcontinuingoperations)$/i,
  },
  {
    key: "discontinued_operations",
    pattern: /^(?:incomelossfromdiscontinuedoperationsnetoftax|discontinuedoperationincomelossnetoftax|profitlossfromdiscontinuedoperationsnetoftax)$/i,
  },
  {
    key: "net_income",
    pattern: /^(?:netincomeloss|profitloss)$/i,
  },
  {
    key: "operating_cash_flow",
    pattern: /^netcashprovidedbyusedinoperatingactivities/i,
  },
] as const;

export type PeriodicCorePerformanceFactKind = (typeof CORE_PERFORMANCE_FACT_GROUPS)[number]["key"];

export function classifyPeriodicCorePerformanceFact(name: string): PeriodicCorePerformanceFactKind | null {
  const concept = name.split(":").pop() || name;
  return CORE_PERFORMANCE_FACT_GROUPS.find((group) => group.pattern.test(concept))?.key || null;
}

export function selectQuarterlyCorePerformanceFacts(parserOutput: PeriodicParserOutput) {
  if (!parserOutput.facts.isQuarterlyReport || parserOutput.facts.isAmendment) return [];
  const facts = parserOutput.facts.sourcePackage.xbrlFacts.filter((fact) =>
    typeof fact.value === "number" && fact.hasDimensions !== true,
  );
  const selected: typeof facts = [];

  for (const group of CORE_PERFORMANCE_FACT_GROUPS) {
    const concepts = new Map<string, typeof facts>();
    for (const fact of facts) {
      const concept = fact.name.split(":").pop() || fact.name;
      if (!group.pattern.test(concept)) continue;
      const values = concepts.get(concept) || [];
      values.push(fact);
      concepts.set(concept, values);
    }

    const candidates = Array.from(concepts.values())
      .map((values) => selectComparableQuarterlyFacts(values, 2))
      .filter((values) => values.length)
      .sort((left, right) => right.length - left.length);
    if (candidates[0]) selected.push(...candidates[0]);
  }

  return selected;
}

function addQuarterlyCorePerformanceBlock(
  blocks: SecPeriodicReportsSourceBlock[],
  parserOutput: PeriodicParserOutput,
) {
  const facts = selectQuarterlyCorePerformanceFacts(parserOutput);
  if (!facts.length) return;

  addBlock(blocks, {
    block_id: "periodic-quarterly-core-performance",
    block_type: "quarterly_core_performance_facts",
    label: "Current and prior-year-quarter consolidated performance facts",
    source: "source_package.xbrlFacts",
    origin: "xbrl",
    priority: 3,
    item_number: null,
    section_key: "quarterly_core_performance",
    document_type: "XBRL",
    text: compactJson(
      facts.map((fact) => ({
        metric_kind: classifyPeriodicCorePerformanceFact(fact.name),
        name: fact.name,
        label: fact.label,
        value: fact.value,
        unit: fact.unitRef,
        period: fact.period,
        statement: fact.statement,
        source_document: fact.sourceDocument,
        has_dimensions: false,
      })),
    ),
  });
}

function addQuarterlyCoreStatementBlock(
  blocks: SecPeriodicReportsSourceBlock[],
  normalized: Record<string, unknown>,
  parserOutput: PeriodicParserOutput,
) {
  if (!parserOutput.facts.isQuarterlyReport || parserOutput.facts.isAmendment) return;
  const candidates = recordArray(normalized.blocks)
    .map((block, order) => ({
      block,
      order,
      score: quarterlyStatementBlockScore(nullableString(block.text), nullableString(block.kind)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);
  const selected = candidates[0];
  if (!selected) return;

  addBlock(blocks, {
    block_id: "periodic-quarterly-core-statement",
    block_type: "quarterly_core_statement",
    label: "Consolidated quarterly statement and operating-scope context",
    source: "normalized_primary_document.blocks",
    origin: "filing",
    priority: 4,
    item_number: null,
    section_key: "quarterly_core_statement",
    document_type: parserOutput.formType,
    text: nullableString(selected.block.text),
  });
}

function quarterlyStatementBlockScore(text: string, kind: string) {
  const value = text.toLowerCase();
  if (!value || /^table of contents\b/.test(value)) return 0;
  let score = 0;
  if (/\btotal (?:revenue|revenues|net sales)\b/.test(value)) score += 60;
  if (/\b(?:net income|net loss|profit for the period)\b/.test(value)) score += 55;
  if (/\bcontinuing operations\b/.test(value)) score += 100;
  if (/\bdiscontinued operations\b/.test(value)) score += 100;
  if (/\boperating (?:income|loss|profit)\b/.test(value)) score += 35;
  if (/table/.test(kind)) score += 15;
  return score >= 100 ? score : 0;
}

function selectComparableAnnualFacts(
  facts: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"],
  preferredYears: Set<number> | null,
  maximum: number,
) {
  const annualDurationFacts = facts.filter((fact) => isAnnualXbrlDuration(fact.period));
  const pool = annualDurationFacts.length >= 2 ? annualDurationFacts : facts;
  const selected: typeof facts = [];
  const seenYears = new Set<number>();

  for (const fact of [...pool].sort(comparePromptXbrlFacts)) {
    const year = xbrlPeriodEndYear(fact.period);
    if (preferredYears && year && !preferredYears.has(year)) continue;
    if (year && seenYears.has(year)) continue;
    if (year) seenYears.add(year);
    selected.push(fact);
    if (selected.length >= maximum) break;
  }

  if (selected.length < maximum && preferredYears) {
    for (const fact of [...pool].sort(comparePromptXbrlFacts)) {
      const year = xbrlPeriodEndYear(fact.period);
      if (selected.includes(fact) || (year && seenYears.has(year))) continue;
      if (year) seenYears.add(year);
      selected.push(fact);
      if (selected.length >= maximum) break;
    }
  }

  return selected;
}

function selectComparableQuarterlyFacts(
  facts: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"],
  maximum: number,
) {
  const quarterlyFacts = facts.filter((fact) => isQuarterlyXbrlDuration(fact.period));
  const pool = quarterlyFacts.length >= 2 ? quarterlyFacts : facts;
  const ordered = [...pool].sort(comparePromptXbrlFacts);
  if (!ordered.length) return [];

  const current = ordered[0];
  const selected = [current];
  const currentPeriod = readXbrlDuration(current.period);
  if (currentPeriod) {
    const prior = ordered.find((fact) => {
      if (fact === current) return false;
      const period = readXbrlDuration(fact.period);
      return Boolean(
        period &&
        period.endYear === currentPeriod.endYear - 1 &&
        period.startMonthDay === currentPeriod.startMonthDay &&
        period.endMonthDay === currentPeriod.endMonthDay,
      );
    });
    if (prior) selected.push(prior);
  }

  for (const fact of ordered) {
    if (selected.length >= maximum) break;
    if (selected.includes(fact)) continue;
    selected.push(fact);
  }
  return selected.slice(0, maximum);
}

function addContextSnippetBlocks(
  blocks: SecPeriodicReportsSourceBlock[],
  parserOutput: PeriodicParserOutput,
) {
  for (const [index, snippet] of parserOutput.facts.contextSnippets.entries()) {
    addBlock(blocks, {
      block_id: snippet.id,
      block_type: "context_preserving_snippet",
      label: snippet.topic.replace(/_/g, " "),
      source: snippet.source,
      origin: "filing",
      priority: contextSnippetPriority(snippet.topic) + index / 100,
      item_number: snippet.item,
      section_key: snippet.sectionKey,
      document_type: parserOutput.formType,
      source_scope: snippet.scope,
      text: snippet.text,
    });
  }
}

function contextSnippetPriority(topic: string) {
  if (topic === "annual_core_performance") return 2;
  if (topic === "company_value_context") return 4;
  if (topic === "financial_results") return 5;
  if (topic === "period_comparison") return 6;
  if (topic === "outlook_and_guidance") return 7;
  if (topic === "liquidity_and_debt") return 8;
  if (topic === "segments_and_drivers") return 9;
  if (topic === "controls_and_accounting") return 11;
  if (topic === "legal_and_regulatory") return 12;
  if (topic === "capital_allocation") return 13;
  return 20;
}

function addAmendmentBlock(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  const amendment = parserOutput.facts.amendment;
  if (!amendment.isAmendment) return;
  const text = [
    amendment.explanatoryNote,
    ...amendment.sourceEvidence,
  ]
    .filter(Boolean)
    .join("\n\n");
  addBlock(blocks, {
    block_id: "periodic-amendment-scope",
    block_type: "amendment_scope",
    label: "Amendment scope",
    source: "filing_text",
    origin: "filing",
    priority: 1,
    item_number: null,
    section_key: "amendment_scope",
    document_type: parserOutput.formType,
    text,
  });
}

function addSectionBlocks(blocks: SecPeriodicReportsSourceBlock[], sections: PeriodicReportSection[]) {
  const selected = sections
    .map((section, order) => ({ section, order, priority: sectionPriority(section) }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_SECTION_BLOCKS);

  for (const { section, order, priority } of selected) {
    addBlock(blocks, {
      block_id: stableBlockId("periodic-section", section.key || `${section.item}-${order + 1}`),
      block_type: "periodic_report_section",
      label: [section.part, `Item ${section.item}`, section.title].filter(Boolean).join(" - "),
      source: section.source,
      origin: "filing",
      priority,
      item_number: section.item,
      section_key: section.key,
      document_type: null,
      text: section.excerpt,
    });
  }
}

function sectionPriority(section: PeriodicReportSection) {
  const value = `${section.key} ${section.title}`.toLowerCase();
  if (/financial statements|operating and financial review|management.s discussion|results of operations/.test(value)) return 10;
  if (/liquidity|capital resources|going concern|defaults|delinquencies/.test(value)) return 12;
  if (/controls and procedures|internal control|certifying accountant/.test(value)) return 14;
  if (/legal proceedings|financial information/.test(value)) return 16;
  if (/risk factors|key information/.test(value)) return 18;
  if (/business|information on the company|properties/.test(value)) return 20;
  if (/market risk|share repurchase|equity securities|major shareholders|related party/.test(value)) return 22;
  if (/unregistered sales|use of proceeds|material modifications/.test(value)) return 24;
  return 40;
}

function addTableBlocks(blocks: SecPeriodicReportsSourceBlock[], normalized: Record<string, unknown>) {
  const tables = recordArray(normalized.tables)
    .filter((table) => !["layout", "toc", "exhibit_index"].includes(nullableString(table.classification).toLowerCase()))
    .filter((table) => !isTableOfContentsTable(table))
    .filter((table) => numberValue(table.numericCellCount) > 0)
    .map((table, order) => ({ table, order, priority: tablePriority(table) }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_TABLE_BLOCKS);

  for (const { table, order, priority } of tables) {
    const rows = recordArray(table.rows)
      .slice(0, 18)
      .map((row) => nullableString(row.text))
      .filter(Boolean);
    const label = nullableString(table.caption) || stringArray(table.typeHints).join(" / ") || `Financial table ${order + 1}`;
    addBlock(blocks, {
      block_id: stableBlockId("periodic-table", `${label}-${order + 1}`),
      block_type: "financial_table",
      label,
      source: "normalized_primary_document.tables",
      origin: "filing",
      priority,
      item_number: null,
      section_key: null,
      document_type: null,
      text: [
        nullableString(table.caption),
        nullableString(table.unitHint) ? `Unit: ${nullableString(table.unitHint)}` : "",
        rows.length ? rows.join("\n") : nullableString(table.text),
        ...stringArray(table.footnotes).slice(0, 4),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

function isTableOfContentsTable(table: Record<string, unknown>) {
  const value = `${nullableString(table.caption)} ${nullableString(table.text).slice(0, 500)}`
    .trim()
    .toLowerCase();
  return /^table of contents\b/.test(value) || (/\btable of contents\b/.test(value) && (value.match(/\bitem\s+\d/gi) || []).length >= 3);
}

function tablePriority(table: Record<string, unknown>) {
  const value = [nullableString(table.caption), ...stringArray(table.typeHints), nullableString(table.text).slice(0, 300)]
    .join(" ")
    .toLowerCase();
  if (/statement.*(?:operations|income|earnings)|results of operations/.test(value)) return 8;
  if (/balance sheet|financial position/.test(value)) return 9;
  if (/cash flow/.test(value)) return 10;
  if (/stockholders. equity|shareholders. equity/.test(value)) return 11;
  return 28;
}

function addXbrlBlocks(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  const grouped = new Map<string, typeof parserOutput.facts.sourcePackage.xbrlFacts>();
  for (const fact of parserOutput.facts.sourcePackage.xbrlFacts) {
    const dimensionClass = fact.hasDimensions === true ? "dimensional" : "consolidated";
    const group = `${fact.statement || "Other reported XBRL facts"}::${dimensionClass}`;
    const values = grouped.get(group) || [];
    values.push(fact);
    grouped.set(group, values);
  }

  const selectedGroups = Array.from(grouped.entries())
    .map(([group, facts], order) => {
      const [statement, dimensionClass] = group.split("::");
      const dimensional = dimensionClass === "dimensional";
      return {
        statement,
        dimensional,
        facts,
        order,
        priority: xbrlPriority(statement) + (dimensional ? 18 : 0),
      };
    })
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_XBRL_BLOCKS);

  for (const { statement, dimensional, facts, order, priority } of selectedGroups) {
    const selectedFacts = selectXbrlFactsForPrompt(facts, parserOutput);
    addBlock(blocks, {
      block_id: stableBlockId("periodic-xbrl", `${statement}-${dimensional ? "dimensional" : "consolidated"}-${order + 1}`),
      block_type: dimensional ? "xbrl_dimensional_facts" : "xbrl_statement_facts",
      label: dimensional
        ? `${statement} - dimensional segment, product, geography, or subset facts; not consolidated totals`
        : statement,
      source: "source_package.xbrlFacts",
      origin: "xbrl",
      priority,
      item_number: null,
      section_key: null,
      document_type: "XBRL",
      text: compactJson(
        selectedFacts.map((fact) => ({
          name: fact.name,
          label: fact.label,
          value: fact.value,
          unit: fact.unitRef,
          period: fact.period,
          statement: fact.statement,
          source_document: fact.sourceDocument,
          has_dimensions: fact.hasDimensions === true,
        })),
      ),
    });
  }
}

function selectXbrlFactsForPrompt(
  facts: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"],
  parserOutput: PeriodicParserOutput,
) {
  const byConcept = new Map<string, typeof facts>();
  for (const fact of facts) {
    const concept = fact.name.split(":").pop()?.toLowerCase() || fact.name.toLowerCase();
    const values = byConcept.get(concept) || [];
    if (!values.some((item) => item.period === fact.period && item.value === fact.value && item.unitRef === fact.unitRef)) {
      values.push(fact);
    }
    byConcept.set(concept, values);
  }

  const isAnnualReport =
    (parserOutput.facts.isAnnualReport || parserOutput.facts.isForeignIssuerAnnualReport) &&
    !parserOutput.facts.isAmendment;
  const fiscalYear = Number(parserOutput.facts.fiscalYear);
  const preferredYears = Number.isInteger(fiscalYear) ? new Set([fiscalYear, fiscalYear - 1]) : null;

  return Array.from(byConcept.entries())
    .sort(([left], [right]) => xbrlConceptPriority(left) - xbrlConceptPriority(right) || left.localeCompare(right))
    .flatMap(([, values]) => isAnnualReport
      ? selectComparableAnnualFacts(values, preferredYears, 2)
      : selectDistinctXbrlPeriods(values, 2))
    .slice(0, 20);
}

function selectDistinctXbrlPeriods(
  facts: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"],
  maximum: number,
) {
  const selected: typeof facts = [];
  const seen = new Set<string>();
  for (const fact of [...facts].sort(comparePromptXbrlFacts)) {
    const periodKey = fact.period || `undated:${fact.contextRef || fact.value}`;
    if (seen.has(periodKey)) continue;
    seen.add(periodKey);
    selected.push(fact);
    if (selected.length >= maximum) break;
  }
  return selected;
}

function comparePromptXbrlFacts(
  left: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"][number],
  right: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"][number],
) {
  const endDifference = xbrlPeriodEndTimestamp(right.period) - xbrlPeriodEndTimestamp(left.period);
  if (endDifference) return endDifference;
  return (right.period || "").localeCompare(left.period || "");
}

function xbrlPeriodEndTimestamp(period: string | null) {
  if (!period) return 0;
  const end = period.includes("/") ? period.split("/").pop() || "" : period;
  const timestamp = Date.parse(end);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function xbrlPeriodEndYear(period: string | null) {
  const timestamp = xbrlPeriodEndTimestamp(period);
  return timestamp ? new Date(timestamp).getUTCFullYear() : null;
}

function isAnnualXbrlDuration(period: string | null) {
  if (!period?.includes("/")) return false;
  const [start, end] = period.split("/");
  const startTimestamp = Date.parse(start || "");
  const endTimestamp = Date.parse(end || "");
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return false;
  const days = (endTimestamp - startTimestamp) / 86_400_000;
  return days >= 300 && days <= 400;
}

function isQuarterlyXbrlDuration(period: string | null) {
  const duration = readXbrlDuration(period);
  return Boolean(duration && duration.days >= 60 && duration.days <= 120);
}

function readXbrlDuration(period: string | null) {
  if (!period?.includes("/")) return null;
  const [start, end] = period.split("/");
  const startTimestamp = Date.parse(start || "");
  const endTimestamp = Date.parse(end || "");
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return null;
  const startDate = new Date(startTimestamp);
  const endDate = new Date(endTimestamp);
  return {
    days: (endTimestamp - startTimestamp) / 86_400_000,
    endYear: endDate.getUTCFullYear(),
    startMonthDay: `${startDate.getUTCMonth() + 1}-${startDate.getUTCDate()}`,
    endMonthDay: `${endDate.getUTCMonth() + 1}-${endDate.getUTCDate()}`,
  };
}

function xbrlConceptPriority(concept: string) {
  if (/revenue|salesrevenuenet/.test(concept)) return 0;
  if (/grossprofit/.test(concept)) return 1;
  if (/operatingincomeloss/.test(concept)) return 2;
  if (/netincomeloss|profitloss/.test(concept)) return 3;
  if (/earningspershare/.test(concept)) return 4;
  if (/cashandcashequivalents/.test(concept)) return 5;
  if (/assets$|liabilities$|stockholdersequity|shareholdersequity/.test(concept)) return 6;
  if (/longtermdebt|shorttermdebt|borrowings/.test(concept)) return 7;
  if (/netcashprovidedbyusedin/.test(concept)) return 8;
  if (/sharesoutstanding|weightedaveragenumberofshares/.test(concept)) return 9;
  return 20;
}

function xbrlPriority(statement: string) {
  const value = statement.toLowerCase();
  if (/operations|income|earnings|profit or loss/.test(value)) return 6;
  if (/balance sheet|financial position/.test(value)) return 7;
  if (/cash flow/.test(value)) return 8;
  if (/equity/.test(value)) return 9;
  return 30;
}

function addAttachmentBlocks(blocks: SecPeriodicReportsSourceBlock[], filingPackage: Record<string, unknown> | undefined) {
  const filing = toRecord(filingPackage);
  const rawPayload = firstRecord(filing.rawPayload, filing.raw_payload);
  const attachments = [
    ...recordArray(rawPayload.attachment_texts),
    ...recordArray(rawPayload.attachmentTexts),
    ...recordArray(rawPayload.attachments),
  ]
    .filter((attachment) => attachmentIsMaterial(attachment))
    .slice(0, MAX_ATTACHMENT_BLOCKS);

  for (const [index, attachment] of attachments.entries()) {
    const type = nullableString(attachment.type || attachment.document_type);
    const filename = nullableString(attachment.filename || attachment.name);
    addBlock(blocks, {
      block_id: stableBlockId("periodic-attachment", `${type}-${filename}-${index + 1}`),
      block_type: "material_attachment",
      label: nullableString(attachment.description || attachment.title) || type || filename || `Attachment ${index + 1}`,
      source: filename || "filing_package.raw_payload",
      origin: "attachment",
      priority: /EX-99/i.test(type) ? 13 : 26,
      item_number: null,
      section_key: null,
      document_type: type || null,
      text: nullableString(attachment.text || attachment.content || attachment.body_text),
    });
  }
}

function attachmentIsMaterial(attachment: Record<string, unknown>) {
  const type = nullableString(attachment.type || attachment.document_type);
  const description = nullableString(attachment.description || attachment.title);
  const text = nullableString(attachment.text || attachment.content || attachment.body_text);
  if (!text) return false;
  if (/EX-(?:31|32|101)|CERTIFICATION|XBRL/i.test(`${type} ${description}`)) return false;
  return /EX-(?:2|10|99)|earnings|results|presentation|investor|material agreement/i.test(`${type} ${description}`);
}

function addFallbackBlocks(
  blocks: SecPeriodicReportsSourceBlock[],
  normalized: Record<string, unknown>,
  filingExcerpt: string | null | undefined,
) {
  const originals = recordArray(normalized.blocks)
    .filter((block) => !["empty_decorative", "signature", "exhibit_index"].includes(nullableString(block.kind)))
    .filter((block) => Boolean(nullableString(block.text)))
    .slice(0, 8);

  for (const [index, block] of originals.entries()) {
    addBlock(blocks, {
      block_id: `periodic-fallback-${index + 1}`,
      block_type: nullableString(block.kind) === "table" ? "financial_table" : "source_excerpt",
      label: `Fallback source block ${index + 1}`,
      source: "normalized_primary_document.blocks",
      origin: "filing",
      priority: 60 + index,
      item_number: null,
      section_key: null,
      document_type: null,
      text: nullableString(block.text),
    });
  }

  if (!originals.length) {
    addBlock(blocks, {
      block_id: "periodic-fallback-excerpt",
      block_type: "source_excerpt",
      label: "Fallback filing excerpt",
      source: "filing_excerpt",
      origin: "filing",
      priority: 70,
      item_number: null,
      section_key: null,
      document_type: null,
      text: nullableString(filingExcerpt),
    });
  }
}

function hasSubstantiveSourceBlock(blocks: SecPeriodicReportsSourceBlock[]) {
  return blocks.some((block) => [
    "annual_core_performance_facts",
    "quarterly_core_performance_facts",
    "quarterly_core_statement",
    "context_preserving_snippet",
    "periodic_report_section",
    "financial_table",
    "xbrl_statement_facts",
    "material_attachment",
    "amendment_scope",
  ].includes(block.block_type));
}

function addBlock(blocks: SecPeriodicReportsSourceBlock[], block: SecPeriodicReportsSourceBlock) {
  const text = truncateAtBoundary(normalizeSourceText(block.text), MAX_BLOCK_CHARS);
  if (!text || text === "[]" || text === "{}") return;
  blocks.push({ ...block, text });
}

function selectWithinBudget(blocks: SecPeriodicReportsSourceBlock[]) {
  const selected: SecPeriodicReportsSourceBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    if (selected.length >= MAX_ANALYSIS_BLOCKS) break;
    if (chars + block.text.length > MAX_ANALYSIS_CHARS && selected.length > 0) continue;
    selected.push(block);
    chars += block.text.length;
  }
  return selected;
}

function compareBlocks(left: SecPeriodicReportsSourceBlock, right: SecPeriodicReportsSourceBlock) {
  return left.priority - right.priority || left.block_id.localeCompare(right.block_id);
}

function dedupeBlocks(blocks: SecPeriodicReportsSourceBlock[]) {
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const result: SecPeriodicReportsSourceBlock[] = [];
  for (const block of blocks) {
    const textKey = block.text.slice(0, 500).toLowerCase();
    if (seenIds.has(block.block_id) || seenText.has(textKey)) continue;
    seenIds.add(block.block_id);
    seenText.add(textKey);
    result.push(block);
  }
  return result;
}

function stableBlockId(prefix: string, value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${prefix}-${slug || "source"}`;
}

function normalizeSourceText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAtBoundary(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const window = value.slice(0, maxChars + 1);
  const paragraph = window.lastIndexOf("\n");
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "));
  const boundary = Math.max(paragraph, sentence);
  const cut = boundary >= maxChars * 0.6 ? boundary + 1 : window.lastIndexOf(" ");
  return `${window.slice(0, Math.max(1, cut)).trim()}...`;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = toRecord(value);
    if (Object.keys(record).length) return record;
  }
  return {};
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(nullableString).filter(Boolean) : [];
}

function nullableString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}
