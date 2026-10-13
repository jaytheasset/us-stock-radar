import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=readdirSync('lib',{recursive:true}).filter(p=>p.endsWith('.test.ts')&&/projected-offering-dilution|dilution-registry|offeringMonitor|offeringPlanMonitor|listingMonitor|monitorPresets|conditionRegistry|registryBackedOffering|secPrimary|s1-f1/.test(p)).map(p=>'lib/'+p.replaceAll('\\','/'));
const result=spawnSync(process.execPath,['--no-warnings','--experimental-loader',new URL('./resolve-ts-paths.mjs',import.meta.url).href,'--experimental-strip-types','--test',...files],{stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
