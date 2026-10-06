const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH);
const base=process.env.SEC_HEADER_BASE,output=process.env.SEC_HEADER_OUTPUT,phase=process.env.SEC_HEADER_PHASE;
const expected=JSON.parse(fs.readFileSync(process.env.SEC_HEADER_EXPECTED,'utf8'));
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});const context=await browser.newContext();
  const page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(120000);
  const errors=[],checks=[],requests=[],excluded=[],consoleErrors=[],failedRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==base)return route.abort();
    if(!['GET','HEAD'].includes(req.method())){excluded.push({path:url.pathname,method:req.method()});return route.abort();}
    if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/tickers/search'){
      excluded.push({path:url.pathname,method:req.method()});
      return route.fulfill({status:503,json:{ok:false,error:'Verification excluded ancillary dependency'}});
    }
    return route.continue();
  });
  page.on('response',r=>{if(r.url().includes('/api/tickers/search'))requests.push({url:r.url(),status:r.status()});});
  const header=()=>page.getByLabel('Stock company and quote',{exact:true});
  async function inspect(identity,width,label){
    await header().waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Stock company and quote"]')?.dataset.companyIdentityState==='available');
    const h=header();await h.getByRole('heading',{name:identity.ticker,exact:true}).waitFor();
    assert.equal(await h.getByText(identity.companyName,{exact:true}).count(),1);
    assert.equal(await h.getByText(identity.exchange,{exact:true}).count(),1);
    assert.equal(await h.locator('time').getAttribute('datetime'),identity.confirmedAt);
    await h.getByText('QUOTE UNAVAILABLE',{exact:true}).waitFor();assert.equal(await h.getByText('TICKER UNAVAILABLE',{exact:true}).count(),0);
    const readout=page.getByRole('status',{name:'Ticker search to stock detail state'});
    assert.equal(await readout.getAttribute('data-ticker-flow-company-identity-state'),'available');
    // SEC identity must not force overview ready.
    await page.waitForFunction(()=>document.querySelector('[data-ticker-flow-stage="detail"]')?.dataset.tickerFlowDetailRenderState==='unavailable');
    assert.equal(await h.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:`${output}/${phase}-${width}-${label}.png`});
    const geometry=await h.locator('h1,h2,h3,small,time').evaluateAll(elements=>elements.map(e=>({tag:e.tagName,text:e.textContent,width:e.clientWidth,scrollWidth:e.scrollWidth,rect:e.getBoundingClientRect().toJSON()})));
    checks.push({ticker:identity.ticker,width,label,company:identity.companyName,exchange:identity.exchange,confirmedAt:identity.confirmedAt,geometry,
      text:await h.innerText(),flow:await readout.evaluate(e=>({...e.dataset})),overflow:false});
  }
  try {
    await page.setViewportSize({width:1440,height:1000});
    const first=expected.pairs[0];
    await page.goto(`${base}/stocks/${first.ticker}`,{waitUntil:'domcontentloaded'});
    await header().waitFor();assert.ok((await page.locator('body').innerText()).length>100);
    assert.equal(await page.locator('[data-nextjs-dialog]').count(),0);
    if(phase==='preflight'){
      assert.equal(await header().getAttribute('data-company-identity-state'),'not-confirmed');
      assert.equal(await header().locator('time').count(),0);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button',{name:'Search stocks',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Search stocks'});
      await dialog.getByRole('combobox',{name:'Search ticker or company',exact:true}).fill(first.ticker);
      await dialog.getByRole('option',{name:new RegExp(`^${first.ticker}\\s`)}).first().waitFor();
      await page.screenshot({path:`${output}/preflight-search.png`});
      checks.push({case:'actual empty-current stock route and public search control before Submissions',ticker:first.ticker});
    } else if(phase==='db-failure'){
      assert.equal(await header().getAttribute('data-company-identity-state'),'unavailable');
      await header().getByText('Company information temporarily unavailable',{exact:true}).waitFor();
      assert.equal(await header().locator('time').count(),0);assert.equal(await header().getByText(first.companyName,{exact:true}).count(),0);
      await page.screenshot({path:`${output}/db-failure.png`});checks.push({case:'actual missing SQL table',status:'unavailable',previousIdentityHidden:true});
    } else {
      await inspect(first,1440,'direct');
      assert.equal(await page.locator('[data-ticker-flow-stage="detail"]').getAttribute('data-ticker-flow-request-state'),'unobserved');
      if(phase==='normal'||phase==='live'){
        await page.goto(`${base}/watchlist`,{waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Search stocks',exact:true}).waitFor();
        await page.waitForLoadState('networkidle');
        for(const width of [1440,900,390]){
          await page.setViewportSize({width,height:1000});
          for(const identity of expected.pairs){
            await page.getByRole('button',{name:'Search stocks',exact:true}).click();
            const dialog=page.getByRole('dialog',{name:'Search stocks'});
            const input=dialog.getByRole('combobox',{name:'Search ticker or company',exact:true});await input.fill(identity.ticker);
            const option=dialog.getByRole('option',{name:new RegExp(`^${identity.ticker}\\s`)}).first();
            await option.waitFor();
            if(phase==='live'&&width===900){
              // Focus the actual matched option and use its existing keyboard click.
              await option.focus();await option.press('Enter');
            }else await option.click();
            await page.waitForURL(`${base}/stocks/${identity.ticker}`);
            await inspect(identity,width,identity.ticker);
            assert.equal(await page.locator('[data-ticker-flow-stage="detail"]').getAttribute('data-ticker-flow-route-matches-selection'),'true');
            assert.equal(await page.locator('[data-ticker-flow-stage="detail"]').getAttribute('data-ticker-flow-route-ticker'),identity.ticker);
            checks.at(-1).selection=phase==='live'&&width===900?'keyboard':'click';
            console.log(JSON.stringify({browser:'header',ticker:identity.ticker,width,pass:true}));
          }
        }
        // Real URL normalization, then back/forward across two issuer identities.
        await page.goto(`${base}/stocks/${first.ticker.toLowerCase()}`);await page.waitForURL(`${base}/stocks/${first.ticker}`);await inspect(first,390,'normalized');
        const second=expected.pairs.find(p=>p.companyName!==first.companyName);
        await page.goto(`${base}/stocks/${second.ticker}`);await inspect(second,390,'second');
        await page.goBack();await inspect(first,390,'back');await page.goForward();await inspect(second,390,'forward');
        if(phase==='live'){await page.reload();await inspect(second,390,'reload');}
        for(const [ticker,label] of [[expected.missingTicker,'no-current'],[expected.syntheticTicker,'no-exact-listing']].filter(([ticker])=>ticker)){
          await page.goto(`${base}/stocks/${ticker}`);await header().waitFor();
          assert.equal(await header().getAttribute('data-company-identity-state'),'not-confirmed');
          await header().getByText('Company information not yet confirmed',{exact:true}).waitFor();assert.equal(await header().locator('time').count(),0);
          await page.screenshot({path:`${output}/${label}.png`});checks.push({ticker,label,status:'not-confirmed',text:await header().innerText()});
        }
      }
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(`${output}/browser-${phase}.json`,JSON.stringify({pass:true,checks,requests,errors,consoleErrors,failedRequests,excluded},null,2));
    console.log(JSON.stringify({browserPhase:phase,pass:true,checks:checks.length}));
  }catch(e){
    fs.writeFileSync(`${output}/browser-${phase}-failure.json`,JSON.stringify({message:e.message,checks,requests,errors,consoleErrors,failedRequests,excluded,url:page.url(),body:(await page.locator('body').innerText()).slice(0,10000)},null,2));
    await page.screenshot({path:`${output}/failure-${phase}.png`});throw e;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
