import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** Shared definition for independent and combined extraction contracts. Never monetary arithmetic. */
export const ATM_REVISION = 'atm_terms_v1';
export const atmTermSchema = JSON.parse(readFileSync(resolve(process.cwd(),
  'lib/sec-offering-plan/contracts/atm-terms-v1/atm-term.schema.json'), 'utf8'));
export type AtmTerm = {
  component_ids: string[];
  kind: 'offering_limit' | 'remaining_offering_amount' | 'increase_amount' | 'decrease_amount';
  status: 'current' | 'prior';
  amount: string;
  currency: string;
  as_of_date: string | null;
  as_of_text: string | null;
  qualification: string | null;
  basis: string;
  evidence_blocks: string[];
};

/** Compose a new revision; the supplied frozen historical schema is never mutated. */
export function withAtmTerms(legacySchema: Record<string, any>) {
  const schema = structuredClone(legacySchema);
  schema.$defs.atm_term = structuredClone(atmTermSchema);
  schema.$defs.plan.required.push('atm_terms');
  schema.$defs.plan.properties.atm_terms = {type: 'array', items: {$ref: '#/$defs/atm_term'}};
  for (const rule of schema.allOf) {
    if (['REVIEW_REQUIRED', 'NO_DIRECT_OFFERING_PLAN'].includes(rule.if.properties.status.const)) {
      rule.then.properties.plan.properties.atm_terms = {maxItems: 0};
    }
  }
  return schema;
}
