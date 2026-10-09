import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--no-warnings','--experimental-loader',new URL('./resolve-ts-paths.mjs',import.meta.url).href,'--experimental-strip-types','--test','lib/sec-combined-offering/adapter.test.ts','lib/sec-combined-offering/durable.test.ts'],{stdio:'inherit',windowsHide:true,shell:false});
if(result.error)throw result.error;
process.exitCode=result.status??1;
