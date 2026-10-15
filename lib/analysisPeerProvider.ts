import "server-only";
import type { AnalysisPeerFillerBuckets } from "@/lib/analysisPeerSelection";
import type {
  AnalysisPeerProviderClassification,
  AnalysisPeerProviderCompany,
} from "@/lib/analysisPeerProviderContract";
// No replacement provider is enabled. Existing callers retain their empty-data contracts.
export async function loadAnalysisPeerProviderFillers(_options: {
  classification: AnalysisPeerProviderClassification;
  excludeSymbols: string[];
  limit: number;
}): Promise<AnalysisPeerFillerBuckets> {
  return {};
}
export async function loadAnalysisPeerProviderCompanies(_symbols: string[]) {
  return new Map<string, AnalysisPeerProviderCompany>();
}
