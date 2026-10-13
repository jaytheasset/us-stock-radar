import type { Sc13VerifiedReporterIdentity } from "./reporterIdentity.ts";
export const SC13_LINEAGE_VERSION = "sec_sc13_lineage_v1" as const;

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CURRENT_FIELD_KEYS = [
  "soleVotingPowerRaw",
  "sharedVotingPowerRaw",
  "soleDispositivePowerRaw",
  "sharedDispositivePowerRaw",
  "aggregateAmountOwnedRaw",
  "percentOfClassRaw",
] as const;

export type Sc13CurrentFieldKey = typeof CURRENT_FIELD_KEYS[number];

export type Sc13LineageReporter = Readonly<{
  identityProvenance?: Sc13VerifiedReporterIdentity;
  reportingPersonIndex: number;
  reportingPersonCik: string | null;
  reportingPersonNameRaw: string;
  values: Readonly<Record<Sc13CurrentFieldKey, string | null>>;
}>;

export type Sc13LineageFiling = Readonly<{
  accessionNumber: string;
  formTypeRaw: string;
  previousAccessionNumberRaw: string | null;
  amendmentNumber: number | null;
  filedAt: string | null;
  eventDate: string;
  headerFilerCik: string;
  issuerCik: string;
  securityClassRaw: string;
  cusipsRaw: readonly string[];
  reporters: readonly Sc13LineageReporter[];
}>;

export type Sc13LineageLink = Readonly<{
  accessionNumber: string;
  referencedAccessionNumber: string | null;
  status: "linked" | "unresolved";
  reason: string | null;
  evidence: "xml_previous_accession_number" | "none";
}>;

export type Sc13CurrentField =
  | Readonly<{
      status: "available";
      valueRaw: string;
      sourceAccessionNumber: string;
      lastReported: Readonly<{ valueRaw: string; sourceAccessionNumber: string }>;
    }>
  | Readonly<{
      status: "unresolved";
      valueRaw: null;
      sourceAccessionNumber: null;
      reason: "current_filing_field_missing";
      lastReported: Readonly<{ valueRaw: string; sourceAccessionNumber: string }> | null;
    }>;

export type Sc13CurrentReporter = Readonly<{
  identityProvenance?: Sc13VerifiedReporterIdentity;
  reportingPersonCik: string;
  reportingPersonNameRaw: string;
  sourceAccessionNumber: string;
  values: Readonly<Record<Sc13CurrentFieldKey, Sc13CurrentField>>;
}>;

export type Sc13StoredPosition =
  | Readonly<{
      status: "available_stored_history";
      scope: "complete_stored_history_not_sec_global";
      version: typeof SC13_LINEAGE_VERSION;
      positionKey: string;
      issuerCik: string;
      formFamily: "SCHEDULE 13D" | "SCHEDULE 13G";
      securityClassRaw: string;
      cusipsRaw: readonly string[];
      rootAccessionNumber: string;
      headAccessionNumber: string;
      orderedAccessions: readonly string[];
      currentReporters: readonly Sc13CurrentReporter[];
      issues: readonly [];
    }>
  | Readonly<{
      status: "unresolved";
      scope: "complete_stored_history_not_sec_global";
      version: typeof SC13_LINEAGE_VERSION;
      positionKey: string;
      issuerCik: string;
      formFamily: "SCHEDULE 13D" | "SCHEDULE 13G";
      securityClassRaw: string;
      cusipsRaw: readonly string[];
      rootAccessionNumber: string | null;
      headAccessionNumber: null;
      orderedAccessions: readonly string[];
      currentReporters: readonly [];
      issues: readonly string[];
    }>;

export type Sc13StoredLineageProjection = Readonly<{
  version: typeof SC13_LINEAGE_VERSION;
  scope: "complete_stored_history_not_sec_global";
  secGlobalCompleteness: "not_verified";
  links: readonly Sc13LineageLink[];
  positions: readonly Sc13StoredPosition[];
}>;

export function resolveSc13StoredLineage(
  filings: readonly Sc13LineageFiling[],
): Sc13StoredLineageProjection {
  const byAccession = new Map(filings.map((filing) => [filing.accessionNumber, filing]));
  const links = new Map<string, Sc13LineageLink>();
  const referencedIdentityProblems = new Map<string, string[]>();

  for (const filing of filings) {
    if (!isAmendment(filing)) continue;
    const link = resolveLink(filing, byAccession);
    links.set(filing.accessionNumber, link);
    if (link.status === "unresolved" && link.referencedAccessionNumber && byAccession.has(link.referencedAccessionNumber)) {
      const problems = referencedIdentityProblems.get(link.referencedAccessionNumber) ?? [];
      problems.push(`referenced_by_unresolved_amendment:${filing.accessionNumber}:${link.reason}`);
      referencedIdentityProblems.set(link.referencedAccessionNumber, problems);
    }
  }

  const groups = new Map<string, Sc13LineageFiling[]>();
  for (const filing of filings) {
    const key = positionKey(filing);
    const group = groups.get(key) ?? [];
    group.push(filing);
    groups.set(key, group);
  }

  const crossGroupProblems = resolveCrossGroupProblems(groups, links);

  const positions = [...groups.entries()]
    .map(([key, group]) => projectPosition(key, group, links, referencedIdentityProblems, crossGroupProblems.get(key) ?? []))
    .sort((left, right) => left.positionKey.localeCompare(right.positionKey));

  return {
    version: SC13_LINEAGE_VERSION,
    scope: "complete_stored_history_not_sec_global",
    secGlobalCompleteness: "not_verified",
    links: [...links.values()].sort((left, right) => left.accessionNumber.localeCompare(right.accessionNumber)),
    positions,
  };
}

function resolveLink(
  filing: Sc13LineageFiling,
  byAccession: ReadonlyMap<string, Sc13LineageFiling>,
): Sc13LineageLink {
  const rawReference = filing.previousAccessionNumberRaw?.trim() ?? "";
  const referenced = normalizedAccession(filing.previousAccessionNumberRaw);
  const unresolved = (reason: string): Sc13LineageLink => ({
    accessionNumber: filing.accessionNumber,
    referencedAccessionNumber: referenced,
    status: "unresolved",
    reason,
    evidence: referenced ? "xml_previous_accession_number" : "none",
  });
  if (!rawReference) return unresolved("previous_accession_missing");
  if (!referenced) return unresolved("previous_accession_invalid");
  const predecessor = byAccession.get(referenced);
  if (!predecessor) return unresolved("missing_predecessor");
  if (filing.issuerCik !== predecessor.issuerCik) return unresolved("issuer_identity_mismatch");
  if (filing.headerFilerCik !== predecessor.headerFilerCik) return unresolved("header_filer_identity_mismatch");
  if (formFamily(filing.formTypeRaw) !== formFamily(predecessor.formTypeRaw)) {
    return unresolved("form_family_mismatch");
  }
  if (normalizeClass(filing.securityClassRaw) !== normalizeClass(predecessor.securityClassRaw)) {
    return unresolved("security_class_identity_mismatch");
  }
  if (!sameStrings(normalizeCusips(filing.cusipsRaw), normalizeCusips(predecessor.cusipsRaw))) {
    return unresolved("cusip_identity_mismatch");
  }
  const filingReporterKeys = reporterKeys(filing);
  const predecessorReporterKeys = reporterKeys(predecessor);
  if (!filingReporterKeys || !predecessorReporterKeys) return unresolved("reporter_identity_unverified");
  if (!sameStrings(filingReporterKeys, predecessorReporterKeys)) return unresolved("reporter_identity_mismatch");
  const amendmentNumber = filing.amendmentNumber;
  const predecessorNumber = filingNumber(predecessor);
  if (!Number.isInteger(amendmentNumber) || amendmentNumber! < 1) return unresolved("amendment_number_missing_or_invalid");
  if (predecessorNumber === null || predecessorNumber >= amendmentNumber!) return unresolved("amendment_order_reversed");
  const filedAt = exactTime(filing.filedAt);
  const predecessorFiledAt = exactTime(predecessor.filedAt);
  if (filedAt === null || predecessorFiledAt === null) return unresolved("filing_order_unverified");
  if (filedAt <= predecessorFiledAt) return unresolved("filing_order_reversed");
  return {
    accessionNumber: filing.accessionNumber,
    referencedAccessionNumber: referenced,
    status: "linked",
    reason: null,
    evidence: "xml_previous_accession_number",
  };
}

function projectPosition(
  key: string,
  input: readonly Sc13LineageFiling[],
  links: ReadonlyMap<string, Sc13LineageLink>,
  referencedIdentityProblems: ReadonlyMap<string, readonly string[]>,
  crossGroupProblems: readonly string[],
): Sc13StoredPosition {
  const group = [...input].sort(compareFilingNumber);
  const sample = group[0]!;
  const issues: string[] = [...crossGroupProblems];
  const roots = group.filter((filing) => !isAmendment(filing));
  if (roots.length !== 1) issues.push(roots.length === 0 ? "root_missing" : "multiple_unlinked_roots");
  const root = roots.length === 1 ? roots[0]! : null;
  for (const filing of group) {
    if (!ACCESSION_PATTERN.test(filing.accessionNumber)) issues.push(`invalid_accession:${filing.accessionNumber}`);
    if (!reporterKeys(filing)) issues.push(`reporter_identity_unverified:${filing.accessionNumber}`);
    for (const problem of referencedIdentityProblems.get(filing.accessionNumber) ?? []) issues.push(problem);
    if (!isAmendment(filing) && (filing.previousAccessionNumberRaw !== null || filing.amendmentNumber !== null)) {
      issues.push(`root_amendment_metadata_invalid:${filing.accessionNumber}`);
    }
    if (isAmendment(filing)) {
      const link = links.get(filing.accessionNumber);
      if (!link || link.status !== "linked") issues.push(`lineage_unresolved:${filing.accessionNumber}:${link?.reason ?? "missing_resolution"}`);
      else if (!group.some((candidate) => candidate.accessionNumber === link.referencedAccessionNumber)) {
        issues.push(`linked_target_outside_position:${filing.accessionNumber}`);
      }
    }
  }

  const amendments = group.filter(isAmendment);
  const numbers = amendments.map((filing) => filing.amendmentNumber);
  if (numbers.some((value) => !Number.isInteger(value) || value! < 1)) issues.push("amendment_number_missing_or_invalid");
  const validNumbers = numbers.filter((value): value is number => Number.isInteger(value) && value! >= 1);
  if (new Set(validNumbers).size !== validNumbers.length) issues.push("duplicate_amendment_number");
  const sortedNumbers = [...validNumbers].sort((left, right) => left - right);
  if (sortedNumbers.some((value, index) => value !== index + 1)) issues.push("missing_amendment_sequence");

  for (let index = 1; index < group.length; index += 1) {
    const previous = group[index - 1]!;
    const current = group[index]!;
    const previousTime = exactTime(previous.filedAt);
    const currentTime = exactTime(current.filedAt);
    if (previousTime === null || currentTime === null) issues.push("filing_order_unverified");
    else if (currentTime <= previousTime) issues.push("filing_order_reversed");
  }

  const uniqueIssues = [...new Set(issues)].sort();
  const orderedAccessions = group.map((filing) => filing.accessionNumber);
  const base = {
    scope: "complete_stored_history_not_sec_global" as const,
    version: SC13_LINEAGE_VERSION,
    positionKey: key,
    issuerCik: sample.issuerCik,
    formFamily: formFamily(sample.formTypeRaw),
    securityClassRaw: sample.securityClassRaw,
    cusipsRaw: normalizeCusips(sample.cusipsRaw),
    rootAccessionNumber: root?.accessionNumber ?? null,
    orderedAccessions,
  };
  if (uniqueIssues.length > 0 || !root) {
    return {
      ...base,
      status: "unresolved",
      headAccessionNumber: null,
      currentReporters: [],
      issues: uniqueIssues,
    };
  }

  const head = group.at(-1)!;
  return {
    ...base,
    status: "available_stored_history",
    rootAccessionNumber: root.accessionNumber,
    headAccessionNumber: head.accessionNumber,
    currentReporters: projectReporters(group, head),
    issues: [],
  };
}

function resolveCrossGroupProblems(
  groups: ReadonlyMap<string, readonly Sc13LineageFiling[]>,
  links: ReadonlyMap<string, Sc13LineageLink>,
) {
  const problems = new Map<string, string[]>();
  const entries = [...groups.entries()];
  const add = (key: string, issue: string) => {
    const values = problems.get(key) ?? [];
    values.push(issue);
    problems.set(key, values);
  };
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const [leftKey, left] = entries[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [rightKey, right] = entries[rightIndex]!;
      const leftSample = left[0]!;
      const rightSample = right[0]!;
      if (!sameSecurityIdentity(leftSample, rightSample) || !reportersOverlap(left, right)) continue;
      const familiesDiffer = formFamily(leftSample.formTypeRaw) !== formFamily(rightSample.formTypeRaw);
      const leftUnresolved = left.some((filing) => isAmendment(filing) && links.get(filing.accessionNumber)?.status !== "linked");
      const rightUnresolved = right.some((filing) => isAmendment(filing) && links.get(filing.accessionNumber)?.status !== "linked");
      if (familiesDiffer) {
        add(leftKey, `cross_form_family_overlap:${right.map((filing) => filing.accessionNumber).join(",")}`);
        add(rightKey, `cross_form_family_overlap:${left.map((filing) => filing.accessionNumber).join(",")}`);
      } else if (leftUnresolved || rightUnresolved) {
        add(leftKey, `overlapping_unresolved_filing:${right.map((filing) => filing.accessionNumber).join(",")}`);
        add(rightKey, `overlapping_unresolved_filing:${left.map((filing) => filing.accessionNumber).join(",")}`);
      }
    }
  }
  return problems;
}

function sameSecurityIdentity(left: Sc13LineageFiling, right: Sc13LineageFiling) {
  return left.issuerCik === right.issuerCik
    && normalizeClass(left.securityClassRaw) === normalizeClass(right.securityClassRaw)
    && sameStrings(normalizeCusips(left.cusipsRaw), normalizeCusips(right.cusipsRaw));
}

function reportersOverlap(left: readonly Sc13LineageFiling[], right: readonly Sc13LineageFiling[]) {
  const verifiedKeys = (filings: readonly Sc13LineageFiling[]) => new Set(
    filings.flatMap((filing) => filing.reporters.map(reporterIdentity).filter((key): key is string => key !== null)),
  );
  const leftKeys = verifiedKeys(left);
  const rightKeys = verifiedKeys(right);
  return [...leftKeys].some((key) => rightKeys.has(key));
}

function projectReporters(
  orderedFilings: readonly Sc13LineageFiling[],
  head: Sc13LineageFiling,
): Sc13CurrentReporter[] {
  return [...head.reporters]
    .sort((left, right) => left.reportingPersonIndex - right.reportingPersonIndex)
    .map((reporter) => {
      const identity = reporterIdentity(reporter)!;
      const values = Object.fromEntries(CURRENT_FIELD_KEYS.map((field) => {
        const current = reporter.values[field];
        if (current !== null) {
          return [field, {
            status: "available" as const,
            valueRaw: current,
            sourceAccessionNumber: head.accessionNumber,
            lastReported: { valueRaw: current, sourceAccessionNumber: head.accessionNumber },
          }];
        }
        let lastReported: { valueRaw: string; sourceAccessionNumber: string } | null = null;
        for (let index = orderedFilings.length - 2; index >= 0; index -= 1) {
          const filing = orderedFilings[index]!;
          const prior = historyForIdentity(filing, identity);
          const value = prior?.values[field] ?? null;
          if (value !== null) {
            lastReported = { valueRaw: value, sourceAccessionNumber: filing.accessionNumber };
            break;
          }
        }
        return [field, {
          status: "unresolved" as const,
          valueRaw: null,
          sourceAccessionNumber: null,
          reason: "current_filing_field_missing" as const,
          lastReported,
        }];
      })) as Record<Sc13CurrentFieldKey, Sc13CurrentField>;
      return {
        reportingPersonCik: reporter.reportingPersonCik!,
        ...(reporter.identityProvenance ? { identityProvenance: reporter.identityProvenance } : {}),
        reportingPersonNameRaw: reporter.reportingPersonNameRaw,
        sourceAccessionNumber: head.accessionNumber,
        values,
      };
    });
}

function historyForIdentity(filing: Sc13LineageFiling, identity: string) {
  return filing.reporters.find((reporter) => reporterIdentity(reporter) === identity) ?? null;
}

function reporterKeys(filing: Sc13LineageFiling) {
  const keys = filing.reporters.map(reporterIdentity);
  if (keys.some((key) => key === null)) return null;
  const values = keys as string[];
  if (new Set(values).size !== values.length) return null;
  return [...values].sort();
}

function reporterIdentity(reporter: Sc13LineageReporter) {
  const cik = reporter.reportingPersonCik?.trim();
  return cik && /^\d{10}$/.test(cik) ? `cik:${cik}` : null;
}

function positionKey(filing: Sc13LineageFiling) {
  return [
    filing.issuerCik,
    formFamily(filing.formTypeRaw),
    normalizeClass(filing.securityClassRaw),
    normalizeCusips(filing.cusipsRaw).join(","),
    reporterKeys(filing)?.join(",") ?? `unverified-reporters:${filing.accessionNumber}`,
  ].join("|");
}

function isAmendment(filing: Sc13LineageFiling) {
  return normalizeForm(filing.formTypeRaw).endsWith("/A");
}

function filingNumber(filing: Sc13LineageFiling) {
  return isAmendment(filing) ? filing.amendmentNumber : 0;
}

function compareFilingNumber(left: Sc13LineageFiling, right: Sc13LineageFiling) {
  const leftNumber = filingNumber(left);
  const rightNumber = filingNumber(right);
  if (leftNumber === null || rightNumber === null || leftNumber === rightNumber) {
    return left.accessionNumber.localeCompare(right.accessionNumber);
  }
  return leftNumber - rightNumber;
}

function formFamily(value: string): "SCHEDULE 13D" | "SCHEDULE 13G" {
  return normalizeForm(value).includes("13G") ? "SCHEDULE 13G" : "SCHEDULE 13D";
}

function normalizeForm(value: string) {
  return value.trim().toUpperCase().replace(/^SC\s+/, "SCHEDULE ").replace(/\s+/g, " ");
}

function normalizeClass(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeCusips(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))].sort();
}

function normalizedAccession(value: string | null) {
  const accession = value?.trim() ?? "";
  return ACCESSION_PATTERN.test(accession) ? accession : null;
}

function exactTime(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
