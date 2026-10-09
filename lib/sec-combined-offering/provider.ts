import {CodexCliOfferingProvider} from '../sec-offering-plan/provider.ts';
import type {RunProcess} from '../sec-os-snapshot/provider.ts';
import {schemaText,promptText} from './contract.ts';
import {durableBinding} from './repository.ts';
import type {CombinedSource} from './source.ts';
import {stable} from '../sec-os-snapshot/contract.ts';

/** Same durable byte journal and global provider lock as F1, with a distinct namespace. */
export function combinedProvider(options:{executable:string;root:string;runner?:RunProcess}){
 return new CodexCliOfferingProvider({...options,execution:{namespace:'combined',contract:binding=>{
  const {source,...identity}=binding;
  if(stable(durableBinding(binding.rawItemId,source as CombinedSource))!==stable(identity))throw Error('combined_provider_binding_mismatch');
  return {schemaText,promptText};
 }}});
}
