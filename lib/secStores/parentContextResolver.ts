import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSec425TransactionContextMatchPlan,
  normalizeSec425TransactionContextForm,
  SEC_425_TRANSACTION_CONTEXT_VERSION,
  type Sec425RankedTransactionContextCandidate,
  type Sec425TransactionContextCandidate,
} from "@/lib/sources/sec/forms/425/transactionContext";
import { parseSc13Filing } from "@/lib/sources/sec/forms/sc13/parser";
import type { Sc13ParserOutput } from "@/lib/sources/sec/forms/sc13/types";
import { parseSecS3Filing, type SecS3FilingFacts } from "@/lib/sources/sec/forms/s3-f3/parser";
import {
  isMatchingNtLifecyclePeriod,
  readPeriodicReportingPeriodFromFilingPackage,
  readPeriodicReportingPeriodFromRawRow,
} from "@/lib/secStores/periodicParentPeriod";
import { supabaseSelect } from "@/lib/supabase";

export type SecRawItemRow = Record<string, unknown>;

type OwnershipPreParserParent = {
  parent_filing_context: Record<string, unknown>;
  original_filing?: Record<string, unknown> | null;
};

type OwnershipParentSearchHints = {
  companyCiks: string[];
  ownerCiks: string[];
  ownerNames: string[];
  reportDates: string[];
  referencedDates: string[];
  filedDate: string;
  formType: string;
};

type Sc13ParentMatchFacts = {
  scheduleType: string;
  reportingPersons: string[];
  cusip: string;
  securityClass: string;
};

type ExplicitCurrentReportParentReference = {
  formType: "8-K" | "6-K";
  filedDate: string;
  accessionNumber: string;
  source: "referenced_filings" | "amendment_parent_filed_date";
};

const PERIODIC_PARENT_CONTEXT_FAMILIES = new Set([
  "10-K",
  "10-Q",
  "20-F",
  "40-F",
  "NT 10-K",
  "NT 10-Q",
  "NT 20-F",
]);

export async function prepareSecRawItemWithParentContextForParser(rawItem: SecRawItemRow): Promise<SecRawItemRow> {
  const ownershipParent = await findOwnershipAmendmentParentBeforeParser(rawItem);
  return ownershipParent ? addParentContextToRawItemForParser(rawItem, ownershipParent) : rawItem;
}

export async function attachSecParentContexts(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  await attachParentRegistrationContext(input, rawItem);
  await attachTenderParentFilingContext(input, rawItem);
  await attachS1F1AmendmentParentFilingContext(input, rawItem);
  await attachEffectParentFilingContext(input, rawItem);
  await attachGenericAmendmentParentFilingContext(input, rawItem);
  await attachNtLifecycleFilingContext(input, rawItem);
  await attachSec425TransactionFilingContext(input, rawItem);
}

async function attachNtLifecycleFilingContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;

  const currentForm = normalizeSecFormForParentContext(
    stringValue(filingPackage.form_type) || readRawFormType(rawItem),
  );
  if (!["10-K", "10-Q", "20-F"].includes(currentForm)) return;

  const reportingPeriod = readPeriodicReportingPeriodFromInput(input);
  if (!reportingPeriod) return;

  const currentAccession = readRawAccession(rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at) || readRawFiledDate(rawItem));
  const currentCik = normalizeCik(readRawCik(rawItem));
  const currentTicker = readRawTicker(rawItem);
  const candidateRows = (await fetchGenericAmendmentParentCandidateRows(rawItem))
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => isMatchingNtLifecyclePeriod({
      reportForm: currentForm,
      noticeForm: readRawFormType(row),
      reportPeriod: reportingPeriod,
      noticePeriod: readPeriodicReportingPeriodFromRawRow(row),
    }))
    .filter((row) => {
      const rowCik = normalizeCik(readRawCik(row));
      const rowTicker = readRawTicker(row);
      return Boolean(
        (currentCik && rowCik === currentCik) ||
        (!currentCik && currentTicker && rowTicker === currentTicker),
      );
    })
    .filter((row) => {
      const rowFiledAt = Date.parse(stringValue(row.published_at) || readRawFiledDate(row));
      return !Number.isFinite(currentFiledAt) || !Number.isFinite(rowFiledAt) || rowFiledAt < currentFiledAt;
    })
    .sort((left, right) => Date.parse(stringValue(right.published_at)) - Date.parse(stringValue(left.published_at)));
  const selectedRow = candidateRows[0];
  if (!selectedRow) return;

  const selected = await compactGenericParentRow(selectedRow);
  const existingFilingContext = readRecord(filingPackage.filing_context) || {};
  filingPackage.filing_context = {
    ...existingFilingContext,
    nt_lifecycle: {
      version: "v1",
      status: "delayed_report_filed",
      reporting_period: reportingPeriod,
      match_confidence: "high",
      match_method: "same_issuer_form_reporting_period",
      match_reasons: ["same_issuer", "matching_nt_form", "same_reporting_period", "filed_before_report"],
      delayed_report: {
        accession_number: currentAccession || null,
        form_type: currentForm,
        filed_at: stringValue(rawItem.published_at) || readRawFiledDate(rawItem) || null,
      },
      selected_filings: [{ ...selected, match_source: "nt_lifecycle" }],
      source_notes: [
        "The late-filing notice is linked only by issuer, base report form, and exact reporting period.",
        "This lifecycle context is display metadata and is excluded from the periodic-report analysis prompt.",
      ],
    },
  };
}

async function attachSec425TransactionFilingContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parserOutput = readRecord(hardParsers?.["425"]);
  if (!filingPackage || !parserOutput) return;

  const existingFilingContext = readRecord(filingPackage.filing_context) || {};
  if (readRecord(existingFilingContext.related_transaction)) return;

  const facts = readRecord(parserOutput.facts) || {};
  const deal = readRecord(facts.deal) || {};
  const offer = readRecord(facts.offer) || {};
  const spac = readRecord(facts.spac) || {};
  const current = {
    accession_number: stringValue(parserOutput.accessionNumber) || readRawAccession(rawItem) || null,
    filed_at:
      stringValue(readRecord(parserOutput.raw)?.publishedAt) ||
      stringValue(rawItem.published_at) ||
      readRawFiledDate(rawItem) ||
      null,
    cik: normalizeCik(readRawCik(rawItem)) || null,
    ticker: stringValue(facts.primary_ticker) || readRawTicker(rawItem) || null,
    company_name: stringValue(facts.company_name) || readRawCompanyName(rawItem) || null,
    related_names: uniqueStrings([
      ...readStringArray(facts.transaction_parties),
      ...readStringArray(deal.parties),
      stringValue(facts.subject_company),
      stringValue(offer.subject_company),
      stringValue(spac.spac_name),
      stringValue(spac.target_name),
      stringValue(spac.combined_company_name),
    ]),
  };

  const candidateRows = (await fetchSec425TransactionCandidateRows(rawItem, current.ticker || ""))
    .filter((row) => readRawAccession(row) !== current.accession_number)
    .filter((row) => isSec425TransactionContextCandidateForm(readRawFormType(row)))
    .filter((row) => isPriorSecFiling(row, current.filed_at))
    .sort((left, right) => Date.parse(stringValue(right.published_at)) - Date.parse(stringValue(left.published_at)))
    .slice(0, 24);

  const compactCandidates = await Promise.all(candidateRows.map(compactGenericParentCandidateRow));
  const candidates: Sec425TransactionContextCandidate[] = compactCandidates.map((candidate) => ({
    raw_item_id: stringValue(candidate.raw_item_id),
    event_id: stringValue(candidate.event_id) || null,
    accession_number: stringValue(candidate.accession_number) || null,
    form_type: stringValue(candidate.form_type) || null,
    filed_at: stringValue(candidate.filed_at) || null,
    cik: normalizeCik(stringValue(candidate.cik)) || null,
    ticker: stringValue(candidate.ticker) || null,
    company_name: stringValue(candidate.company_name) || null,
    event_type: stringValue(candidate.event_type) || null,
    event_title: stringValue(candidate.event_title) || null,
    quick_take: stringValue(candidate.quick_take) || null,
    summary: stringValue(candidate.summary) || null,
    transaction_fingerprint: readRecord(candidate.transaction_fingerprint),
  }));
  const matchPlan = buildSec425TransactionContextMatchPlan(current, candidates);
  const rowById = new Map(candidateRows.map((row) => [stringValue(row.id), row]));
  const selected = await Promise.all(
    matchPlan.selected.map(async (match) => {
      const row = rowById.get(match.raw_item_id);
      if (!row) return null;
      const compact = await compactGenericParentRow(row);
      return compactSec425SelectedTransactionContext(compact, match);
    }),
  );

  filingPackage.filing_context = {
    ...existingFilingContext,
    related_transaction: {
      version: SEC_425_TRANSACTION_CONTEXT_VERSION,
      context_kind: "sec_425_related_transaction",
      source: "persisted_raw_items_events_analysis_compact",
      status: matchPlan.status,
      confidence: matchPlan.confidence,
      current_filing: current,
      selected_filings: selected.filter(Boolean),
      candidates: matchPlan.candidates.map((candidate) => ({
        raw_item_id: candidate.raw_item_id,
        event_id: candidate.event_id,
        accession_number: candidate.accession_number,
        form_type: candidate.form_type,
        filed_at: candidate.filed_at,
        company_name: candidate.company_name,
        ticker: candidate.ticker,
        event_type: candidate.event_type,
        quick_take: candidate.quick_take,
        match_score: candidate.match_score,
        match_reasons: candidate.match_reasons,
      })),
      source_notes: [
        "Only prior filings with an existing saved analysis are eligible.",
        "Related filings are display-only navigation for Form 425 pages.",
        "Historical analysis and filing text are excluded from the Form 425 router and analysis prompts.",
        "The current Form 425 is classified and analyzed independently from this related-filings list.",
      ],
    },
  };
}

async function findOwnershipAmendmentParentBeforeParser(rawItem: SecRawItemRow): Promise<OwnershipPreParserParent | null> {
  const formType = readRawFormType(rawItem);
  if (!isOwnershipAmendmentFormForParentParser(formType)) return null;

  const currentAccession = readRawAccession(rawItem);
  const currentHints = readOwnershipParentSearchHints(rawItem);
  const explicitParentAccession = extractExplicitParentAccessionFromRawItem(rawItem);
  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    if (row && readRawAccession(row) !== currentAccession && isOwnershipParentFamilyMatch(formType, readRawFormType(row))) {
      const context = await buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["explicit_parent_accession"],
        rawItem,
        parentRow: row,
        candidateRows: [row],
      });
      return {
        parent_filing_context: context,
        original_filing: buildOwnershipOriginalFilingInput(row),
      };
    }
  }

  const candidateRows = await fetchGenericAmendmentParentCandidateRows(rawItem, currentHints);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => isOwnershipParentFamilyMatch(formType, readRawFormType(row)))
    .map((row) => {
      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 365) return null;

      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const rowHints = readOwnershipParentSearchHints(row);
      const sameOwnerCik = intersects(currentHints.ownerCiks, rowHints.ownerCiks);
      const sameOwnerName = intersects(currentHints.ownerNames, rowHints.ownerNames);
      const targetDates = uniqueStrings([...currentHints.reportDates, ...currentHints.referencedDates]);
      const candidateDates = uniqueStrings([...rowHints.reportDates, rowHints.filedDate]);
      const matchReasons: string[] = ["ownership_amendment_parent_candidate"];
      let score = 90;

      if (currentCik && rowCik && currentCik === rowCik) {
        score += 90;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 45;
        matchReasons.push("same_ticker");
      }
      if (sameOwnerCik) {
        score += 180;
        matchReasons.push("same_reporting_owner_cik");
      } else if (sameOwnerName) {
        score += 90;
        matchReasons.push("same_reporting_owner_name");
      } else if (currentHints.ownerCiks.length || currentHints.ownerNames.length) {
        score -= 60;
        matchReasons.push("reporting_owner_not_matched");
      }
      if (intersects(targetDates, candidateDates)) {
        score += 160;
        matchReasons.push("report_or_referenced_date_match");
      }
      if (!isOwnershipAmendmentFormForParentParser(readRawFormType(row))) {
        score += 80;
        matchReasons.push("non_amendment_parent_preferred");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 40;
        else if (rowAgeDays <= 180) score += 20;
        else score += 5;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }

      return {
        row,
        score,
        matchReasons,
        matchMethod:
          sameOwnerCik && intersects(targetDates, candidateDates)
            ? "ownership_owner_cik_report_date_parent"
            : sameOwnerCik || sameOwnerName
              ? "ownership_reporting_owner_recent_parent"
              : "ownership_same_issuer_recent_parent",
      };
    })
    .filter((item): item is { row: SecRawItemRow; score: number; matchReasons: string[]; matchMethod: string } => Boolean(item))
    .filter((item) => item.score >= 150)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  const second = scored[1];
  if (!best) {
    const context = await buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "none",
      matchScore: 0,
      matchReasons: ["no_ownership_parent_candidate_found_before_parser"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
    return {
      parent_filing_context: context,
      original_filing: null,
    };
  }

  const ambiguous = second && best.score - second.score < 20;
  const context = await buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : best.score >= 220 ? "high" : "medium",
    matchMethod: best.matchMethod,
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });

  return {
    parent_filing_context: context,
    original_filing: ambiguous ? null : buildOwnershipOriginalFilingInput(best.row),
  };
}

function addParentContextToRawItemForParser(rawItem: SecRawItemRow, parent: OwnershipPreParserParent): SecRawItemRow {
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  return {
    ...rawItem,
    raw_payload: {
      ...rawPayload,
      parent_filing_context: parent.parent_filing_context,
      ...(parent.original_filing ? { ownership_original_filing: parent.original_filing } : {}),
    },
    metadata: {
      ...metadata,
      parent_filing_context: parent.parent_filing_context,
    },
  };
}

async function attachParentRegistrationContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  const amendmentFormType = stringValue(amendment?.form_type) || stringValue(filingPackage?.form_type);
  const amendmentNumber = numberValue(amendment?.amendment_number) || 0;
  const isAmendment =
    isS3F3RegistrationAmendmentForm(amendmentFormType) ||
    amendmentNumber > 0 ||
    amendment?.is_amendment === true ||
    amendment?.isAmendment === true;
  if (!filingPackage || !s3 || !amendment || !isAmendment) return;

  const registrationNumber =
    stringValue(readRecord(amendment.registration_number)?.value) || stringValue(amendment.registration_number);
  if (!registrationNumber) {
    filingPackage.parent_registration_context = buildMissingParentS3Context("missing_registration_number");
    return;
  }

  filingPackage.parent_registration_context = await findParentS3RegistrationContext({
    currentAccession: stringValue(filingPackage.accession_number) || stringValue(rawItem.source_unique_id),
    rawItem,
    registrationNumber,
  });
}

async function attachTenderParentFilingContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  if (!isTenderParentContextInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_filing_context)) return;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (!isSecAmendmentFormForParentContext(formType)) return;

  const parentContext = await findTenderAmendmentParentFilingContext({
    input,
    rawItem,
    formType,
  });
  if (parentContext) filingPackage.parent_filing_context = parentContext;
}

async function attachS1F1AmendmentParentFilingContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  if (!isS1F1ParentContextInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_filing_context)) return;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (!isS1F1AmendmentParentContextForm(formType)) return;

  const parentContext = await findS1F1AmendmentParentFilingContext({
    input,
    rawItem,
    formType,
  });
  if (parentContext) filingPackage.parent_filing_context = parentContext;
}

function isTenderParentContextInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const adapter = readRecord(filingPackage?.form_adapter);
  return Boolean(readRecord(hardParsers?.tender)) && stringValue(adapter?.parserGroup) === "tender";
}

function isS1F1ParentContextInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  return Boolean(readRecord(hardParsers?.["s1-f1"]) || readRecord(hardParsers?.s1_f1));
}

async function attachGenericAmendmentParentFilingContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_filing_context)) return;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (!isSecAmendmentFormForParentContext(formType)) return;
  if (isS3F3RegistrationAmendmentForm(formType)) return;

  filingPackage.parent_filing_context = await findGenericAmendmentParentFilingContext({
    input,
    rawItem,
    formType,
  });
}

async function findTenderAmendmentParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: SecRawItemRow;
  formType: string;
}) {
  const currentFamily = normalizeGenericParentFormFamily(formType);
  if (!isTenderParentContextFamily(currentFamily)) return null;

  const currentAccession = readRawAccession(rawItem);
  const explicitParentAccession = extractExplicitParentAccessionForAmendment(input, rawItem);
  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    if (row && readRawAccession(row) !== currentAccession) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["explicit_parent_accession"],
        rawItem,
        parentRow: row,
        candidateRows: [row],
      });
    }
  }

  const candidateRows = await fetchTenderParentCandidateRows(input, rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));

  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .map((row) => {
      const rowFamily = normalizeGenericParentFormFamily(readRawFormType(row));
      if (!isTenderParentContextFamily(rowFamily)) return null;

      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 1095) return null;

      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const matchReasons: string[] = [];
      let score = 0;

      if (rowFamily === currentFamily) {
        score += 100;
        matchReasons.push("same_tender_form_family");
      } else if (isTenderParentContextFamily(rowFamily)) {
        score += 45;
        matchReasons.push("same_tender_context_family");
      }
      if (currentCik && rowCik && currentCik === rowCik) {
        score += 90;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 45;
        matchReasons.push("same_ticker");
      }
      if (!isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 40;
        matchReasons.push("non_amendment_parent_preferred");
      } else {
        score += 10;
        matchReasons.push("prior_amendment_candidate");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 35;
        else if (rowAgeDays <= 180) score += 20;
        else if (rowAgeDays <= 365) score += 10;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }

      return {
        row,
        score,
        matchReasons,
        matchMethod: "tender_same_issuer_form_family_recent",
      };
    })
    .filter((item): item is { row: SecRawItemRow; score: number; matchReasons: string[]; matchMethod: string } => Boolean(item))
    .filter((item) => item.score >= 120)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) {
    return buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "tender_same_issuer_form_family_recent",
      matchScore: 0,
      matchReasons: ["no_prior_tender_parent_candidate_found"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
  }

  const second = scored[1];
  const ambiguous = second && best.score - second.score < 20;
  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : best.score >= 200 ? "high" : "medium",
    matchMethod: best.matchMethod,
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

async function findS1F1AmendmentParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: SecRawItemRow;
  formType: string;
}) {
  const currentAccession = readRawAccession(rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentFamily = normalizeGenericParentFormFamily(formType);
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const targetFileNumbers = readS1F1ParentRegistrationFileNumbers(input);
  const directFileNumberRows = targetFileNumbers.length
    ? await fetchRegistrationFileNumberCandidateRows(targetFileNumbers)
    : [];
  const candidateRows = dedupeRawRows([
    ...directFileNumberRows,
    ...(await fetchGenericAmendmentParentCandidateRows(rawItem)),
  ]);

  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .map((row) => {
      const rowFamily = normalizeGenericParentFormFamily(readRawFormType(row));
      if (!isS1F1ParentContextFamily(rowFamily) || rowFamily !== currentFamily) return null;

      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 1095) return null;

      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const rowFileNumbers = extractRegistrationFileNumbersFromRow(row);
      const matchedFileNumbers = intersectStrings(targetFileNumbers, rowFileNumbers);
      const matchReasons: string[] = ["s1_f1_amendment_parent_candidate"];
      let score = 0;

      if (matchedFileNumbers.length) {
        score += 220 + Math.min(60, matchedFileNumbers.length * 20);
        matchReasons.push(...matchedFileNumbers.slice(0, 3).map((fileNumber) => `matches_${fileNumber}`));
      } else if (targetFileNumbers.length) {
        return null;
      }

      if (currentCik && rowCik && currentCik === rowCik) {
        score += 90;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 30;
        matchReasons.push("same_ticker");
      }
      if (rowFamily === currentFamily) {
        score += 60;
        matchReasons.push("same_s1_f1_form_family");
      }
      if (isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 20;
        matchReasons.push("prior_amendment_candidate");
      } else {
        score += 30;
        matchReasons.push("non_amendment_parent_candidate");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 35;
        else if (rowAgeDays <= 180) score += 20;
        else if (rowAgeDays <= 365) score += 10;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }

      return {
        row,
        score,
        matchReasons,
        matchedFileNumbers,
        matchMethod: matchedFileNumbers.length ? "s1_f1_registration_file_number" : "s1_f1_same_issuer_recent_prior",
      };
    })
    .filter(
      (
        item,
      ): item is {
        row: SecRawItemRow;
        score: number;
        matchReasons: string[];
        matchedFileNumbers: string[];
        matchMethod: string;
      } => Boolean(item),
    )
    .filter((item) => item.score >= (targetFileNumbers.length ? 250 : 160))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) return null;

  const second = scored[1];
  const exactFileNumberMatch = best.matchedFileNumbers.length > 0;
  const ambiguous = !exactFileNumberMatch && second && best.score - second.score < 20;

  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: exactFileNumberMatch ? "high" : ambiguous ? "medium" : best.score >= 190 ? "high" : "medium",
    matchMethod: ambiguous ? "s1_f1_same_issuer_multiple_candidates" : best.matchMethod,
    matchScore: best.score,
    matchReasons: ambiguous
      ? [...best.matchReasons, "multiple_s1_f1_parent_candidates"]
      : best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

async function attachEffectParentFilingContext(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_filing_context)) return;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (normalizeSecFormForParentContext(formType) !== "EFFECT") return;

  const context = await findEffectOriginalRegistrationContext({ input, rawItem });
  if (context) filingPackage.parent_filing_context = context;
}

async function findEffectOriginalRegistrationContext({
  input,
  rawItem,
}: {
  input: SecFilingAnalysisInput;
  rawItem: SecRawItemRow;
}) {
  const currentAccession = readRawAccession(rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentCik = normalizeCik(readRawCik(rawItem));
  const targetFileNumbers = readEffectRegistrationFileNumbers(input, rawItem);
  if (!targetFileNumbers.length) return null;

  const targetFamily = normalizeGenericParentFormFamily(readEffectTargetRegistrationForm(input));
  const candidateRows = await fetchRegistrationFileNumberCandidateRows(targetFileNumbers);
  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .map((row) => {
      const rowFormType = readRawFormType(row);
      const rowFamily = normalizeGenericParentFormFamily(rowFormType);
      if (!isEffectOriginalRegistrationCandidateFamily(rowFamily)) return null;
      if (targetFamily && rowFamily !== targetFamily) return null;

      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowFileNumbers = extractRegistrationFileNumbersFromRow(row);
      const matchedFileNumbers = intersectStrings(targetFileNumbers, rowFileNumbers);
      if (!matchedFileNumbers.length) return null;

      const rowCik = normalizeCik(readRawCik(row));
      const matchReasons: string[] = [
        "effect_registration_file_number_match",
        ...matchedFileNumbers.slice(0, 3).map((fileNumber) => `matches_${fileNumber}`),
      ];
      let score = 260 + Math.min(60, matchedFileNumbers.length * 20);

      if (currentCik && rowCik && currentCik === rowCik) {
        score += 90;
        matchReasons.push("same_cik");
      }
      if (targetFamily && rowFamily === targetFamily) {
        score += 80;
        matchReasons.push("matches_effect_registration_form_family");
      }
      if (isSecAmendmentFormForParentContext(rowFormType)) {
        score += 30;
        matchReasons.push("latest_amendment_candidate");
      }
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)) {
        const rowAgeDays = Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)));
        if (rowAgeDays <= 45) score += 40;
        else if (rowAgeDays <= 180) score += 25;
        else if (rowAgeDays <= 730) score += 10;
        matchReasons.push(`filed_${rowAgeDays}_days_before_effect`);
      }

      return { row, score, matchReasons, matchedFileNumbers };
    })
    .filter(
      (
        item,
      ): item is {
        row: SecRawItemRow;
        score: number;
        matchReasons: string[];
        matchedFileNumbers: string[];
      } => Boolean(item),
    )
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) return null;

  const context = await buildGenericAmendmentParentContext({
    status: "found",
    confidence: "high",
    matchMethod: "effect_registration_file_number",
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });

  return {
    ...context,
    context_kind: "effect_original_registration_filing",
    source_notes: [
      "parent_filing_context is built by integration from EFFECT registration File No. matches.",
      "For EFFECT pages, the selected parent is the prior registration statement analysis users should open for full details.",
    ],
  };
}

async function findGenericAmendmentParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: SecRawItemRow;
  formType: string;
}) {
  const currentAccession = readRawAccession(rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const explicitParentAccession = extractExplicitParentAccessionForAmendment(input, rawItem);
  const currentFamily = normalizeGenericParentFormFamily(formType);
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const explicitCurrentReportReference = readExplicitCurrentReportParentReference(input, formType);
  const currentSc13Facts = isSc13ParentContextFamily(currentFamily) ? readSc13ParentMatchFactsFromInput(input) : null;
  const currentPeriodicReportingPeriod = PERIODIC_PARENT_CONTEXT_FAMILIES.has(currentFamily)
    ? readPeriodicReportingPeriodFromInput(input)
    : "";

  if (currentFamily === "S-8") {
    const s8RegistrationParent = await findS8RegistrationParentFilingContext({
      input,
      rawItem,
      formType,
    });
    if (s8RegistrationParent) return s8RegistrationParent;
  }

  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    if (row && readRawAccession(row) !== currentAccession) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["explicit_parent_accession"],
        rawItem,
        parentRow: row,
        candidateRows: [row],
      });
    }
  }

  if (PERIODIC_PARENT_CONTEXT_FAMILIES.has(currentFamily) && !currentPeriodicReportingPeriod) {
    return buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "periodic_reporting_period_missing",
      matchScore: 0,
      matchReasons: ["current_reporting_period_not_resolved"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
  }

  const candidateRows = dedupeRawRows([
    ...(await fetchGenericAmendmentParentCandidateRows(rawItem)),
    ...(currentSc13Facts ? await fetchSc13ParentCandidateRows(currentSc13Facts) : []),
  ]);

  if (explicitCurrentReportReference) {
    const exactRows = candidateRows.filter((row) => {
      if (readRawAccession(row) === currentAccession) return false;
      if (normalizeGenericParentFormFamily(readRawFormType(row)) !== explicitCurrentReportReference.formType) return false;
      if (isSecAmendmentFormForParentContext(readRawFormType(row))) return false;

      const rowCik = normalizeCik(readRawCik(row));
      const rowTicker = readRawTicker(row);
      if (currentCik && rowCik !== currentCik) return false;
      if (!currentCik && currentTicker && rowTicker !== currentTicker) return false;

      return normalizeDateOnly(readRawFiledDate(row)) === explicitCurrentReportReference.filedDate;
    });
    const matchReasons = [
      `explicit_parent_form:${explicitCurrentReportReference.formType}`,
      `explicit_parent_filed_date:${explicitCurrentReportReference.filedDate}`,
      `explicit_reference_source:${explicitCurrentReportReference.source}`,
    ];

    if (exactRows.length === 1) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_form_filed_date",
        matchScore: 950,
        matchReasons,
        rawItem,
        parentRow: exactRows[0],
        candidateRows: exactRows,
      });
    }

    return buildGenericAmendmentParentContext({
      status: exactRows.length > 1 ? "multiple_candidates" : "not_found",
      confidence: exactRows.length > 1 ? "medium" : "low",
      matchMethod: exactRows.length > 1
        ? "explicit_parent_form_filed_date_ambiguous"
        : "explicit_parent_form_filed_date_not_found",
      matchScore: exactRows.length > 1 ? 900 : 0,
      matchReasons: exactRows.length > 1
        ? [...matchReasons, "multiple_exact_parent_candidates"]
        : [...matchReasons, "explicit_parent_not_persisted"],
      rawItem,
      parentRow: null,
      candidateRows: exactRows,
    });
  }

  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .map((row) => {
      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 1095) return null;

      const rowFamily = normalizeGenericParentFormFamily(readRawFormType(row));
      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const matchReasons: string[] = [];
      let score = 0;

      if (currentPeriodicReportingPeriod) {
        // Periodic amendments must resolve to the original report for the same
        // issuer, base form, and reporting period; recency alone is unsafe.
        if (rowFamily !== currentFamily) return null;
        if (isSecAmendmentFormForParentContext(readRawFormType(row))) return null;
        if (currentCik && rowCik !== currentCik) return null;
        if (!currentCik && currentTicker && rowTicker !== currentTicker) return null;

        const rowReportingPeriod = readPeriodicReportingPeriodFromRawRow(row);
        if (!rowReportingPeriod || rowReportingPeriod !== currentPeriodicReportingPeriod) return null;
        score += 300;
        matchReasons.push("same_reporting_period");
      }

      if (currentSc13Facts) {
        if (!isSc13ParentContextFamily(rowFamily)) return null;
        if (rowFamily !== currentFamily) return null;
      }

      if (currentFamily && rowFamily && currentFamily === rowFamily) {
        score += 80;
        matchReasons.push("same_form_family");
      }
      if (currentCik && rowCik && currentCik === rowCik) {
        score += 80;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 40;
        matchReasons.push("same_ticker");
      }
      if (currentSc13Facts) {
        const rowSc13Facts = readSc13ParentMatchFactsFromRawRow(row);
        if (!rowSc13Facts) return null;

        if (currentSc13Facts.cusip && rowSc13Facts.cusip) {
          if (currentSc13Facts.cusip !== rowSc13Facts.cusip) return null;
          score += 50;
          matchReasons.push("same_cusip");
        }

        const sharedReporters = intersectStrings(currentSc13Facts.reportingPersons, rowSc13Facts.reportingPersons);
        if (currentSc13Facts.reportingPersons.length && rowSc13Facts.reportingPersons.length) {
          if (!sharedReporters.length) return null;
          score += 90 + Math.min(30, sharedReporters.length * 10);
          matchReasons.push("same_reporting_person");
        }

        if (
          currentSc13Facts.securityClass &&
          rowSc13Facts.securityClass &&
          normalizeComparableName(currentSc13Facts.securityClass) === normalizeComparableName(rowSc13Facts.securityClass)
        ) {
          score += 20;
          matchReasons.push("same_security_class");
        }

        if (currentSc13Facts.scheduleType && rowSc13Facts.scheduleType && currentSc13Facts.scheduleType === rowSc13Facts.scheduleType) {
          score += 30;
          matchReasons.push("same_schedule_type");
        }
      }
      if (!isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 25;
        matchReasons.push("non_amendment_parent_preferred");
      } else {
        matchReasons.push("prior_amendment_candidate");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 35;
        else if (rowAgeDays <= 180) score += 20;
        else if (rowAgeDays <= 365) score += 10;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }
      if (stringValue(row.raw_item_id) || stringValue(row.id)) {
        score += 5;
      }

      return {
        row,
        score,
        matchReasons,
        matchMethod: currentSc13Facts
          ? "sc13_same_issuer_reporter_security_recent"
          : currentPeriodicReportingPeriod
            ? "periodic_same_issuer_form_period"
            : "same_issuer_form_family_recent",
      };
    })
    .filter((item): item is { row: SecRawItemRow; score: number; matchReasons: string[]; matchMethod: string } => Boolean(item))
    .filter((item) => item.score >= 100)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) {
    return buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "none",
      matchScore: 0,
      matchReasons: ["no_prior_parent_candidate_found"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
  }

  const second = scored[1];
  const ambiguous = second && best.score - second.score < 20;

  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : best.score >= 180 ? "high" : "medium",
    matchMethod: best.matchMethod,
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

async function findS8RegistrationParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: SecRawItemRow;
  formType: string;
}) {
  const normalizedFormType = normalizeSecFormForParentContext(formType);
  if (normalizedFormType !== "S-8 POS") return null;

  const targetFileNumbers = readS8PriorRegistrationFileNumbers(input);
  const currentAccession = readRawAccession(rawItem);
  const directFileNumberRows = targetFileNumbers.length
    ? await fetchRegistrationFileNumberCandidateRows(targetFileNumbers)
    : [];
  const candidateRows = dedupeRawRows([
    ...directFileNumberRows,
    ...(await fetchGenericAmendmentParentCandidateRows(rawItem)),
  ]);
  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => normalizeGenericParentFormFamily(readRawFormType(row)) === "S-8")
    .map((row) => {
      if (!targetFileNumbers.length) return null;
      const matchedFileNumbers = intersectStrings(targetFileNumbers, extractRegistrationFileNumbersFromRow(row));
      if (!matchedFileNumbers.length) return null;

      const matchReasons = [
        "s8_pos_prior_registration_file_number",
        ...matchedFileNumbers.slice(0, 4).map((fileNumber) => `matches_${fileNumber}`),
      ];
      let score = 220 + matchedFileNumbers.length * 30;
      if (!isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 35;
        matchReasons.push("non_amendment_parent_preferred");
      }

      return {
        row,
        score,
        matchReasons,
        matchedFileNumbers,
      };
    })
    .filter(
      (
        item,
      ): item is {
        row: SecRawItemRow;
        score: number;
        matchReasons: string[];
        matchedFileNumbers: string[];
      } => Boolean(item),
    )
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) {
    const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
    const currentTicker = readRawTicker(rawItem);
    const currentCik = normalizeCik(readRawCik(rawItem));
    const sameIssuerPriorS8Rows = candidateRows
      .filter((row) => readRawAccession(row) !== currentAccession)
      .filter((row) => normalizeGenericParentFormFamily(readRawFormType(row)) === "S-8")
      .filter((row) => !isSecAmendmentFormForParentContext(readRawFormType(row)))
      .filter((row) => {
        const rowFiledAt = Date.parse(stringValue(row.published_at));
        return !Number.isFinite(currentFiledAt) || !Number.isFinite(rowFiledAt) || rowFiledAt < currentFiledAt;
      })
      .filter((row) => {
        const rowTicker = readRawTicker(row);
        const rowCik = normalizeCik(readRawCik(row));
        return Boolean((currentCik && rowCik && currentCik === rowCik) || (currentTicker && rowTicker && currentTicker === rowTicker));
      })
      .sort((left, right) => Date.parse(stringValue(right.published_at)) - Date.parse(stringValue(left.published_at)));

    if (sameIssuerPriorS8Rows.length === 1) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "medium",
        matchMethod: "same_issuer_prior_s8_single_candidate",
        matchScore: 180,
        matchReasons: [
          targetFileNumbers.length
            ? "s8_pos_prior_registration_file_number_present"
            : "s8_pos_prior_registration_file_number_missing",
          targetFileNumbers.length ? "parent_row_file_number_unavailable" : "same_issuer_fallback_parent",
          "single_same_issuer_prior_non_amendment_s8",
        ],
        rawItem,
        parentRow: sameIssuerPriorS8Rows[0],
        candidateRows: sameIssuerPriorS8Rows,
      });
    }

    if (sameIssuerPriorS8Rows.length > 1) {
      return buildGenericAmendmentParentContext({
        status: "multiple_candidates",
        confidence: "medium",
        matchMethod: "same_issuer_prior_s8_multiple_candidates",
        matchScore: 160,
        matchReasons: [
          targetFileNumbers.length
            ? "s8_pos_prior_registration_file_number_present"
            : "s8_pos_prior_registration_file_number_missing",
          targetFileNumbers.length ? "parent_row_file_number_unavailable" : "same_issuer_fallback_parent",
          "multiple_same_issuer_prior_non_amendment_s8_candidates",
        ],
        rawItem,
        parentRow: null,
        candidateRows: sameIssuerPriorS8Rows.slice(0, 5),
      });
    }

    return null;
  }

  const second = scored[1];
  const ambiguous = second && best.score - second.score < 20;

  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : "high",
    matchMethod: ambiguous ? "s8_registration_file_number_multiple_candidates" : "s8_registration_file_number",
    matchScore: best.score,
    matchReasons: ambiguous
      ? [...best.matchReasons, "multiple_prior_s8_candidates_for_registration_file_number"]
      : best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

async function findParentS3RegistrationContext({
  currentAccession,
  rawItem,
  registrationNumber,
}: {
  currentAccession: string;
  rawItem: SecRawItemRow;
  registrationNumber: string;
}) {
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const ticker = (stringValue(rawPayload.ticker) || stringValue(metadata.ticker)).toUpperCase();
  const rawCik = readRawCik(rawItem);
  const currentCik = normalizeCik(rawCik);
  const currentIssuer = normalizeCompanyNameForParentMatch(readRawCompanyName(rawItem));
  const currentParsed = parseSecS3Filing(rawRowToS3ParseInput(rawItem));
  const rows = await fetchS3ParentCandidateRows({ ticker, cik: currentCik, rawCik });
  if (!rows.length) return buildMissingParentS3Context("no_scoped_candidates");

  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const matches: Array<{
    row: SecRawItemRow;
    parsed: SecS3FilingFacts;
    score: number;
    filedAt: number;
    matchMethod: string;
    matchReasons: string[];
    registrationNumberMatch: boolean;
  }> = [];

  for (const row of rows) {
    const accession = readRawAccession(row);
    if (currentAccession && accession === currentAccession) continue;

    const formType = readRawFormType(row);
    if (!isS3F3RegistrationFamilyForm(formType)) continue;

    const rowTicker = readRawTicker(row);
    const rowCik = normalizeCik(readRawCik(row));
    const cikMatches = Boolean(currentCik && rowCik && currentCik === rowCik);
    if (!cikMatches && ticker && rowTicker && rowTicker !== ticker) continue;

    const parsed = parseSecS3Filing(rawRowToS3ParseInput(row));
    const registrationNumberMatches = sameRegistrationNumber(parsed.amendment.registration_number?.value, registrationNumber);

    const filedAt = Date.parse(stringValue(row.published_at));
    if (Number.isFinite(currentFiledAt) && (!Number.isFinite(filedAt) || filedAt >= currentFiledAt)) continue;

    const rowIssuer = normalizeCompanyNameForParentMatch(readRawCompanyName(row) || stringValue(parsed.issuer));
    const sameIssuer =
      cikMatches ||
      Boolean(currentIssuer && rowIssuer && currentIssuer === rowIssuer);
    if (!sameIssuer) continue;

    const termMatch = compareS3RegistrationTerms(currentParsed, parsed);
    if (!registrationNumberMatches && !termMatch.confirmed) continue;

    const matchMethod = registrationNumberMatches ? "registration_number" : "same_cik_same_registration_terms";
    const matchReasons = registrationNumberMatches ? ["registration_number_match"] : termMatch.matchReasons;
    let score = 0;
    if (!parsed.amendment.is_amendment) score += 20;
    if (Number.isFinite(currentFiledAt) && Number.isFinite(filedAt) && filedAt <= currentFiledAt) score += 50;
    if (currentCik && rowCik && currentCik === rowCik) score += 50;
    if (ticker && rowTicker && rowTicker === ticker) score += 15;
    if (parsed.fee_table.present) score += 10;
    if (parsed.selling_stockholders.length) score += 10;
    if (parsed.extracted_field_count) score += Math.min(10, parsed.extracted_field_count);
    if (!registrationNumberMatches) score += termMatch.score;

    matches.push({
      row,
      parsed,
      score,
      filedAt,
      matchMethod,
      matchReasons,
      registrationNumberMatch: registrationNumberMatches,
    });
  }

  matches.sort((left, right) => {
    if (right.filedAt !== left.filedAt) return right.filedAt - left.filedAt;
    return right.score - left.score;
  });

  const best = matches[0];
  if (!best) return buildMissingParentS3Context("no_registration_number_parent_match");

  const ambiguous = matches.length > 1 && best.filedAt === matches[1].filedAt;
  if (ambiguous) {
    return buildAmbiguousParentS3Context({
      candidateCount: matches.length,
      candidates: matches.slice(0, 5).map(({ row, parsed, score }) => buildParentS3CandidateSummary({ parsed, row, score })),
      registrationNumber,
    });
  }

  return buildParentS3Context({
    matchMethod: best.matchMethod,
    matchReasons: best.matchReasons,
    matchCount: matches.length,
    parsed: best.parsed,
    registrationNumberMatch: best.registrationNumberMatch,
    registrationNumber,
    row: best.row,
  });
}

async function buildParentS3Context({
  matchMethod,
  matchReasons,
  matchCount,
  parsed,
  registrationNumberMatch,
  registrationNumber,
  row,
}: {
  matchMethod: string;
  matchReasons: string[];
  matchCount: number;
  parsed: SecS3FilingFacts;
  registrationNumberMatch: boolean;
  registrationNumber: string;
  row: SecRawItemRow;
}) {
  return {
    source: "raw_items",
    status: "found",
    confirmed_parent: true,
    comparison_allowed: true,
    registration_number_match: registrationNumberMatch,
    match_method: matchMethod,
    match_reasons: matchReasons,
    match_count: matchCount,
    registration_number: registrationNumber,
    raw_item_id: stringValue(row.id) || null,
    accession_number: parsed.accession_number,
    form_type: parsed.form_type,
    filed_at: parsed.filed_at,
    source_url: parsed.source_url,
    company_name: parsed.issuer,
    ticker: parsed.ticker,
    registration_statement_kind: parsed.registration_statement_kind?.value || null,
    registration_status: parsed.registration_status?.value || null,
    prospectus_status: parsed.prospectus_status?.value || null,
    primary_or_resale: parsed.primary_or_resale?.value || null,
    securities_registered: parsed.securities_registered.map((item) => item.value),
    shares_registered: parsed.shares_registered?.text || null,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    offering_terms: {
      registration_statement_kind: parsed.offering_terms.registration_statement_kind?.value || null,
      offering_type: parsed.offering_terms.offering_type?.value || null,
      security_type: parsed.offering_terms.security_type?.value || null,
      primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
      offering_amount: parsed.offering_terms.offering_amount?.text || null,
      shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
      atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
      resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
      current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
      warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
      conversion_price: parsed.offering_terms.conversion_price?.text || null,
    },
    fee_table: {
      present: parsed.fee_table.present,
      text_available: parsed.fee_table.text_available,
      row_count: parsed.fee_table.rows.length,
      total_offering_amount: parsed.fee_table.totals.total_offering_amount?.text || null,
      net_fee_due: parsed.fee_table.totals.net_fee_due?.text || null,
    },
    selling_stockholders: {
      count: parsed.selling_stockholders.length,
      top_holders: parsed.selling_stockholders.slice(0, 8).map((holder) => ({
        holder_name: holder.holder_name,
        shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
        beneficially_owned_before: holder.beneficially_owned_before?.text || null,
        beneficially_owned_after: holder.beneficially_owned_after?.text || null,
        percent_after: holder.percent_after?.text || null,
      })),
    },
    source_excerpts: buildParentS3SourceExcerpts(row),
    existing_analysis: await fetchExistingParentAnalysis(stringValue(row.id)),
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
  };
}

async function buildGenericAmendmentParentContext({
  status,
  confidence,
  matchMethod,
  matchScore,
  matchReasons,
  rawItem,
  parentRow,
  candidateRows,
}: {
  status: "found" | "not_found" | "multiple_candidates";
  confidence: "high" | "medium" | "low";
  matchMethod: string;
  matchScore: number;
  matchReasons: string[];
  rawItem: SecRawItemRow;
  parentRow: SecRawItemRow | null;
  candidateRows: SecRawItemRow[];
}) {
  const parent = parentRow ? await compactGenericParentRow(parentRow) : null;
  const candidates = await Promise.all(candidateRows.slice(0, 5).map(compactGenericParentCandidateRow));

  return {
    status,
    context_kind: "amendment_parent_filing",
    source: "raw_items_events_compact",
    match_method: matchMethod,
    match_score: matchScore,
    match_reasons: matchReasons.slice(0, 8),
    confidence,
    candidate_count: candidateRows.length,
    parent_selected: Boolean(parent),
    current_amendment: {
      accession_number: readRawAccession(rawItem) || null,
      form_type: readRawFormType(rawItem) || null,
      filed_at: stringValue(rawItem.published_at) || readRawFiledDate(rawItem) || null,
      reporting_period: readPeriodicReportingPeriodFromRawRow(rawItem) || null,
      source_url: stringValue(rawItem.source_url) || null,
      company_name: readRawCompanyName(rawItem) || null,
      ticker: readRawTicker(rawItem) || null,
      cik: normalizeCik(readRawCik(rawItem)) || null,
    },
    parent,
    candidates,
    source_notes: [
      "parent_filing_context is built by integration from persisted raw_items, events, and event_analysis.",
      "Historical full raw filing text is excluded; use compact prior analysis, key evidence, display_payload, transaction_fingerprint, snippets, and inventory only.",
      "If multiple parent candidates exist, integration does not fully analyze every candidate or force-select one.",
      "If status is not_found or multiple_candidates, analysis should treat parent comparison as limited and avoid inventing amendment deltas.",
    ],
  };
}

async function compactGenericParentRow(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const existing = await fetchExistingGenericParentEventContext(stringValue(row.id));
  const displayPayload = compactParentDisplayPayload(existing?.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const selectedSourceSnippets = readStringArray(displayData?.selected_source_snippets).slice(0, 8);
  const attachmentInventory = readRecordArray(displayData?.attachment_inventory).slice(0, 12);
  const selectedTables = readRecordArray(displayData?.selected_tables).slice(0, 5);

  return {
    raw_item_id: stringValue(row.id) || null,
    event_id: existing?.event_id || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || stringValue(rawPayload.filing_date) || null,
    reporting_period: readPeriodicReportingPeriodFromRawRow(row) || null,
    source_url: stringValue(row.source_url) || stringValue(rawPayload.detail_url) || null,
    company_name: readRawCompanyName(row) || stringValue(metadata.company_name) || null,
    ticker: (readRawTicker(row) || stringValue(existing?.ticker)).toUpperCase() || null,
    exchange: stringValue(existing?.exchange) || stringValue(rawPayload.exchange) || stringValue(metadata.exchange) || null,
    cik: normalizeCik(readRawCik(row)) || null,
    event_type: existing?.event_type || null,
    score: existing?.score ?? null,
    delivery_level: existing?.delivery_level || null,
    signal: existing?.signal || null,
    event_title: existing?.event_title || null,
    quick_take: existing?.quick_take || null,
    summary: existing?.summary || null,
    key_evidence: existing?.key_evidence || [],
    what_to_watch_next: existing?.what_to_watch_next || [],
    display_payload: displayPayload,
    transaction_fingerprint: existing?.transaction_fingerprint || null,
    sc13_facts: compactSc13ParentFactsFromRawRow(row),
    selected_source_snippets: selectedSourceSnippets,
    selected_tables: selectedTables,
    attachment_inventory: attachmentInventory.length ? attachmentInventory : compactRawDocumentInventory(rawPayload).slice(0, 12),
    source_availability_note: displayData?.source_availability_note || "Parent context excludes full raw filing text.",
  };
}

async function compactGenericParentCandidateRow(row: SecRawItemRow) {
  const existing = await fetchExistingGenericParentEventContext(stringValue(row.id));
  return {
    raw_item_id: stringValue(row.id) || null,
    event_id: existing?.event_id || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || readRawFiledDate(row) || null,
    reporting_period: readPeriodicReportingPeriodFromRawRow(row) || null,
    company_name: readRawCompanyName(row) || null,
    ticker: (readRawTicker(row) || stringValue(existing?.ticker)).toUpperCase() || null,
    exchange: stringValue(existing?.exchange) || null,
    cik: normalizeCik(readRawCik(row)) || null,
    event_type: existing?.event_type || null,
    score: existing?.score ?? null,
    delivery_level: existing?.delivery_level || null,
    event_title: existing?.event_title || null,
    quick_take: existing?.quick_take || null,
    summary: existing?.summary || null,
    transaction_fingerprint: existing?.transaction_fingerprint || null,
    sc13_facts: compactSc13ParentFactsFromRawRow(row),
  };
}

function compactSec425SelectedTransactionContext(
  compact: Awaited<ReturnType<typeof compactGenericParentRow>>,
  match: Sec425RankedTransactionContextCandidate,
) {
  return {
    raw_item_id: compact.raw_item_id,
    event_id: compact.event_id,
    accession_number: compact.accession_number,
    form_type: compact.form_type,
    filed_at: compact.filed_at,
    source_url: compact.source_url,
    company_name: compact.company_name,
    ticker: compact.ticker,
    exchange: compact.exchange,
    cik: compact.cik,
    event_type: compact.event_type,
    score: compact.score,
    delivery_level: compact.delivery_level,
    signal: compact.signal,
    event_title: compactContextText(compact.event_title, 240),
    quick_take: compactContextText(compact.quick_take, 500),
    summary: compactContextText(compact.summary, 1_500),
    key_evidence: compact.key_evidence.slice(0, 3).map((item) => compactContextText(item, 500)).filter(Boolean),
    display_payload: compact.display_payload,
    transaction_fingerprint: compact.transaction_fingerprint,
    match_score: match.match_score,
    match_reasons: match.match_reasons,
    matched_related_names: match.matched_related_names,
  };
}

async function fetchExistingParentAnalysis(rawItemId: string) {
  if (!rawItemId) return null;

  const eventResult = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    raw_item_id: `eq.${rawItemId}`,
    order: "detected_at.desc",
    limit: "1",
  });
  const event = eventResult.ok && Array.isArray(eventResult.data) ? readRecord(eventResult.data[0]) : null;
  if (!event) return null;

  const analysisResult = await supabaseSelect("event_analysis", {
    select: "*",
    event_id: `eq.${stringValue(event.id)}`,
    limit: "1",
  });
  const analysis = analysisResult.ok && Array.isArray(analysisResult.data) ? readRecord(analysisResult.data[0]) : null;

  return {
    event_id: stringValue(event.id) || null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || stringValue(analysis?.quick_take) || null,
    summary: stringValue(event.summary) || stringValue(analysis?.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 3),
    what_to_watch_next: readStringArray(analysis?.what_to_watch_next).slice(0, 3),
  };
}

async function fetchExistingGenericParentEventContext(rawItemId: string) {
  if (!rawItemId) return null;

  const eventResult = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    raw_item_id: `eq.${rawItemId}`,
    order: "detected_at.desc",
    limit: "1",
  });
  const event = eventResult.ok && Array.isArray(eventResult.data) ? readRecord(eventResult.data[0]) : null;
  if (!event) return null;

  const analysisResult = await supabaseSelect("event_analysis", {
    select: "*",
    event_id: `eq.${stringValue(event.id)}`,
    limit: "1",
  });
  const analysis = analysisResult.ok && Array.isArray(analysisResult.data) ? readRecord(analysisResult.data[0]) : null;
  const metadata = readRecord(event.metadata) || {};
  const analysisOutput = readRecord(analysis?.analysis_output) || {};
  const primaryTicker = readRecord(analysisOutput.primary_ticker) || readRecord(metadata.primary_ticker) || {};
  const displayPayload = readRecord(metadata.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const marketContext = readRecord(metadata.market_context) || readRecord(analysisOutput.market_context) || {};

  return {
    event_id: stringValue(event.id) || null,
    ticker:
      (
        stringValue(event.ticker) ||
        stringValue(primaryTicker.ticker) ||
        stringValue(primaryTicker.symbol) ||
        stringValue(displayData?.ticker) ||
        stringValue(marketContext.ticker)
      ).toUpperCase() || null,
    exchange:
      stringValue(event.exchange) ||
      stringValue(primaryTicker.exchange) ||
      stringValue(displayData?.exchange) ||
      stringValue(marketContext.exchange) ||
      null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || stringValue(analysis?.quick_take) || null,
    summary: stringValue(event.summary) || stringValue(analysis?.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 6),
    what_to_watch_next: readStringArray(analysis?.what_to_watch_next).slice(0, 6),
    display_payload: displayPayload,
    transaction_fingerprint: readRecord(metadata.transaction_fingerprint),
  };
}

async function fetchS3ParentCandidateRows({ ticker, cik, rawCik }: { ticker: string; cik: string; rawCik: string }) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const scoped: SecRawItemRow[] = [];

  const cikCandidates = uniqueStrings([rawCik, cik].filter(Boolean));
  for (const cikCandidate of cikCandidates) {
    const byPayloadCik = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cikCandidate}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (byPayloadCik.ok && Array.isArray(byPayloadCik.data)) scoped.push(...(byPayloadCik.data as SecRawItemRow[]));

    const byMetadataCik = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "metadata->>cik": `eq.${cikCandidate}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (byMetadataCik.ok && Array.isArray(byMetadataCik.data)) scoped.push(...(byMetadataCik.data as SecRawItemRow[]));
  }

  const withTicker = ticker
    ? await supabaseSelect("raw_items", {
        select,
        source_code: "eq.sec_edgar",
        "raw_payload->>ticker": `eq.${ticker}`,
        order: "published_at.desc",
        limit: "200",
      })
    : null;

  if (withTicker?.ok && Array.isArray(withTicker.data)) scoped.push(...(withTicker.data as SecRawItemRow[]));

  return uniqueRawRows(scoped);
}

async function fetchGenericAmendmentParentCandidateRows(rawItem: SecRawItemRow, ownershipHints?: OwnershipParentSearchHints) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rawCik = readRawCik(rawItem);
  const cikValues = uniqueStrings([rawCik, normalizeCik(rawCik), ...(ownershipHints?.companyCiks || [])].filter(Boolean));
  const ticker = readRawTicker(rawItem);
  const rows: SecRawItemRow[] = [];

  for (const cik of cikValues) {
    const byPayload = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (byPayload.ok && Array.isArray(byPayload.data)) rows.push(...(byPayload.data as SecRawItemRow[]));

    const byMetadata = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "metadata->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (byMetadata.ok && Array.isArray(byMetadata.data)) rows.push(...(byMetadata.data as SecRawItemRow[]));
  }

  if (ticker) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>ticker": `eq.${ticker}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as SecRawItemRow[]));
  }

  for (const ownerCik of (ownershipHints?.ownerCiks || []).slice(0, 2)) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      body_text: `ilike.*${ownerCik}*`,
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as SecRawItemRow[]));
  }

  if (!rows.length) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as SecRawItemRow[]));
  }

  return dedupeRawRows(rows);
}

async function fetchSec425TransactionCandidateRows(rawItem: SecRawItemRow, parserTicker: string) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rawCik = readRawCik(rawItem);
  const cikValues = uniqueStrings([rawCik, normalizeCik(rawCik)].filter(Boolean));
  const tickerValues = uniqueStrings([readRawTicker(rawItem), parserTicker].filter(Boolean));
  const rows: SecRawItemRow[] = [];

  for (const cik of cikValues.slice(0, 2)) {
    const byPayload = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "120",
    });
    if (byPayload.ok && Array.isArray(byPayload.data)) rows.push(...(byPayload.data as SecRawItemRow[]));

    const byMetadata = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "metadata->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "120",
    });
    if (byMetadata.ok && Array.isArray(byMetadata.data)) rows.push(...(byMetadata.data as SecRawItemRow[]));
  }

  for (const ticker of tickerValues.slice(0, 2)) {
    const normalizedTicker = stringValue(ticker).toUpperCase();
    if (!normalizedTicker) continue;
    const byPayload = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>ticker": `eq.${normalizedTicker}`,
      order: "published_at.desc",
      limit: "120",
    });
    if (byPayload.ok && Array.isArray(byPayload.data)) rows.push(...(byPayload.data as SecRawItemRow[]));
  }

  return dedupeRawRows(rows);
}

async function fetchTenderParentCandidateRows(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const select = "id,source_unique_id,source_url,title,published_at,raw_payload,metadata";
  const filingPackage = readRecord(input.filing_package) || {};
  const subjectTicker = resolveTenderSubjectMarketContextSymbol(filingPackage);
  const rawCik = readRawCik(rawItem);
  const cikValues = uniqueStrings([rawCik, normalizeCik(rawCik)].filter(Boolean));
  const tickerValues = uniqueStrings([readRawTicker(rawItem), subjectTicker || ""].filter(Boolean));
  const rows: SecRawItemRow[] = [];

  for (const cik of cikValues.slice(0, 3)) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "150",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as SecRawItemRow[]));
  }

  for (const ticker of tickerValues.slice(0, 3)) {
    const normalizedTicker = normalizeMarketContextTicker(ticker);
    if (!normalizedTicker) continue;
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>ticker": `eq.${normalizedTicker}`,
      order: "published_at.desc",
      limit: "150",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as SecRawItemRow[]));
  }

  return dedupeRawRows(rows);
}

async function fetchSc13ParentCandidateRows(facts: Sc13ParentMatchFacts) {
  const cusip = normalizeSc13CusipForSearch(facts.cusip);
  if (!cusip) return [];

  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rows: SecRawItemRow[] = [];
  const bodyResult = await supabaseSelect("raw_items", {
    select,
    source_code: "eq.sec_edgar",
    body_text: `ilike.*${cusip}*`,
    order: "published_at.desc",
    limit: "300",
  });
  if (bodyResult.ok && Array.isArray(bodyResult.data)) rows.push(...(bodyResult.data as SecRawItemRow[]));

  const analysisResult = await supabaseSelect("raw_items", {
    select,
    source_code: "eq.sec_edgar",
    analysis_text: `ilike.*${cusip}*`,
    order: "published_at.desc",
    limit: "300",
  });
  if (analysisResult.ok && Array.isArray(analysisResult.data)) rows.push(...(analysisResult.data as SecRawItemRow[]));

  return dedupeRawRows(rows);
}

async function fetchRegistrationFileNumberCandidateRows(fileNumbers: string[]) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rows: SecRawItemRow[] = [];

  for (const fileNumber of uniqueStrings(fileNumbers).slice(0, 5)) {
    const rawPayloadResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>file_number": `eq.${fileNumber}`,
      order: "published_at.desc",
      limit: "100",
    });
    if (rawPayloadResult.ok && Array.isArray(rawPayloadResult.data)) rows.push(...(rawPayloadResult.data as SecRawItemRow[]));

    const bodyResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      body_text: `ilike.*${fileNumber}*`,
      order: "published_at.desc",
      limit: "100",
    });
    if (bodyResult.ok && Array.isArray(bodyResult.data)) rows.push(...(bodyResult.data as SecRawItemRow[]));

    const analysisResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      analysis_text: `ilike.*${fileNumber}*`,
      order: "published_at.desc",
      limit: "100",
    });
    if (analysisResult.ok && Array.isArray(analysisResult.data)) rows.push(...(analysisResult.data as SecRawItemRow[]));
  }

  return dedupeRawRows(rows);
}

async function fetchSecRawItemByAccession(accession: string) {
  const normalized = stringValue(accession);
  if (!normalized) return null;

  const result = await supabaseSelect("raw_items", {
    select: "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata",
    source_code: "eq.sec_edgar",
    source_unique_id: `eq.${normalized}`,
    limit: "1",
  });
  const row = result.ok && Array.isArray(result.data) ? (result.data[0] as SecRawItemRow | undefined) : null;
  if (row) return row;

  const payloadResult = await supabaseSelect("raw_items", {
    select: "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata",
    source_code: "eq.sec_edgar",
    "raw_payload->>accession_number": `eq.${normalized}`,
    limit: "1",
  });
  const payloadRow = payloadResult.ok && Array.isArray(payloadResult.data) ? (payloadResult.data[0] as SecRawItemRow | undefined) : null;
  return payloadRow || null;
}

function readOwnershipParentSearchHints(row: SecRawItemRow): OwnershipParentSearchHints {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const sourceText = readOwnershipParentSearchText(row);
  const ownerCiks = uniqueStrings(readOwnershipXmlValues(sourceText, "rptOwnerCik").map(normalizeCik).filter(Boolean));
  const ownerNames = uniqueStrings(readOwnershipXmlValues(sourceText, "rptOwnerName").map(normalizePersonName).filter(Boolean));
  const companyCiks = uniqueStrings(
    [
      readRawCik(row),
      stringValue(rawPayload.ownership_issuer_cik),
      stringValue(rawPayload.issuer_cik),
      stringValue(metadata.ownership_issuer_cik),
      ...readOwnershipXmlValues(sourceText, "issuerCik"),
    ]
      .map(normalizeCik)
      .filter(Boolean),
  );
  const reportDates = uniqueStrings(
    [
      ...readOwnershipXmlValues(sourceText, "periodOfReport"),
      ...readOwnershipNestedXmlValues(sourceText, "transactionDate", "value"),
      ...readOwnershipNestedXmlValues(sourceText, "deemedExecutionDate", "value"),
    ]
      .map(normalizeDateOnly)
      .filter(Boolean),
  );

  return {
    companyCiks,
    ownerCiks,
    ownerNames,
    reportDates,
    referencedDates: extractOwnershipReferencedDates(sourceText),
    filedDate: normalizeDateOnly(stringValue(row.published_at) || stringValue(rawPayload.filing_date)),
    formType: readRawFormType(row),
  };
}

function buildOwnershipOriginalFilingInput(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const attachmentTexts = readRecordArray(rawPayload.attachment_texts);
  return {
    id: stringValue(row.id) || stringValue(row.source_unique_id) || "ownership-parent",
    formType: readRawFormType(row) || "4",
    accessionNumber: readRawAccession(row) || null,
    filingText: [
      stringValue(row.body_text),
      stringValue(row.analysis_text),
      ...attachmentTexts.map((attachment) => stringValue(attachment.text)),
    ]
      .filter(Boolean)
      .join("\n\n"),
    attachments: attachmentTexts.map((attachment) => ({
      type: stringValue(attachment.type) || stringValue(attachment.documentType) || null,
      description: stringValue(attachment.description) || null,
      filename: stringValue(attachment.filename) || stringValue(attachment.name) || null,
      url: stringValue(attachment.url) || null,
      text: stringValue(attachment.text) || null,
    })),
    rawPayload,
    metadata,
    issuer: {
      name: readRawCompanyName(row) || null,
      ticker: readRawTicker(row) || null,
      exchange: stringValue(rawPayload.exchange) || stringValue(metadata.exchange) || null,
      cik: readRawCik(row) || null,
    },
    source: {
      url: stringValue(row.source_url) || stringValue(rawPayload.source_url) || stringValue(rawPayload.detail_url) || null,
    },
  };
}

function compactSc13ParentFactsFromRawRow(row: SecRawItemRow) {
  if (!isSc13ParentContextFamily(normalizeGenericParentFormFamily(readRawFormType(row)))) return null;
  try {
    const parserOutput = parseSc13Filing(rawRowToSc13ParseInput(row));
    const facts = parserOutput.facts;
    return {
      schedule_type: facts.scheduleType,
      is_amendment: facts.isAmendment,
      amendment_number: facts.amendmentNumber,
      event_date: facts.eventDate,
      reporting_persons: facts.reportingPersons.slice(0, 12),
      cusip: facts.cusip,
      security_class: facts.securityClass,
      shares_beneficially_owned: facts.sharesBeneficiallyOwned,
      percent_owned: facts.percentOwned,
      voting_power: facts.votingPower,
      dispositive_power: facts.dispositivePower,
    };
  } catch {
    return null;
  }
}

function readSc13ParentMatchFactsFromInput(input: SecFilingAnalysisInput): Sc13ParentMatchFacts | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parserOutput = readRecord(hardParsers?.sc13) as unknown as Sc13ParserOutput | null;
  return sc13ParentMatchFactsFromParserOutput(parserOutput);
}

function readSc13ParentMatchFactsFromRawRow(row: SecRawItemRow): Sc13ParentMatchFacts | null {
  try {
    return sc13ParentMatchFactsFromParserOutput(parseSc13Filing(rawRowToSc13ParseInput(row)));
  } catch {
    return null;
  }
}

function sc13ParentMatchFactsFromParserOutput(parserOutput: Sc13ParserOutput | null): Sc13ParentMatchFacts | null {
  const facts = readRecord(parserOutput?.facts);
  if (!facts) return null;
  const scheduleType = stringValue(facts.scheduleType);
  const reportingPersons = uniqueStrings(readStringArray(facts.reportingPersons).map(normalizeComparableName).filter(Boolean));
  return {
    scheduleType,
    reportingPersons,
    cusip: stringValue(facts.cusip).toUpperCase(),
    securityClass: normalizeComparableName(stringValue(facts.securityClass)),
  };
}

function compareS3RegistrationTerms(current: SecS3FilingFacts, candidate: SecS3FilingFacts) {
  const matchReasons: string[] = [];
  let score = 0;

  if (sameS3CountField(current.resale_share_count, candidate.resale_share_count)) {
    score += 90;
    matchReasons.push("same_resale_share_count");
  }
  if (sameS3CountField(current.shares_registered, candidate.shares_registered)) {
    score += 60;
    matchReasons.push("same_registered_share_count");
  }
  if (sameS3MoneyField(current.offering_terms.shelf_capacity, candidate.offering_terms.shelf_capacity)) {
    score += 70;
    matchReasons.push("same_shelf_capacity");
  }
  if (sameS3MoneyField(current.offering_terms.offering_amount, candidate.offering_terms.offering_amount)) {
    score += 55;
    matchReasons.push("same_offering_amount");
  }
  if (sameS3TextField(current.primary_or_resale, candidate.primary_or_resale)) {
    score += 15;
    matchReasons.push("same_primary_or_resale");
  }
  if (sameS3TextField(current.offering_terms.offering_type, candidate.offering_terms.offering_type)) {
    score += 15;
    matchReasons.push("same_offering_type");
  }
  if (sameS3TextField(current.offering_terms.security_type, candidate.offering_terms.security_type)) {
    score += 10;
    matchReasons.push("same_security_type");
  }

  const currentHolderCount = current.selling_stockholders.length;
  if (currentHolderCount > 0 && currentHolderCount === candidate.selling_stockholders.length) {
    score += 15;
    matchReasons.push("same_selling_holder_count");
  }

  return {
    confirmed: score >= 100,
    score,
    matchReasons,
  };
}

function buildMissingParentS3Context(reason: string) {
  return {
    source: "raw_items",
    status: "not_found",
    confirmed_parent: false,
    comparison_allowed: false,
    registration_number_match: false,
    match_method: "registration_number",
    match_count: 0,
    match_reasons: [reason],
    parent: null,
  };
}

function buildAmbiguousParentS3Context({
  candidateCount,
  candidates,
  registrationNumber,
}: {
  candidateCount: number;
  candidates: Array<Record<string, unknown>>;
  registrationNumber: string;
}) {
  return {
    source: "raw_items",
    status: "multiple_candidates",
    confirmed_parent: false,
    comparison_allowed: false,
    registration_number_match: true,
    match_method: "registration_number",
    match_count: candidateCount,
    registration_number: registrationNumber,
    candidates,
    parent: null,
  };
}

function buildParentS3CandidateSummary({
  parsed,
  row,
  score,
}: {
  parsed: SecS3FilingFacts;
  row: SecRawItemRow;
  score: number;
}) {
  return {
    raw_item_id: stringValue(row.id) || null,
    accession_number: parsed.accession_number,
    form_type: parsed.form_type,
    filed_at: parsed.filed_at,
    ticker: parsed.ticker,
    company_name: parsed.issuer,
    score,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    offering_type: parsed.offering_terms.offering_type?.value || null,
    security_type: parsed.offering_terms.security_type?.value || null,
  };
}

function buildParentS3SourceExcerpts(row: SecRawItemRow) {
  const text = truncateCompactContextText(`${stringValue(row.body_text)} ${stringValue(row.analysis_text)}`, 240_000);
  if (!text) return [];

  const specs = [
    {
      label: "Parent registration obligation",
      pattern:
        /\b(?:not already so registered by|register(?:ed)?\s+(?:by|on or before))\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}[\s\S]{0,260}?(?:effective|declared effective)[\s\S]{0,180}?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i,
      bodyPattern: /\b(?:underlying the Investor Warrants|declared effective|cause such filing|effective by|effective no later than)\b/i,
    },
    {
      label: "Parent incorporated documents",
      pattern: /\bDOCUMENTS INCORPORATED BY REFERENCE\b/i,
      bodyPattern: /\b(?:annual report|quarterly report|current report|filed with the SEC|Exchange Act|incorporate by reference)\b/i,
    },
    {
      label: "Parent experts",
      pattern: /\bEXPERTS\b/i,
      bodyPattern: /\b(?:audited by|independent registered public accounting firm|Weaver|Tidwell|MKM Engineering|reserves|Appraisal Report)\b/i,
    },
    {
      label: "Parent selling holder terms",
      pattern: /\bselling stockholder\b/i,
      bodyPattern: /\b(?:shares of common stock|Second Tranche Warrant|Registration Rights Agreement|Waiver|will not receive any proceeds)\b/i,
    },
  ];

  const excerpts: Array<{ label: string; text: string }> = [];
  for (const spec of specs) {
    const excerpt = extractS3ContextExcerpt(text, spec.pattern, spec.bodyPattern);
    if (excerpt) excerpts.push({ label: spec.label, text: excerpt });
  }
  return excerpts;
}

function extractS3ContextExcerpt(text: string, pattern: RegExp, bodyPattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(globalPattern)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, index + 1_500);
    const window = text.slice(start, end);
    if (!bodyPattern.test(window)) continue;
    if (/\bTABLE OF CONTENTS\b/i.test(window.slice(0, 500))) continue;
    return truncateCompactContextText(window, 1_500);
  }
  return "";
}

function compactParentDisplayPayload(value: unknown) {
  const displayPayload = readRecord(value);
  if (!displayPayload) return null;

  return {
    display_type: stringValue(displayPayload.display_type) || "generic",
    data: compactParentDisplayPayloadData(readRecord(displayPayload.data) || {}),
    evidence: readStringArray(displayPayload.evidence).slice(0, 6),
    notes: readStringArray(displayPayload.notes).slice(0, 6),
  };
}

function compactParentDisplayPayloadData(data: Record<string, unknown>) {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "selected_source_snippets") {
      compact[key] = readStringArray(value).slice(0, 8);
    } else if (key === "attachment_inventory") {
      compact[key] = readRecordArray(value).map(compactSourceInventoryRecord).slice(0, 12);
    } else if (key === "selected_tables") {
      compact[key] = readRecordArray(value).slice(0, 5);
    } else if (typeof value === "string") {
      compact[key] = truncateCompactContextText(value, 800);
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function compactRawDocumentInventory(rawPayload: Record<string, unknown>) {
  return readRecordArray(rawPayload.documents).map(compactSourceInventoryRecord);
}

function compactSourceInventoryRecord(item: Record<string, unknown>) {
  return {
    exhibitNumber: stringValue(item.exhibitNumber) || null,
    type: stringValue(item.type) || null,
    description: truncateCompactContextText(stringValue(item.description), 240) || null,
    filename: stringValue(item.filename) || null,
    textAvailable:
      typeof item.textAvailable === "boolean"
        ? item.textAvailable
        : typeof item.text_char_count === "number" || typeof item.textCharCount === "number",
    textCharCount: numberValue(item.textCharCount) ?? numberValue(item.text_char_count),
    textTruncated: item.textTruncated === true || item.text_truncated === true,
  };
}

function readOwnershipParentSearchText(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const attachmentText = readRecordArray(rawPayload.attachment_texts)
    .map((attachment) => stringValue(attachment.text))
    .filter(Boolean)
    .join("\n");
  return [
    row.title,
    rawPayload.ownership_source_text,
    metadata.ownership_source_text,
    row.body_text,
    row.analysis_text,
    attachmentText,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n")
    .slice(0, 500_000);
}

function readOwnershipXmlValues(text: string, tag: string) {
  return Array.from(text.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "gi")))
    .map((match) => stripSearchTags(match[1]))
    .filter(Boolean);
}

function readOwnershipNestedXmlValues(text: string, parentTag: string, childTag: string) {
  return Array.from(text.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${parentTag}>`, "gi")))
    .flatMap((match) => readOwnershipXmlValues(match[1], childTag))
    .filter(Boolean);
}

function extractOwnershipReferencedDates(text: string) {
  const dates = [
    ...Array.from(text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)).map(
      (match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
    ),
    ...Array.from(
      text.matchAll(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/gi,
      ),
    ).map((match) => normalizeDateOnly(`${match[1]} ${match[2]}, ${match[3]}`)),
  ];
  return uniqueStrings(dates.map(normalizeDateOnly).filter(Boolean));
}

function stripSearchTags(value: string) {
  return stringValue(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function rawRowToS3ParseInput(row: SecRawItemRow) {
  return {
    rawItemId: stringValue(row.id),
    sourceUniqueId: stringValue(row.source_unique_id),
    sourceUrl: stringValue(row.source_url),
    title: stringValue(row.title),
    publishedAt: stringValue(row.published_at),
    bodyText: stringValue(row.body_text),
    analysisText: stringValue(row.analysis_text),
    rawPayload: row.raw_payload,
    metadata: row.metadata,
  };
}

function rawRowToSc13ParseInput(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const attachmentTexts = readRecordArray(rawPayload.attachment_texts)
    .map((attachment) => ({
      type: stringValue(attachment.type) || null,
      description: stringValue(attachment.description) || null,
      url: stringValue(attachment.url) || null,
      text: stringValue(attachment.text),
    }))
    .filter((attachment) => attachment.text);

  return {
    formType: readRawFormType(row),
    accessionNumber: readRawAccession(row) || null,
    issuerName: readRawCompanyName(row) || null,
    companyName: readRawCompanyName(row) || null,
    primaryTicker: {
      ticker: readRawTicker(row) || null,
      exchange: stringValue(rawPayload.exchange) || stringValue(metadata.exchange) || null,
    },
    filedAt: stringValue(row.published_at) || readRawFiledDate(row) || null,
    text: stringValue(row.analysis_text) || stringValue(row.body_text),
    attachments: attachmentTexts,
  };
}

function readS8PriorRegistrationFileNumbers(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s8 = readRecord(hardParsers?.s8);
  const facts = readRecord(s8?.facts);
  const statements = readRecordArray(facts?.priorRegistrationStatements);
  return uniqueStrings(
    statements.map((statement) => normalizeRegistrationFileNumber(stringValue(statement.fileNumber))).filter(Boolean),
  );
}

function readS1F1ParentRegistrationFileNumbers(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s1f1 = readRecord(hardParsers?.["s1-f1"]) || readRecord(hardParsers?.s1_f1);
  const facts = readRecord(s1f1?.facts);
  const filing = readRecord(facts?.filing);
  const rule462b = readRecord(filing?.rule_462b);
  return uniqueStrings(
    [
      stringValue(filing?.parent_registration_number),
      stringValue(rule462b?.prior_registration_number),
      stringValue(filingPackage?.file_number),
    ]
      .map(normalizeRegistrationFileNumber)
      .filter(Boolean),
  );
}

function extractRegistrationFileNumbersFromRow(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const text = [
    stringValue(rawPayload.file_number),
    stringValue(rawPayload.fileNumber),
    stringValue(metadata.file_number),
    stringValue(metadata.fileNumber),
    stringValue(rawPayload.primary_document_html),
    stringValue(row.body_text),
    stringValue(row.analysis_text),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 250_000);
  const matches = text.match(/\b333-\d{3,}\b/g) || [];
  return uniqueStrings(matches.map(normalizeRegistrationFileNumber).filter(Boolean));
}

function readEffectRegistrationFileNumbers(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers);
  const effect = readRecord(hardParsers?.effect);
  const facts = readRecord(effect?.facts);
  const primaryFiler = readRecord(facts?.primaryFiler) || readRecord(facts?.primary_filer);
  const filers = readRecordArray(facts?.filers);
  return uniqueStrings(
    [
      stringValue(facts?.registrationNumber),
      stringValue(facts?.registration_number),
      stringValue(primaryFiler?.fileNumber),
      stringValue(primaryFiler?.file_number),
      stringValue(filingPackage.file_number),
      stringValue(filingPackage.fileNumber),
      ...filers.flatMap((filer) => [stringValue(filer.fileNumber), stringValue(filer.file_number)]),
      ...extractRegistrationFileNumbersFromRow(rawItem),
    ]
      .map(normalizeRegistrationFileNumber)
      .filter(Boolean),
  );
}

function readEffectTargetRegistrationForm(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers);
  const effect = readRecord(hardParsers?.effect);
  const facts = readRecord(effect?.facts);
  return (
    stringValue(facts?.effectiveFilingForm) ||
    stringValue(facts?.effective_filing_form) ||
    stringValue(facts?.registrationForm) ||
    stringValue(facts?.registration_form) ||
    stringValue(filingPackage.effective_filing_form) ||
    stringValue(filingPackage.registration_form)
  );
}

function resolveTenderSubjectMarketContextSymbol(filingPackage: Record<string, unknown>) {
  const adapter = readRecord(filingPackage.form_adapter);
  if (stringValue(adapter?.parserGroup) !== "tender") return null;

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const tenderParser = readRecord(hardParsers?.tender);
  const facts = readRecord(tenderParser?.facts);
  if (!facts) return null;

  const tenderCase = stringValue(facts.tender_case);
  const secFormType = stringValue(facts.sec_form_type);
  if (Boolean(facts.issuer_tender) || /issuer[_\s-]?tender|issuer[_\s-]?repurchase/i.test(tenderCase)) return null;
  if (
    !/third[_\s-]?party|going[_\s-]?private|13e-?3|cash[_\s-]?out|merger/i.test(tenderCase) &&
    !/^SC\s+TO-T/i.test(secFormType) &&
    !/^SC\s+13E3/i.test(secFormType)
  ) {
    return null;
  }

  const subjectCompany = resolveTenderSubjectCompanyName(filingPackage);
  const sourceText = [
    filingPackage.llm_text,
    readRecord(readRecord(tenderParser?.raw)?.source_package)?.text,
    facts.source_text,
  ]
    .map((item) => (typeof item === "object" && item !== null ? JSON.stringify(item) : stringValue(item)))
    .filter(Boolean)
    .join("\n");

  return extractExchangeTickerNearCompany(sourceText, subjectCompany);
}

function resolveTenderSubjectCompanyName(filingPackage: Record<string, unknown>) {
  const adapter = readRecord(filingPackage.form_adapter);
  if (stringValue(adapter?.parserGroup) !== "tender") return "";

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const tenderParser = readRecord(hardParsers?.tender);
  const facts = readRecord(tenderParser?.facts);
  if (!facts) return "";

  const coverPage = readRecord(facts.cover_page);
  return (
    stringValue(readRecord(coverPage?.subject_company)?.value) ||
    stringValue(readRecord(facts.subject_company)?.value) ||
    stringValue(facts.subject_company) ||
    stringValue(facts.target_company)
  );
}

function extractExchangeTickerNearCompany(sourceText: string, companyName: string) {
  const text = sourceText.replace(/\s+/g, " ").trim();
  if (!text || !companyName) return null;
  const companyPattern = escapeRegExp(companyName).replace(/\\\s+/g, "\\s+");
  const exchangeTickerPattern = String.raw`(?:NYSE(?:\s+American|\s+Arca)?|Nasdaq|NASDAQ|OTC(?:QB|QX)?|Cboe)\s*:\s*([A-Z][A-Z0-9.\-]{0,9})`;
  const afterCompany = new RegExp(`${companyPattern}.{0,180}${exchangeTickerPattern}`, "i").exec(text);
  const afterTicker = afterCompany?.[1] ? normalizeMarketContextTicker(afterCompany[1]) : null;
  if (afterTicker) return afterTicker;

  const beforeCompany = new RegExp(`${exchangeTickerPattern}.{0,180}${companyPattern}`, "i").exec(text);
  const beforeTicker = beforeCompany?.[1] ? normalizeMarketContextTicker(beforeCompany[1]) : null;
  return beforeTicker;
}

function extractExplicitParentAccessionForAmendment(input: SecFilingAnalysisInput, rawItem: SecRawItemRow) {
  const currentAccession = readRawAccession(rawItem);
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const parserText = Object.values(hardParsers)
    .map((item) => JSON.stringify(readRecord(item) || {}))
    .join("\n")
    .slice(0, 80_000);
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const text = [
    rawItem.title,
    rawItem.analysis_text,
    rawPayload.previous_accession_number,
    rawPayload.parent_accession_number,
    rawPayload.parentAccessionNumber,
    metadata.previous_accession_number,
    metadata.parent_accession_number,
    metadata.parentAccessionNumber,
    parserText,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n")
    .slice(0, 180_000);

  const accessions = uniqueStrings([...text.matchAll(/\b\d{10}-\d{2}-\d{6}\b/g)].map((match) => match[0]));
  return accessions.find((accession) => accession !== currentAccession) || "";
}

function readExplicitCurrentReportParentReference(
  input: SecFilingAnalysisInput,
  formType: string,
): ExplicitCurrentReportParentReference | null {
  const normalizedFormType = normalizeSecFormForParentContext(formType);
  if (normalizedFormType !== "8-K/A" && normalizedFormType !== "6-K/A") return null;

  const expectedParentForm = normalizeGenericParentFormFamily(normalizedFormType) as "8-K" | "6-K";
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const parser = readRecord(hardParsers["8k-6k"]);
  const facts = readRecord(parser?.facts);
  const referencedFilings = readRecordArray(facts?.referencedFilings);

  for (const reference of referencedFilings) {
    if (normalizeGenericParentFormFamily(stringValue(reference.formType)) !== expectedParentForm) continue;
    const filedDate = normalizeDateOnly(stringValue(reference.filedDate));
    if (!filedDate) continue;
    return {
      formType: expectedParentForm,
      filedDate,
      accessionNumber: stringValue(reference.accessionNumber),
      source: "referenced_filings",
    };
  }

  const amendment = readRecord(facts?.amendment);
  const filedDate = normalizeDateOnly(stringValue(amendment?.parentFiledDate));
  if (!filedDate) return null;
  return {
    formType: expectedParentForm,
    filedDate,
    accessionNumber: stringValue(amendment?.parentAccessionNumber),
    source: "amendment_parent_filed_date",
  };
}

function extractExplicitParentAccessionFromRawItem(rawItem: SecRawItemRow) {
  const currentAccession = readRawAccession(rawItem);
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const text = [
    rawItem.title,
    rawItem.analysis_text,
    rawPayload.previous_accession_number,
    rawPayload.previousAccessionNumber,
    rawPayload.parent_accession_number,
    rawPayload.parentAccessionNumber,
    metadata.previous_accession_number,
    metadata.previousAccessionNumber,
    metadata.parent_accession_number,
    metadata.parentAccessionNumber,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n")
    .slice(0, 80_000);
  const accessions = uniqueStrings([...text.matchAll(/\b\d{10}-\d{2}-\d{6}\b/g)].map((match) => match[0]));
  return accessions.find((accession) => accession !== currentAccession) || "";
}

function isOwnershipAmendmentFormForParentParser(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  return normalized === "4/A" || normalized === "144/A";
}

function isOwnershipParentFamilyMatch(currentFormType: string, parentFormType: string) {
  const current = normalizeGenericParentFormFamily(currentFormType);
  const parent = normalizeGenericParentFormFamily(parentFormType);
  return (current === "4" && parent === "4") || (current === "144" && parent === "144");
}

function isSecAmendmentFormForParentContext(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  return normalized.endsWith("/A") || normalized === "S-8 POS";
}

function isS3F3RegistrationFamilyForm(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType).replace(/\s+/g, "");
  return /^(?:S-3|S-3ASR|S-3MEF|S-3\/A|F-3|F-3ASR|F-3MEF|F-3\/A)$/.test(normalized);
}

function isS3F3RegistrationAmendmentForm(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType).replace(/\s+/g, "");
  return normalized === "S-3/A" || normalized === "F-3/A";
}

function isSc13ParentContextFamily(value: string) {
  return value === "SC 13D" || value === "SC 13G";
}

function isTenderParentContextFamily(value: string) {
  return (
    value === "SC TO-C" ||
    value === "SC TO-I" ||
    value === "SC TO-T" ||
    value === "SC 13E3" ||
    value === "CB" ||
    value === "SC 14D9"
  );
}

function isS1F1ParentContextFamily(value: string) {
  return value === "S-1" || value === "F-1";
}

function isEffectOriginalRegistrationCandidateFamily(value: string) {
  return (
    value === "S-1" ||
    value === "F-1" ||
    value === "S-3" ||
    value === "F-3" ||
    value === "S-4" ||
    value === "F-4" ||
    value === "S-8" ||
    value === "N-2" ||
    value === "N-14"
  );
}

function isS1F1AmendmentParentContextForm(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  return (
    normalized === "S-1/A" ||
    normalized === "F-1/A" ||
    normalized === "S-1MEF" ||
    normalized === "F-1MEF" ||
    normalized === "POS AM"
  );
}

function normalizeGenericParentFormFamily(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  if (!normalized) return "";
  if (normalized === "S-8 POS") return "S-8";
  return normalized.replace(/\/A$/, "");
}

function normalizeSecFormForParentContext(formType: string) {
  return stringValue(formType)
    .toUpperCase()
    .replace(/^FORM\s+/, "")
    .replace(/^SCHEDULE\s+/, "SC ")
    .replace(/^SC\s+13E-3/, "SC 13E3")
    .replace(/\s*\/\s*A$/, "/A")
    .replace(/\s+/g, " ")
    .trim();
}

function readPeriodicReportingPeriodFromInput(input: SecFilingAnalysisInput) {
  return readPeriodicReportingPeriodFromFilingPackage(input.filing_package);
}

function isSec425TransactionContextCandidateForm(formType: string) {
  const normalized = normalizeSec425TransactionContextForm(formType);
  return [
    "S-4",
    "S-4/A",
    "F-4",
    "F-4/A",
    "DEFM14A",
    "PREM14A",
    "DEFA14A",
    "DEF 14A",
    "PRE 14A",
    "8-K",
    "8-K/A",
    "6-K",
    "6-K/A",
    "425",
    "SC TO-C",
    "SC TO-T",
    "SC TO-I",
    "SC 13E3",
    "SC 14D9",
    "CB",
    "424B3",
  ].includes(normalized);
}

function isPriorSecFiling(row: SecRawItemRow, currentFiledAt: string | null) {
  const current = Date.parse(stringValue(currentFiledAt));
  const candidate = Date.parse(stringValue(row.published_at) || readRawFiledDate(row));
  if (!Number.isFinite(current) || !Number.isFinite(candidate)) return true;
  return candidate < current;
}

function compactContextText(value: unknown, maxChars: number) {
  const text = stringValue(value).replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxChars) return text || null;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeCompanyNameForParentMatch(value: string) {
  return stringValue(value)
    .toUpperCase()
    .replace(/&AMP;/g, "&")
    .replace(/\b(?:INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|PLC|S\.?A\.?|N\.?V\.?)\b\.?/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableName(value: string) {
  return stringValue(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(?:THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L L C|LTD|LIMITED|LP|L P|PLC|AG|SA|N V)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePersonName(value: string) {
  return stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCik(value: string) {
  const digits = stringValue(value).replace(/\D/g, "");
  return digits ? digits.replace(/^0+/, "") || "0" : "";
}

function normalizeDateOnly(value: string) {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeRegistrationFileNumber(value: string) {
  const match = stringValue(value).match(/333-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function normalizeSc13CusipForSearch(value: string) {
  const normalized = stringValue(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{9}$/.test(normalized) ? normalized : "";
}

function normalizeMarketContextTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NONE" || ticker === "NULL") return null;
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return null;
  return ticker;
}

function normalizeS3MoneyAmount(field: { value?: { amount?: number | null; scale?: string | null } | null } | null) {
  const amount = numberValue(field?.value?.amount);
  if (!amount) return 0;
  const scale = stringValue(field?.value?.scale).toLowerCase();
  if (scale === "billion") return amount * 1_000_000_000;
  if (scale === "million") return amount * 1_000_000;
  if (scale === "thousand") return amount * 1_000;
  return amount;
}

function sameS3TextField(left: { value?: string | null } | null, right: { value?: string | null } | null) {
  const leftValue = stringValue(left?.value).toLowerCase();
  const rightValue = stringValue(right?.value).toLowerCase();
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function sameS3CountField(left: { value?: number | null; text?: string | null } | null, right: { value?: number | null; text?: string | null } | null) {
  const leftValue = numberValue(left?.value) || parseFirstPositiveNumber(left?.text);
  const rightValue = numberValue(right?.value) || parseFirstPositiveNumber(right?.text);
  return Boolean(leftValue && rightValue && Math.abs(leftValue - rightValue) <= 1);
}

function sameS3MoneyField(
  left: { value?: { amount?: number | null; scale?: string | null } | null; text?: string | null } | null,
  right: { value?: { amount?: number | null; scale?: string | null } | null; text?: string | null } | null,
) {
  const leftValue = normalizeS3MoneyAmount(left);
  const rightValue = normalizeS3MoneyAmount(right);
  if (leftValue && rightValue) return Math.abs(leftValue - rightValue) <= Math.max(1, leftValue * 0.001);

  const leftText = normalizeNumericText(left?.text);
  const rightText = normalizeNumericText(right?.text);
  return Boolean(leftText && rightText && leftText === rightText);
}

function sameRegistrationNumber(left: string | null | undefined, right: string | null | undefined) {
  const normalize = (value: string | null | undefined) => stringValue(value).replace(/\D/g, "");
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function readRawCik(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return stringValue(rawPayload?.cik) || stringValue(metadata?.cik);
}

function readRawFiledDate(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  return stringValue(rawPayload?.filing_date) || stringValue(row.published_at);
}

function readRawTicker(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return (stringValue(rawPayload?.ticker) || stringValue(metadata?.ticker)).toUpperCase();
}

function readRawCompanyName(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return (
    stringValue(rawPayload?.company_name) ||
    stringValue(rawPayload?.companyName) ||
    stringValue(metadata?.company_name) ||
    stringValue(metadata?.companyName) ||
    stringValue(metadata?.issuer)
  );
}

function readRawAccession(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  return stringValue(rawPayload?.accession_number) || stringValue(row.source_unique_id);
}

function readRawFormType(row: SecRawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  const storedFormType = stringValue(rawPayload?.form_type) || stringValue(metadata?.form_type);
  const documents = readRecordArray(rawPayload?.documents);
  const primaryDocumentType =
    stringValue(documents.find((document) => Boolean(document.isPrimary))?.type) ||
    stringValue(documents[0]?.type);
  return chooseRawRowFormType(storedFormType, primaryDocumentType);
}

function chooseRawRowFormType(storedFormType: string, primaryDocumentType: string) {
  const stored = normalizeRawRowFormType(storedFormType);
  const primary = normalizeRawRowFormType(primaryDocumentType);
  if (!stored) return primary;
  if (!primary) return stored;
  if (stored === primary) return stored;

  const storedBase = stored.replace(/\/A$/, "");
  const primaryBase = primary.replace(/\/A$/, "");
  if (primary.endsWith("/A") && storedBase === primaryBase) return primary;

  return stored;
}

function normalizeRawRowFormType(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ");
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function truncateCompactContextText(value: string, maxChars: number) {
  const text = stringValue(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}

function normalizeNumericText(value: unknown) {
  return stringValue(value).replace(/[^0-9.]+/g, "");
}

function parseFirstPositiveNumber(value: unknown) {
  const match = stringValue(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = stringValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function dedupeRawRows(rows: SecRawItemRow[]) {
  const seen = new Set<string>();
  const deduped: SecRawItemRow[] = [];
  for (const row of rows) {
    const key = stringValue(row.id) || readRawAccession(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function uniqueRawRows(rows: SecRawItemRow[]) {
  const seen = new Set<string>();
  const result: SecRawItemRow[] = [];
  for (const row of rows) {
    const key = stringValue(row.id) || readRawAccession(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function intersects(left: string[], right: string[]) {
  const rightSet = new Set(right.filter(Boolean));
  return left.some((value) => rightSet.has(value));
}

function intersectStrings(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
