import {z} from "zod";
import {safeSecEvidenceUrl} from "../monitor/secondaryMonitorEvidence.ts";
export const evidenceSchema=z.object({version:z.literal("sec425_alert_v1"),rawItemId:z.string().uuid(),executionId:z.string().uuid(),accession:z.string().regex(/^\d{10}-\d{2}-\d{6}$/),sourceUrl:z.string(),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),
 announcementType:z.enum(["new_acquisition_proposal","revised_acquisition_proposal","definitive_agreement_signed"]),statement:z.string(),transactionTypes:z.array(z.string()),
 companies:z.array(z.object({cik:z.string().regex(/^\d{10}$/),ticker:z.string(),name:z.string(),role:z.string().nullable()})),
 terms:z.array(z.string()),quotes:z.array(z.object({blockId:z.string(),sourceField:z.enum(["text","heading"]),start:z.number().int().nonnegative(),end:z.number().int(),sourceQuote:z.string()})),
 conditions:z.array(z.object({key:z.string(),operator:z.literal("eq"),value:z.union([z.string(),z.boolean()])})),monitorCreatedAt:z.string(),filedAt:z.string(),evaluatedAt:z.string(),scope:z.literal("candidate_isolated")
}).strict().refine(v=>safeSecEvidenceUrl(v.sourceUrl,v.accession));
export type FactEvidence=z.infer<typeof evidenceSchema>;
export function publicEvidence(value:unknown,rawId?:unknown,executionId?:unknown){const p=evidenceSchema.safeParse(value);return p.success&&(!rawId||p.data.rawItemId===rawId)&&(!executionId||p.data.executionId===executionId)?p.data:null;}
