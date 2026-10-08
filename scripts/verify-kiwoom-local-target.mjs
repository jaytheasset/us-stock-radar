// Read-only local target audit. Never prints API keys, SQL credentials or user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
const [envPath, output] = process.argv.slice(2);
assert.ok(envPath && output, 'Usage: <existing env file, read-only> <receipt JSON>');
const environment = parseEnv(fs.readFileSync(envPath, 'utf8'));
const inspect = name => JSON.parse(execFileSync('docker', ['inspect', name], { encoding:'utf8', windowsHide:true }))[0];
const env = c => Object.fromEntries(c.Config.Env.map(e => { const i=e.indexOf('='); return [e.slice(0,i),e.slice(i+1)]; }));
const names = ['kong','rest','auth','db'].map(s=>'supabase_'+s+'_US-Stock_Radar');
const containers = names.map(inspect), [kong,rest,auth,db] = containers;
const project = db.Config.Labels['com.supabase.cli.project'];
assert.ok(containers.every(c=>c.Config.Labels['com.supabase.cli.project']===project));
const network = Object.keys(db.NetworkSettings.Networks)[0];
assert.ok(containers.every(c=>c.NetworkSettings.Networks[network]?.NetworkID===db.NetworkSettings.Networks[network].NetworkID));
const dbName = db.Name.slice(1).toLowerCase();
for(const [container,key] of [[rest,'PGRST_DB_URI'],[auth,'GOTRUE_DB_DATABASE_URL']]) {
  const u=new URL(env(container)[key]); assert.equal(u.hostname.toLowerCase(),dbName); assert.equal(u.port,'5432'); assert.equal(u.pathname,'/postgres');
}
const kongText=execFileSync('docker',['exec',kong.Name.slice(1),'cat',env(kong).KONG_DECLARATIVE_CONFIG],{encoding:'utf8',windowsHide:true});
assert.ok(kongText.includes('http://'+rest.Name.slice(1)+':3000')); assert.ok(kongText.includes('http://'+auth.Name.slice(1)+':9999'));
const api=new URL(environment.SUPABASE_URL), sqlPort=Number(db.NetworkSettings.Ports['5432/tcp'][0].HostPort);
assert.equal(api.port,kong.NetworkSettings.Ports['8000/tcp'][0].HostPort);
const localHosts=['localhost','127.0.0.1',...Object.values((await import('node:os')).networkInterfaces()).flat().filter(Boolean).map(x=>x.address)];
if(!localHosts.includes(api.hostname)) {
  // Do not send credentials to a configured LAN address that is no longer this host.
  const health=[];
  for(const origin of [api.origin,`http://127.0.0.1:${api.port}`]) {
    try {const r=await fetch(origin+'/auth/v1/health',{signal:AbortSignal.timeout(5000)});health.push({origin,status:r.status});}
    catch(e){health.push({origin,error:e.name});}
  }
  const identity=JSON.parse(execFileSync('docker',['exec',db.Name.slice(1),'psql','-U','postgres','-d','postgres','-X','-A','-t','-c',"select json_build_object('system_identifier',system_identifier::text) from pg_control_system()"],{encoding:'utf8',windowsHide:true}));
  const blocked={capturedAt:new Date().toISOString(),pass:false,status:'blocked',reason:'configured_rest_host_is_not_a_current_local_address',
    configuredRest:{host:api.hostname,port:api.port},localHosts,health,localStack:{project,network,systemIdentifier:identity.system_identifier,sqlPort,
      containers:containers.map(c=>({name:c.Name,id:c.Id})),routing:'Kong -> exact REST/Auth containers -> exact DB container, same Docker network'},
    restSqlIdentity:'not_confirmed_for_configured_endpoint',migrationApplied:false,credentialedHttpRequests:0,writes:0};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(blocked,null,2)+'\n');
  console.log(JSON.stringify(blocked));process.exit(2);
}
console.log(JSON.stringify({status:'local_topology_confirmed_only',restSqlIdentity:'requires_separate_SQL_REST_verification',writes:0}));
