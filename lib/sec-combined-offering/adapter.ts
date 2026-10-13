import {buildCombinedSource} from './source.ts';
import {combinedBinding,validateCombinedResponse,schemaText,promptText} from './contract.ts';

/** Mandatory injection: no default live provider, persistence, enqueue, retries or Worker. */
export interface CombinedProvider {
  run(input: {prompt:string; schema:string; source:string; binding:ReturnType<typeof combinedBinding>}):Promise<{raw:string}>;
}
export async function analyzeCombined(rawItem:Record<string,any>, provider:CombinedProvider) {
  const input = buildCombinedSource(rawItem);
  if (!input.ok) return {...input,providerInvocations:0 as const};
  let binding;
  try {binding=combinedBinding(rawItem.id,input.source);} catch {
    return {ok:false as const,status:'UNAVAILABLE' as const,reason:'invalid_input_binding',providerInvocations:0 as const};
  }
  // Serialized transient input prevents provider mutation of the authoritative source.
  let response;
  try {response=await provider.run({prompt:promptText,schema:schemaText,source:JSON.stringify(input.source),binding:structuredClone(binding)});} catch {
    return {ok:false as const,status:'TECHNICAL_FAILED' as const,reason:'provider_failed',binding,providerInvocations:1 as const};
  }
  if (typeof response?.raw !== 'string') return {ok:false as const,status:'TECHNICAL_FAILED' as const,
    reason:'provider_response_not_text',binding,providerInvocations:1 as const};
  return {...validateCombinedResponse(response.raw,input.source,binding),providerInvocations:1 as const};
}
