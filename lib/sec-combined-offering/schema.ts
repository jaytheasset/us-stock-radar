import {schemaText as osSchemaText} from '../sec-os-snapshot/contract.ts';
import {getContract} from '../sec-offering-plan/contract.ts';

export const REVISION = 'combined_offering_v1-output-r1';
export const OFFERING_REVISION = 'offering_plan_v1-output-r3';
export const OS_REVISION = 'os_snapshot_v1-prompt-r2';
// Deliberately limited to this adapter; isOsForm and automatic ingest are unchanged.
import {FORMS} from './eligibility.ts';
export {FORMS};

/** Compose existing domain definitions, including the shared ATM definition. No per-form copies. */
export function combinedSchema() {
  const defs: Record<string, unknown> = {};
  function section(original: Record<string, any>, prefix: string) {
    const rewrite = (x: any): any => {
      if (Array.isArray(x)) return x.map(rewrite);
      if (!x || typeof x !== 'object') return x;
      return Object.fromEntries(Object.entries(x).map(([key, value]) => [key,
        key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')
          ? '#/$defs/' + prefix + value.slice(8) : rewrite(value)]));
    };
    for (const [key, value] of Object.entries(original.$defs)) defs[prefix + key] = rewrite(value);
    const result = rewrite(original);
    for (const key of ['$schema', '$id', '$defs', 'title']) delete result[key];
    delete result.properties.version;
    delete result.properties.filing;
    result.required = result.required.filter((key: string) => !['version', 'filing'].includes(key));
    return result;
  }
  const offering = JSON.parse(getContract(OFFERING_REVISION).schemaText);
  const filing = structuredClone(offering.properties.filing);
  filing.properties.form.enum = [...FORMS];
  const os = section(JSON.parse(osSchemaText), 'os_');
  const plan = section(offering, 'off_');
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'One response, independently validated O/S and Offering Plan',
    type: 'object', additionalProperties: false,
    required: ['version', 'filing', 'os_snapshot', 'offering_plan'],
    properties: {version: {const: REVISION}, filing, os_snapshot: os, offering_plan: plan},
    $defs: defs,
  };
}
