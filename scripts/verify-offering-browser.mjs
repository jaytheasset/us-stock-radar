import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {localContext} from './os-local-context.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH);
const out=process.argv[2],base='http://localhost:3114';if(!out)throw Error('Evidence path required');
const {env,db}=localContext();await db.connect();
const browser=await chromium.launch({headless:true,channel:'msedge'}),checks=[],errors=[];
const actual=JSON.parse(readFileSync(join(out,'e2e-report.json'),'utf8')),fixtures=JSON.parse(readFileSync(join(out,'ui-fixtures.json'),'utf8')).ids;
async function login(email){
 const headers={apikey:env.SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
 const link=await fetch(env.API_URL+'/auth/v1/admin/generate_link',{method:'POST',headers,body:JSON.stringify({type:'magiclink',email})}).then(r=>r.json());if(!link.hashed_token)throw Error('Local auth link failed: '+(link.msg??link.message??link.code));
 const session=await fetch(env.API_URL+'/auth/v1/verify',{method:'POST',headers:{apikey:env.ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({type:'magiclink',token_hash:link.hashed_token})}).then(r=>r.json());if(!session.access_token)throw Error('Local auth session failed');
 const context=await browser.newContext();await context.addCookies([{name:'sr_access_token',value:session.access_token,url:base,httpOnly:true,sameSite:'Lax'},{name:'sr_refresh_token',value:session.refresh_token,url:base,httpOnly:true,sameSite:'Lax'}]);return context;
}
try{
 const loggedOut=await browser.newContext(),p=await loggedOut.newPage();await p.goto(base+'/admin/data/offering-plans',{timeout:120000});assert.ok(p.url().includes('/login'));checks.push('logged-out direct route redirects');
 const unauth=await loggedOut.request.post(base+'/api/admin/data/offering-plans/'+actual.runId,{headers:{Origin:base,'x-request-id':crypto.randomUUID()},data:{action:'hold',reason:'unauthorized',candidateIndexes:[]}});assert.ok([401,403].includes(unauth.status()));await loggedOut.close();
 const context=await login('local-operations-admin@stock-radar.test'),page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(120000);page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1440,900,390]){
  await page.setViewportSize({width,height:1000});await page.goto(base+'/admin/data/offering-plans?id='+actual.runId);await page.getByRole('heading',{name:'SEC Offering 계획 검토',exact:true}).waitFor();await page.getByRole('heading',{name:/Canaan/}).waitFor();assert.deepEqual((await page.getByRole('alert').allTextContents()).filter(t=>t.includes('읽을 수 없습니다')),[]);
  await page.getByText('분석 기록 보기',{exact:true}).click();await page.getByRole('heading',{name:'Raw GPT output'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(out,`offering-${width}.png`),fullPage:false});checks.push(`actual E2E detail/raw/validation ${width}px, no overflow`);
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/admin/data/offering-plans?id='+fixtures.REVIEW_REQUIRED);await page.getByRole('heading',{name:'Offering 계획 후보'}).waitFor();assert.equal(await page.getByRole('radio').count(),2);assert.equal(await page.getByRole('radio').filter({has:page.locator(':checked')}).count(),0);
 const stamp=Date.now(),approvalReason='LOCAL browser fixture approval '+stamp;
 await page.getByRole('radio').nth(1).check();await page.getByRole('textbox',{name:'사유 (필수)'}).fill(approvalReason);await page.getByRole('button',{name:'선택 후보 승인'}).click();await page.locator('p').filter({hasText:approvalReason}).waitFor();
 for(const [name,label]of [['보류','LOCAL browser fixture hold'],['거절','LOCAL browser fixture reject']]){const reason=label+' '+stamp;await page.getByRole('textbox',{name:'사유 (필수)'}).fill(reason);await page.getByRole('button',{name,exact:true}).click();await page.locator('p').filter({hasText:reason}).waitFor();}
 await page.screenshot({path:join(out,'offering-review.png'),fullPage:false});checks.push('review radio single selection / approve / hold / reject and append-only history');
 assert.ok(await page.getByRole('heading',{name:'같은 등록신고서의 공시별 조건'}).count());checks.push('family accession conditions shown separately');
 const api=base+'/api/admin/data/offering-plans/'+fixtures.REVIEW_REQUIRED;
 assert.equal((await context.request.post(api,{headers:{Origin:'https://untrusted.example','x-request-id':crypto.randomUUID()},data:{action:'hold',reason:'denied',candidateIndexes:[]}})).status(),403);checks.push('cross-origin decision denied');
 await page.goto(base+'/admin/data/offering-plans?id='+fixtures.TECHNICAL_FAILED);if(await page.getByRole('textbox',{name:'사유 (필수)'}).count()){await page.getByRole('textbox',{name:'사유 (필수)'}).fill('LOCAL safe retry fixture');await page.getByRole('button',{name:'다시 시도',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('textarea'));}checks.push('safe technical retry queues only, no worker invoked');
 await page.goto(base+'/admin/data/offering-plans?id='+fixtures.VALIDATION_FAILED);assert.equal(await page.getByRole('button',{name:'다시 시도',exact:true}).count(),0);checks.push('validation failure has no retry');
 await page.goto(base+'/admin/data');await page.getByRole('link',{name:/SEC Offering Plans/}).click();await page.getByRole('heading',{name:'공시 목록'}).waitFor();checks.push('navigation and list');
 const nonadmin=(await db.query("select email from auth.users u where email='sr-review-user-2c55eba8@example.test' and not exists(select 1 from public.admin_role_assignments a where a.user_id=u.id and a.active) limit 1")).rows[0];
 if(nonadmin){const c=await login(nonadmin.email),p=await c.newPage();await p.goto(base+'/admin/data/offering-plans');assert.ok(p.url().includes('/login'));assert.equal((await c.request.post(api,{headers:{Origin:base,'x-request-id':crypto.randomUUID()},data:{action:'hold',reason:'denied',candidateIndexes:[]}})).status(),403);await c.close();checks.push('authenticated non-admin page/API denied');}else throw Error('No local non-admin fixture available');
 assert.deepEqual(errors,[]);writeFileSync(join(out,'browser-report.json'),JSON.stringify({pass:true,checks,pageErrors:errors},null,2));console.log(JSON.stringify({pass:true,checks,pageErrors:errors}));await context.close();
}finally{await browser.close();await db.end();}
