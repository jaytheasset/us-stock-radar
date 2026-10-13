import type {ShareCountHistoryObservation} from './shareCountHistory.ts';

/** Read projection only. The underlying history and AI output remain unchanged. */
export type ShareCountCorrection = {
 id:string;observationId:string;revision:number;quantity:string;asOf:string;
 evidence:string;reason:string;actorUserId:string;createdAt:string;
 originalQuantity:string;originalAsOf:string;classId:string;sourceHash:string;sourceBindingHash:string;
};

export function readShareCountCorrection(value:unknown,row:ShareCountHistoryObservation):ShareCountCorrection|undefined{
 if(value===null||value===undefined)return undefined;
 const c=value as ShareCountCorrection;
 if(typeof c!=='object'||c.observationId!==row.id||c.originalQuantity!==row.sharesOutstanding||c.originalAsOf!==row.asOf
  ||c.classId!==row.canonicalSecurityClassId||c.sourceHash!==row.sourceContentHash
  ||!uuid(c.id)||!uuid(c.actorUserId)||!Number.isInteger(c.revision)||c.revision<1
  ||!integer(c.quantity)||!date(c.asOf)||c.asOf>row.filedDate
  ||typeof c.evidence!=='string'||!c.evidence.trim()||c.evidence.length>600
  ||typeof c.reason!=='string'||!c.reason.trim()||c.reason.length>2000
  ||!Number.isFinite(Date.parse(c.createdAt))||!/^[a-f0-9]{64}$/.test(c.sourceBindingHash))throw Error('Invalid O/S correction projection');
 return structuredClone(c);
}

/** Used only after the repository has validated the original saved observation. */
export function effectiveShareCountObservation(row:ShareCountHistoryObservation):ShareCountHistoryObservation{
 if(!row.correction)return row;
 const correction=readShareCountCorrection(row.correction,row)!;
 if(row.observationType==='source_stated')return {...row,sharesOutstanding:correction.quantity,asOf:correction.asOf,sourceEvidence:correction.evidence,correction};
 return {...row,sharesOutstanding:correction.quantity,asOf:correction.asOf,correction};
}
const integer=(s:unknown)=>typeof s==='string'&&/^[1-9][0-9]{0,77}$/.test(s);
const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const date=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
