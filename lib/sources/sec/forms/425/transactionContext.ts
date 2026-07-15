export const SEC_425_TRANSACTION_CONTEXT_VERSION = "sec_425_transaction_context_v1";

export const SEC_425_TRANSACTION_CONTEXT_FORMS = [
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
] as const;

export type Sec425TransactionContextCurrent = {
  accession_number: string | null;
  filed_at: string | null;
  cik: string | null;
  ticker: string | null;
  company_name: string | null;
  related_names: string[];
};

export type Sec425TransactionContextCandidate = {
  raw_item_id: string;
  event_id: string | null;
  accession_number: string | null;
  form_type: string | null;
  filed_at: string | null;
  cik: string | null;
  ticker: string | null;
  company_name: string | null;
  event_type: string | null;
  event_title: string | null;
  quick_take: string | null;
  summary: string | null;
  transaction_fingerprint: Record<string, unknown> | null;
};

export type Sec425RankedTransactionContextCandidate = Sec425TransactionContextCandidate & {
  match_score: number;
  match_reasons: string[];
  matched_related_names: string[];
  age_days: number | null;
};

export type Sec425TransactionContextMatchPlan = {
  status: "found" | "not_found" | "multiple_candidates";
  confidence: "high" | "medium" | "low";
  selected: Sec425RankedTransactionContextCandidate[];
  candidates: Sec425RankedTransactionContextCandidate[];
};

const SUPPORTED_FORMS = new Set<string>(SEC_425_TRANSACTION_CONTEXT_FORMS);

export function buildSec425TransactionContextMatchPlan(
  current: Sec425TransactionContextCurrent,
  candidates: Sec425TransactionContextCandidate[],
): Sec425TransactionContextMatchPlan {
  const currentTime = parseDate(current.filed_at);
  const currentCompany = normalizeEntityName(current.company_name);
  const relatedNames = uniqueStrings(current.related_names.map(normalizeEntityName).filter(Boolean)).filter(
    (name) => name !== currentCompany,
  );

  const ranked = candidates
    .map((candidate) => rankCandidate({ current, currentTime, currentCompany, relatedNames, candidate }))
    .filter((candidate): candidate is Sec425RankedTransactionContextCandidate => Boolean(candidate))
    .filter((candidate) => candidate.match_score >= 120)
    .sort((left, right) => {
      if (right.match_score !== left.match_score) return right.match_score - left.match_score;
      return (parseDate(right.filed_at) || 0) - (parseDate(left.filed_at) || 0);
    });

  if (!ranked.length) {
    return { status: "not_found", confidence: "low", selected: [], candidates: [] };
  }

  const top = ranked[0];
  const second = ranked[1];
  const ambiguous = Boolean(
    second &&
      top.match_score - second.match_score < 15 &&
      top.matched_related_names.length === 0 &&
      second.matched_related_names.length === 0,
  );
  const selected = ranked
    .filter((candidate, index) => {
      if (index === 0) return true;
      if (candidate.match_score < top.match_score - 45) return false;
      if (top.matched_related_names.length || candidate.matched_related_names.length) {
        return intersects(top.matched_related_names, candidate.matched_related_names);
      }
      return candidate.cik === top.cik && candidate.event_type === top.event_type;
    })
    .slice(0, 3);

  return {
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : top.match_score >= 240 ? "high" : "medium",
    selected,
    candidates: ranked.slice(0, 5),
  };
}

export function normalizeSec425TransactionContextForm(value: string | null | undefined) {
  return String(value || "")
    .toUpperCase()
    .replace(/^FORM\s+/, "")
    .replace(/^SCHEDULE\s+/, "SC ")
    .replace(/^SC\s+13E-3/, "SC 13E3")
    .replace(/\s*\/\s*A$/, "/A")
    .replace(/\s+/g, " ")
    .trim();
}

function rankCandidate({
  current,
  currentTime,
  currentCompany,
  relatedNames,
  candidate,
}: {
  current: Sec425TransactionContextCurrent;
  currentTime: number | null;
  currentCompany: string;
  relatedNames: string[];
  candidate: Sec425TransactionContextCandidate;
}): Sec425RankedTransactionContextCandidate | null {
  if (!candidate.raw_item_id || !candidate.event_id) return null;
  if (candidate.accession_number && candidate.accession_number === current.accession_number) return null;

  const form = normalizeSec425TransactionContextForm(candidate.form_type);
  if (!SUPPORTED_FORMS.has(form)) return null;

  const candidateTime = parseDate(candidate.filed_at);
  if (currentTime !== null && candidateTime !== null && candidateTime >= currentTime) return null;
  const ageDays =
    currentTime !== null && candidateTime !== null
      ? Math.max(0, Math.round((currentTime - candidateTime) / 86_400_000))
      : null;
  if (ageDays !== null && ageDays > 1_095) return null;

  const sameCik = Boolean(current.cik && candidate.cik && normalizeCik(current.cik) === normalizeCik(candidate.cik));
  const sameTicker = Boolean(
    current.ticker && candidate.ticker && current.ticker.toUpperCase() === candidate.ticker.toUpperCase(),
  );
  const sameCompany = Boolean(
    currentCompany && normalizeEntityName(candidate.company_name) === currentCompany,
  );
  const searchableText = normalizeEntityName(
    [
      candidate.company_name,
      candidate.event_title,
      candidate.quick_take,
      candidate.summary,
      candidate.transaction_fingerprint ? JSON.stringify(candidate.transaction_fingerprint) : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
  const matchedRelatedNames = relatedNames.filter((name) => entityTextIncludes(searchableText, name));
  const hasIssuerAnchor = sameCik || sameTicker || sameCompany;
  if (!hasIssuerAnchor && !matchedRelatedNames.length) return null;
  if (relatedNames.length && searchableText && !matchedRelatedNames.length) return null;

  const reasons: string[] = [];
  let score = 0;
  if (sameCik) {
    score += 80;
    reasons.push("same_cik");
  }
  if (sameTicker) {
    score += 30;
    reasons.push("same_ticker");
  }
  if (sameCompany) {
    score += 25;
    reasons.push("same_company");
  }
  if (matchedRelatedNames.length) {
    score += 100 + Math.min(40, (matchedRelatedNames.length - 1) * 20);
    reasons.push("transaction_party_match");
  }

  if (candidate.event_type === "strategic_transaction") {
    score += 55;
    reasons.push("strategic_transaction_analysis");
  } else if (candidate.event_type === "shareholder_vote") {
    score += 30;
    reasons.push("transaction_vote_analysis");
  } else if (["listing_risk", "ipo_listing"].includes(candidate.event_type || "")) {
    score += 15;
    reasons.push("transaction_lifecycle_analysis");
  }

  const familyScore = transactionFormScore(form);
  score += familyScore;
  reasons.push(`form_${form.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`);

  if (candidate.transaction_fingerprint && Object.keys(candidate.transaction_fingerprint).length) {
    score += 25;
    reasons.push("transaction_fingerprint_present");
  }
  if (ageDays !== null) {
    if (ageDays <= 90) score += 25;
    else if (ageDays <= 365) score += 15;
    else score += 5;
    reasons.push(`filed_${ageDays}_days_before`);
  }

  return {
    ...candidate,
    match_score: score,
    match_reasons: reasons,
    matched_related_names: matchedRelatedNames,
    age_days: ageDays,
  };
}

function transactionFormScore(form: string) {
  if (["S-4", "S-4/A", "F-4", "F-4/A"].includes(form)) return 50;
  if (["DEFM14A", "PREM14A", "DEFA14A", "SC TO-C", "SC TO-T", "SC TO-I", "SC 13E3", "SC 14D9", "CB"].includes(form)) return 45;
  if (["8-K", "8-K/A", "6-K", "6-K/A"].includes(form)) return 40;
  if (["DEF 14A", "PRE 14A", "424B3"].includes(form)) return 30;
  if (form === "425") return 15;
  return 0;
}

function normalizeEntityName(value: string | null | undefined) {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(?:THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|LTD|LIMITED|LP|PLC|AG|SA|NV)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entityTextIncludes(text: string, entity: string) {
  if (!text || !entity) return false;
  if (text.includes(entity)) return true;
  const entityTokens = entity.split(" ").filter((token) => token.length >= 3);
  return entityTokens.length >= 2 && entityTokens.every((token) => text.includes(token));
}

function normalizeCik(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.replace(/^0+/, "") || "0";
}

function parseDate(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function intersects(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}
