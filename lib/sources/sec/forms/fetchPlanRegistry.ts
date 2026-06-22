import { sec424bFetchPlan } from "@/lib/sources/sec/forms/424b/fetchPlan";
import { sec425FetchPlan } from "@/lib/sources/sec/forms/425/fetchPlan";
import { sec8k6kFetchPlan } from "@/lib/sources/sec/forms/8k-6k/fetchPlan";
import { secEffectFetchPlan } from "@/lib/sources/sec/forms/effect/fetchPlan";
import { secForm25FetchPlan } from "@/lib/sources/sec/forms/form25/fetchPlan";
import { secNtFetchPlan } from "@/lib/sources/sec/forms/nt/fetchPlan";
import { secOwnershipFetchPlan } from "@/lib/sources/sec/forms/ownership/fetchPlan";
import { secPeriodicReportsFetchPlan } from "@/lib/sources/sec/forms/periodic-reports/fetchPlan";
import { secProxyFetchPlan } from "@/lib/sources/sec/forms/proxy/fetchPlan";
import { secS1F1FetchPlan } from "@/lib/sources/sec/forms/s1-f1/fetchPlan";
import { secS3F3FetchPlan } from "@/lib/sources/sec/forms/s3-f3/fetchPlan";
import { secS4F4FetchPlan } from "@/lib/sources/sec/forms/s4-f4/fetchPlan";
import { secS8FetchPlan } from "@/lib/sources/sec/forms/s8/fetchPlan";
import { secSc13FetchPlan } from "@/lib/sources/sec/forms/sc13/fetchPlan";
import { secTenderFetchPlan } from "@/lib/sources/sec/forms/tender/fetchPlan";
import { secOtherFetchPlan } from "@/lib/sources/sec/forms/other/fetchPlan";
import type { SecFormFetchPlan } from "@/lib/sources/sec/forms/common/fetchPlan";
import { matchesSecFormFetchRule } from "@/lib/sources/sec/forms/common/fetchPlan";

export const SEC_FORM_FETCH_PLANS = [
  sec8k6kFetchPlan,
  secPeriodicReportsFetchPlan,
  secNtFetchPlan,
  secS1F1FetchPlan,
  secS3F3FetchPlan,
  sec424bFetchPlan,
  secS8FetchPlan,
  secEffectFetchPlan,
  secOwnershipFetchPlan,
  secSc13FetchPlan,
  secProxyFetchPlan,
  sec425FetchPlan,
  secS4F4FetchPlan,
  secTenderFetchPlan,
  secForm25FetchPlan,
  secOtherFetchPlan,
] as const satisfies readonly SecFormFetchPlan[];

const formPlanLookup = buildFormPlanLookup();

export function getSecFormFetchPlan(formType: string | null | undefined) {
  const normalized = normalizeSecFetchPlanFormType(formType);
  if (!normalized) return null;
  return formPlanLookup.get(normalized) || null;
}

export { matchesSecFormFetchRule };

function buildFormPlanLookup() {
  const lookup = new Map<string, SecFormFetchPlan>();
  for (const plan of SEC_FORM_FETCH_PLANS) {
    for (const form of plan.forms) {
      lookup.set(normalizeSecFetchPlanFormType(form), plan);
    }
  }
  return lookup;
}

function normalizeSecFetchPlanFormType(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}
