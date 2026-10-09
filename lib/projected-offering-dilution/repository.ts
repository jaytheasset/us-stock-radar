import type {Repository} from '../sec-os-snapshot/repository.ts';
import type {Fact} from './calculate.ts';

export const PROJECTED_RETIRED_REASON = 'projected_calculation_retired' as const;

// Historical shapes remain readable. No current entry point imports the calculator
// or opens a repository, even when invoked directly by an old caller.
export type ReadResult={status:'not_ready';reason:string}|{status:'available';eventId:string;rawItemId:string;sourceExecutionId:string;persistedAt:string;filedAt:string;facts:Fact;guard:unknown;sourceUrl:string;evidence:{id:string;text:string}[]};
type HistoricalPrepared = {id:string;fact:Fact;guard:unknown;rawId:string;filedAt:string;sourceUrl:string;evidence:{id:string;text:string}[]};

export async function prepare(_rawId:string,_repo:Repository):Promise<HistoricalPrepared|null>{
  return null;
}
export async function refreshProjectedForRun(_runId:string,_supplied?:Repository){
  return {status:'retired' as const,reason:PROJECTED_RETIRED_REASON};
}
export async function refreshProjected(_rawId:string,_supplied?:Repository){
  return {status:'retired' as const,reason:PROJECTED_RETIRED_REASON};
}
export async function readProjectedFacts(_eventId:string,_supplied?:Repository):Promise<ReadResult>{
  return {status:'not_ready',reason:PROJECTED_RETIRED_REASON};
}
