export const SEC_PRIMARY_VALIDATION_DISPOSITION_SCHEMA_VERSION = 1;

export type SecPrimaryValidationFamily =
  | "8-k-6-k"
  | "s-1-f-1"
  | "s-3-f-3"
  | "424b";

export type SecPrimarySemanticValidationIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecPrimaryStructuralFailureCode =
  | "transport"
  | "json_parse"
  | "schema_type"
  | "schema_required"
  | "schema_enum"
  | "schema_contract";

export type SecPrimaryValidationDisposition =
  | {
      disposition: "semantic_diagnostic_only";
      repair_eligible: false;
      repair_strategy: "none";
    }
  | {
      disposition: "structural_repair_eligible";
      repair_eligible: true;
      repair_strategy: "existing_minimal_structural_path";
      structural_failure_code: SecPrimaryStructuralFailureCode;
    };

export function classifySecPrimarySemanticValidation(): SecPrimaryValidationDisposition {
  return {
    disposition: "semantic_diagnostic_only",
    repair_eligible: false,
    repair_strategy: "none",
  };
}

export function classifySecPrimaryStructuralFailure(
  structuralFailureCode: SecPrimaryStructuralFailureCode,
): SecPrimaryValidationDisposition {
  return {
    disposition: "structural_repair_eligible",
    repair_eligible: true,
    repair_strategy: "existing_minimal_structural_path",
    structural_failure_code: structuralFailureCode,
  };
}

export function buildSecPrimarySemanticValidationDiagnostics({
  family,
  issues,
}: {
  family: SecPrimaryValidationFamily;
  issues: readonly SecPrimarySemanticValidationIssue[];
}) {
  const disposition = classifySecPrimarySemanticValidation();
  const diagnosticFindings = issues.map((issue) => ({
    code: issue.code,
    warning: issue.warning,
    field_paths: uniqueStrings(issue.field_paths),
    candidate_patch_paths: uniqueStrings(issue.allowed_patch_paths),
    candidate_source_block_ids: uniqueStrings(issue.candidate_source_block_ids),
    disposition: disposition.disposition,
  }));
  const issueCodes = uniqueStrings(diagnosticFindings.map((issue) => issue.code));

  return {
    schema_version: SEC_PRIMARY_VALIDATION_DISPOSITION_SCHEMA_VERSION,
    family,
    ...disposition,
    attempted: false,
    issue_codes: issueCodes,
    diagnostic_findings: diagnosticFindings,
    source_block_ids: uniqueStrings(
      diagnosticFindings.flatMap((issue) => issue.candidate_source_block_ids),
    ),
    allowed_patch_paths: [],
    applied_patch_paths: [],
    ignored_patch_paths: [],
    unresolved: issueCodes,
    control_effects: {
      repair_llm: false,
      primary_output: false,
      routing: false,
      child_fanout: false,
      score_signal_event: false,
      completion: false,
    },
  };
}

export function buildSecPrimaryStructuralValidationDiagnostics({
  family,
  structuralFailureCode,
}: {
  family: SecPrimaryValidationFamily;
  structuralFailureCode: SecPrimaryStructuralFailureCode;
}) {
  return {
    schema_version: SEC_PRIMARY_VALIDATION_DISPOSITION_SCHEMA_VERSION,
    family,
    ...classifySecPrimaryStructuralFailure(structuralFailureCode),
    attempted: false,
  };
}

export function applySecPrimarySemanticValidationDisposition<
  TAnalysisResult extends Record<string, unknown>,
>({
  family,
  analysisResult,
  issues,
}: {
  family: SecPrimaryValidationFamily;
  analysisResult: TAnalysisResult;
  issues: readonly SecPrimarySemanticValidationIssue[];
}) {
  return {
    analysisResult,
    validationRepair: buildSecPrimarySemanticValidationDiagnostics({ family, issues }),
  };
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
