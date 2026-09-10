import {
  OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION,
  runOfferingMonitorAutomaticTriggerForEvent,
  type OfferingMonitorAutomaticEventResult,
} from "./offeringMonitorAutomaticTrigger.ts";

export type OfferingMonitorSiteAnalysisExecution =
  | OfferingMonitorAutomaticEventResult
  | Readonly<{
      version: typeof OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION;
      status: "failed";
      eventId: string;
      error: string;
    }>;

export type OfferingMonitorSiteAnalysisDependencies = Readonly<{
  run(input: Readonly<{ eventId: string }>): Promise<OfferingMonitorAutomaticEventResult>;
  reportFailure?(failure: Extract<OfferingMonitorSiteAnalysisExecution, { status: "failed" }>): void;
}>;

const defaultDependencies: OfferingMonitorSiteAnalysisDependencies = {
  run: runOfferingMonitorAutomaticTriggerForEvent,
  reportFailure: (failure) => {
    console.error("[offering-monitor] isolated site-analysis trigger failure", failure);
  },
};

/**
 * Keeps Registry/Matcher/Alert failures visible without changing a completed
 * site SEC analysis into a failed analysis. Calling this function again with
 * the same Event is the retry path; it owns no success/failure dedupe state.
 */
export async function runOfferingMonitorSiteAnalysisExecution(
  input: Readonly<{ eventId: string }>,
  dependencies: OfferingMonitorSiteAnalysisDependencies = defaultDependencies,
): Promise<OfferingMonitorSiteAnalysisExecution> {
  try {
    return await dependencies.run(input);
  } catch (error) {
    const failure = {
      version: OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION,
      status: "failed" as const,
      eventId: input.eventId,
      error: error instanceof Error
        ? error.message
        : "Registry-backed Offering Monitor execution failed",
    };
    try {
      (dependencies.reportFailure ?? defaultDependencies.reportFailure)?.(failure);
    } catch {
      // Reporting must not reopen the failure boundary around site analysis.
    }
    return failure;
  }
}
