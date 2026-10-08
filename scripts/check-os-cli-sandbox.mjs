import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const exe=process.argv[2],dir=mkdtempSync(join(tmpdir(),'os-sandbox-probe-'));
const script=join(dir,'probe.ps1');writeFileSync(script,"[IO.File]::WriteAllText((Join-Path $pwd.Path 'probe.txt'),'ok'); Write-Output 'workspace-write-ok'");
try{console.log(execFileSync(exe,['sandbox','-P',':workspace','-c','windows.sandbox="unelevated"','-C',dir,'powershell.exe','-NoProfile','-File',script],{encoding:'utf8',windowsHide:true,timeout:30000}));}catch(e){console.log(String(e.stderr??e.message));process.exitCode=1;}
