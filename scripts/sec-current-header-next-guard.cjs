// Verification process only, loaded with --require. Not part of product runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pg = require('pg');
const log = item => fs.appendFileSync(process.env.SEC_HEADER_TRACE, JSON.stringify(item)+'\n');
const nativeFetch = globalThis.fetch;
const rest = new URL(process.env.SUPABASE_URL);
assert.equal(rest.hostname,'127.0.0.1'); assert.equal(rest.port,'56321');
const db = new URL(process.env.SUPABASE_DB_URL);
assert.equal(db.hostname,'127.0.0.1');assert.equal(db.port,'56322');
assert.match(db.pathname,/^\/sec_submissions_eeb4_[a-f0-9]{32}$/);
globalThis.fetch = async (input, init) => {
  const url=new URL(typeof input==='string'?input:input.url??String(input));
  const method=(init?.method??input.method??'GET').toUpperCase();
  const allowed = method==='GET' && (
    url.href==='https://www.sec.gov/files/company_tickers.json' ||
    (url.origin===rest.origin && url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/'))
  );
  log({kind:'http',host:url.host,path:url.pathname,method,allowed});
  if(!allowed) return new Response('Excluded verification dependency',{status:503});
  const response=await nativeFetch(input,init);
  if(process.env.SEC_HEADER_SYNTHETIC_CIK&&url.href==='https://www.sec.gov/files/company_tickers.json'&&response.ok){
    const data=await response.json();
    // Separate, visibly synthetic edge-case ticker only. Real catalog rows and
    // all three real issuer bodies remain unchanged; no header/SQL result mocks.
    data.synthetic_header={ticker:'SYNHDR',cik_str:Number(process.env.SEC_HEADER_SYNTHETIC_CIK),title:'Synthetic Header Verification'};
    if(process.env.SEC_HEADER_FIXTURE_ONLY==='true'){
      for(const ticker of ['SYNHDA','SYNHDB'])data[ticker]={ticker,cik_str:9000001501,title:'Synthetic Header Classes'};
    }
    return Response.json(data,{status:response.status});
  }
  return response;
};
const query=pg.Client.prototype.query;
pg.Client.prototype.query=function(sql,...args){
  assert.equal(this.database,db.pathname.slice(1));
  const text=typeof sql==='string'?sql:sql.text;
  assert.match(text.trim(),/^(select|show)\b/i,'Next SQL must be read only');
  log({kind:'sql',database:this.database,port:this.port,readCurrent:/from public.sec_submissions_current c/.test(text)});
  return query.call(this,sql,...args);
};
