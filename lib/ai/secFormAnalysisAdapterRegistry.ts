import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  SEC_424B_ANALYSIS_PROMPT_KEY,
  SEC_424B_ANALYSIS_PROMPT_VERSION,
  adaptSec424bAnalysisPromptResultForAnalysis,
  buildSec424bAnalysisPromptForInput,
  is424bFilingInput,
} from "@/lib/ai/sec424bAnalysisAdapter";
import {
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
  adaptSec8k6kAnalysisPromptResultForAnalysis,
  buildSec8k6kAnalysisPromptForInput,
  buildSec8k6kArchiveAnalysis,
  buildSec8k6kRouterPromptForInput,
  isSec8k6kFilingInput,
  normalizeSec8k6kRouterResult,
  shouldRunSec8k6kAnalysis,
} from "@/lib/ai/sec8k6kAnalysisAdapter";
import {
  SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
  SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
  adaptOwnershipPromptResultForAnalysis,
  buildDeterministicOwnershipAnalysis,
  buildSecOwnershipAnalysisPrompt,
  isOwnershipFilingInput,
} from "@/lib/ai/secOwnershipAnalysisAdapter";
import {
  SEC_TENDER_ANALYSIS_PROMPT_KEY,
  SEC_TENDER_ANALYSIS_PROMPT_VERSION,
  adaptSecTenderAnalysisPromptResultForAnalysis,
  buildSecTenderAnalysisPromptForInput,
  isTenderFilingInput,
} from "@/lib/ai/secTenderAnalysisAdapter";
import {
  SEC_SC13_ANALYSIS_PROMPT_KEY,
  SEC_SC13_ANALYSIS_PROMPT_VERSION,
  adaptSecSc13AnalysisPromptResultForAnalysis,
  buildDeterministicSc13Analysis,
  buildSecSc13AnalysisPromptForInput,
  isSc13FilingInput,
} from "@/lib/ai/secSc13AnalysisAdapter";
import {
  SEC_S4_F4_ANALYSIS_PROMPT_KEY,
  SEC_S4_F4_ANALYSIS_PROMPT_VERSION,
  adaptSecS4F4AnalysisPromptResultForAnalysis,
  buildSecS4F4AnalysisPromptForInput,
  isS4F4FilingInput,
} from "@/lib/ai/secS4F4AnalysisAdapter";
import {
  SEC_S8_ANALYSIS_PROMPT_KEY,
  SEC_S8_ANALYSIS_PROMPT_VERSION,
  adaptSecS8AnalysisPromptResultForAnalysis,
  buildDeterministicS8ArchiveAnalysis,
  buildSecS8AnalysisPromptForInput,
  isS8FilingInput,
} from "@/lib/ai/secS8AnalysisAdapter";
import {
  SEC_OFFERING_AUDIT_PROMPT_KEY,
  SEC_OFFERING_AUDIT_PROMPT_VERSION,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
  buildSecS3AnalysisPrompt,
  buildSecS3AuditPrompt,
  buildSecS3TriagePrompt,
  isS3AmendmentInput,
  isS3FilingInput,
} from "@/lib/ai/secS3AnalysisAdapter";

export {
  SEC_424B_ANALYSIS_PROMPT_KEY,
  SEC_424B_ANALYSIS_PROMPT_VERSION,
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
  SEC_OFFERING_AUDIT_PROMPT_KEY,
  SEC_OFFERING_AUDIT_PROMPT_VERSION,
  SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
  SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
  SEC_TENDER_ANALYSIS_PROMPT_KEY,
  SEC_TENDER_ANALYSIS_PROMPT_VERSION,
  SEC_SC13_ANALYSIS_PROMPT_KEY,
  SEC_SC13_ANALYSIS_PROMPT_VERSION,
  SEC_S4_F4_ANALYSIS_PROMPT_KEY,
  SEC_S4_F4_ANALYSIS_PROMPT_VERSION,
  SEC_S8_ANALYSIS_PROMPT_KEY,
  SEC_S8_ANALYSIS_PROMPT_VERSION,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
  adaptSec424bAnalysisPromptResultForAnalysis,
  adaptSec8k6kAnalysisPromptResultForAnalysis,
  adaptOwnershipPromptResultForAnalysis,
  adaptSecTenderAnalysisPromptResultForAnalysis,
  adaptSecSc13AnalysisPromptResultForAnalysis,
  adaptSecS4F4AnalysisPromptResultForAnalysis,
  adaptSecS8AnalysisPromptResultForAnalysis,
  buildDeterministicSc13Analysis,
  buildDeterministicOwnershipAnalysis,
  buildDeterministicS8ArchiveAnalysis,
  buildSec424bAnalysisPromptForInput,
  buildSec8k6kAnalysisPromptForInput,
  buildSec8k6kArchiveAnalysis,
  buildSec8k6kRouterPromptForInput,
  buildSecOwnershipAnalysisPrompt,
  buildSecS3AnalysisPrompt,
  buildSecS3AuditPrompt,
  buildSecS3TriagePrompt,
  buildSecTenderAnalysisPromptForInput,
  buildSecSc13AnalysisPromptForInput,
  buildSecS4F4AnalysisPromptForInput,
  buildSecS8AnalysisPromptForInput,
  is424bFilingInput,
  isSec8k6kFilingInput,
  isOwnershipFilingInput,
  isS3AmendmentInput,
  isS3FilingInput,
  isTenderFilingInput,
  isSc13FilingInput,
  isS4F4FilingInput,
  isS8FilingInput,
  normalizeSec8k6kRouterResult,
  shouldRunSec8k6kAnalysis,
};

export function getSecAnalysisAdapterMode(input: SecFilingAnalysisInput) {
  if (is424bFilingInput(input)) return "analysis_only";
  if (isOwnershipFilingInput(input)) return "ownership_direct_analysis";
  if (isSec8k6kFilingInput(input)) return "current_report_router_flow";
  if (isTenderFilingInput(input)) return "analysis_only";
  if (isSc13FilingInput(input)) return "analysis_only";
  if (isS4F4FilingInput(input)) return "s4_f4_analysis_only";
  if (isS8FilingInput(input)) return "analysis_only";
  if (isS3FilingInput(input)) return "s3_offering_flow";
  return "generic_sec_analysis";
}
