import { proxyRepository, readProxyStructured, rows, type ProxyRepository, type ProxyReadResult } from "../sec-proxy/persistence.ts";
import { text } from "../sec-proxy/source.ts";

export type ProxyMonitorFacts = {status:"not_ready";reason:string} | {
  status:"available";eventId:string;rawItemId:string;sourceExecutionId:string;persistedAt:string;filedAt:string;
  facts:{has_proposal:boolean;has_capital_structure_proposal:boolean};
};
/** Boolean presence over typed Call2 values only. Prose facts remain provenance, never quantities/dates. */
export function proxyMonitorFacts(read:ProxyReadResult,eventId:string):ProxyMonitorFacts {
  if (read.status !== "available") return read;
  return {status:"available",eventId,rawItemId:read.rawItemId,sourceExecutionId:read.sourceExecutionId,
    persistedAt:read.persistedAt,filedAt:read.filedAt,facts:{
      has_proposal:read.canonical.items.some(item=>item.is_proposal),
      has_capital_structure_proposal:read.canonical.items.some(item=>item.is_proposal && item.category === "capital_structure"),
    }};
}
export async function readCurrentProxyFacts(eventId:string, supplied?:ProxyRepository, verificationKey?:string):Promise<ProxyMonitorFacts> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw Error("proxy_invalid_event_id");
    const repo = supplied ?? await proxyRepository();
    const events = rows(await repo.select("events",{select:"id,raw_item_id,source_code",id:`eq.${eventId}`,limit:"2"}));
    if (events.length !== 1 || events[0].source_code !== "sec_edgar") throw Error("proxy_event_identity_invalid");
    return proxyMonitorFacts(await readProxyStructured(text(events[0].raw_item_id),repo,verificationKey),eventId);
  } catch (error) { return {status:"not_ready",reason:String(error)}; }
}
