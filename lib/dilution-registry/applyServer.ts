import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import { applyDilutionRegistrySource } from "./applyContract.ts";

export function applyDilutionRegistrySourceOnServer(source: string) {
  return applyDilutionRegistrySource(source, { rpc: supabaseRpc });
}
