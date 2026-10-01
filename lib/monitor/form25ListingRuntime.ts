import { buildForm25ListingResult, FORM25_LISTING_CONTRACT_VERSION, FORM25_LISTING_STATE_OUTPUT } from "./form25ListingRisk.ts";
import type { GenericMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import { processGenericMonitorChildWithDependencies, type GenericMonitorChildProcessorRepository } from "./genericMonitorChildProcessor.ts";
import { persistListingRiskAnalyzerResult, listingRiskTerminalStateAfterPersistence } from "./listingRiskPersistence.ts";
import type { ListingMonitorAlertConsumerResult } from "./listingMonitorAlertConsumer.ts";
import { createHash } from "node:crypto";

/** The ordinary child lifecycle and typed writer, with a deterministic source adapter instead of a provider. */
export async function processForm25ListingChild(identity: GenericMonitorChildIdentity, dependencies: {
  repository: GenericMonitorChildProcessorRepository;
  consumeAlerts(input: {eventId:string}): Promise<ListingMonitorAlertConsumerResult>;
}) {
  if (identity.sourceFamily !== "sec_form25" || identity.monitorAnalyzerKey !== "listing_risk"
    || identity.analyzerContractVersion !== FORM25_LISTING_CONTRACT_VERSION) throw new Error("Invalid Form25 Listing child");
  let projection: ReturnType<typeof buildForm25ListingResult>;
  return processGenericMonitorChildWithDependencies(identity, {
    repository: dependencies.repository,
    buildAnalyzerInput: (_identity, raw) => buildForm25ListingResult(raw, identity.reservedAt.slice(0,10)),
    runAnalyzer: async input => { projection=input; return {stage:"complete",result:input.result}; },
    persist: async input => {
      const {supabaseUpsert}=await import("../supabase.ts");
      const h=createHash("sha256").update(`${identity.executionId}:${FORM25_LISTING_STATE_OUTPUT}`).digest("hex");
      const id=`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
      const trace=await supabaseUpsert("ai_outputs",{
        id,ai_run_id:identity.executionId,event_id:identity.eventId,output_type:FORM25_LISTING_STATE_OUTPUT,payload:projection,
      },{onConflict:"id",prefer:"resolution=ignore-duplicates,return=representation"});
      if (!trace.ok) throw new Error(`Form25 state trace failed: ${trace.error || trace.status}`);
      return persistListingRiskAnalyzerResult(input);
    },
    terminalStateAfterPersistence:listingRiskTerminalStateAfterPersistence,
    consumeListingMonitorAlerts:dependencies.consumeAlerts,
  });
}
