import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";
import {
  createGenericMonitorChildRepository,
  type GenericMonitorChildStore,
} from "./genericMonitorChildRepository";

const genericMonitorChildSupabaseStore: GenericMonitorChildStore = {
  select: supabaseSelect,
  upsert: supabaseUpsert,
  update: supabaseUpdate,
};

/**
 * Durable ai_runs/ai_outputs repository for a future workflow starter/handler.
 * Phase 1H intentionally exports the boundary without invoking it from any
 * production Primary path.
 */
export const genericMonitorChildRepository = createGenericMonitorChildRepository(
  genericMonitorChildSupabaseStore,
);
