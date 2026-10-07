// Existing Next server + real components, with browser-side search API fixtures.
// NOT server-to-SEC E2E. Never submits Watchlist/Alert mutations or posts.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.F2_BROWSER_BASE || 'http://127.0.0.1:3117';
const output = process.env.F2_BROWSER_OUTPUT;
const row = { ticker: 'SYN', companyName: 'Synthetic Search Company', exchange: 'NYSE', assetType: 'stock', marketCap: 42 };
const unavailable = 'Ticker search is temporarily unavailable. Please try again.';
const partial = 'Some results may be unavailable.';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext();
  const errors = [], reports = [], requests = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base) return route.abort();
    if (!['GET', 'HEAD'].includes(route.request().method())) throw Error('No mutations permitted');
    if (url.pathname !== '/api/tickers/search') return route.continue();
    const query = url.searchParams.get('q'); requests.push(query);
    const status = query.includes('Fail') ? 503 : 200;
    const json = status === 503 ? { ok: false, error: 'TICKER_SEARCH_UNAVAILABLE', message: unavailable }
      : { ok: true, data: query.includes('Empty') ? [] : [row], ...(query.includes('Partial') ? { partial: true } : {}) };
    if (query.startsWith('Slow')) await pause(900);
    try { await route.fulfill({ status, json }); } catch { /* Aborted old browser request. */ }
  });
  try {
    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/watchlist`, { waitUntil: 'domcontentloaded' });
      // SSR exposes the opener before React attaches event handlers in dev mode.
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Search stocks', exact: true }).click();
      const header = page.getByRole('combobox', { name: 'Search ticker or company', exact: true });
      const dialog = page.getByRole('dialog', { name: 'Search stocks' });
      for (const state of ['Normal', 'Empty', 'Partial', 'Fail', 'Recovery']) {
        console.log('Checking header', width, state);
        await header.fill(`Query${state}`);
        if (state === 'Fail') await dialog.getByRole('alert').filter({ hasText: unavailable }).waitFor();
        else if (state === 'Empty') await dialog.getByText('No matching active ticker.', { exact: true }).waitFor();
        else await dialog.getByRole('option').waitFor();
        const readout = dialog.locator('output');
        const expected = state === 'Fail' ? 'failure' : state === 'Partial' ? 'partial' : 'success';
        assert.equal(await readout.getAttribute('data-ticker-flow-response-status'), expected);
        assert.equal(await dialog.getByText(partial, { exact: true }).count(), state === 'Partial' ? 1 : 0);
        const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        assert.equal(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
        if (output && ['Partial', 'Fail'].includes(state)) await page.screenshot({ path: `${output}/f2-header-${width}-${state}.png` });
        reports.push({ surface: 'header', width, state, responseStatus: expected, layout: 'pass' });
      }
      for (const old of ['SlowNormal', 'SlowFail']) {
        const count = requests.length; await header.fill(old);
        while (requests.length === count) await pause(25);
        await header.fill('NewPartial'); await dialog.getByText(partial, { exact: true }).waitFor();
        await pause(1000); assert.equal(await dialog.locator('output').getAttribute('data-ticker-flow-response-status'), 'partial');
      }
      await header.press('ArrowDown'); await header.press('Enter');
      await page.waitForURL(`${base}/stocks/SYN`);
      reports.push({ surface: 'header', width, staleSuccessAndFailureIgnored: true, keyboardNavigation: '/stocks/SYN' });

      await page.goto(`${base}/alerts`, { waitUntil: 'domcontentloaded' });
      const autocomplete = page.getByRole('combobox', { name: 'Search ticker or company to add', exact: true });
      await autocomplete.waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      const list = page.getByRole('listbox', { name: 'Search ticker or company to add results' });
      for (const state of ['Normal', 'Empty', 'Partial', 'Fail', 'Recovery']) {
        console.log('Checking autocomplete', width, state);
        await autocomplete.fill(`Query${state}`);
        if (state === 'Fail') await list.getByRole('alert').filter({ hasText: unavailable }).waitFor();
        else if (state === 'Empty') await list.getByText('No matching listed ticker.', { exact: true }).waitFor();
        else await list.getByRole('option').waitFor();
        assert.equal(await list.getByText(partial, { exact: true }).count(), state === 'Partial' ? 1 : 0);
        const box = await list.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        assert.equal(await list.evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
        if (output && ['Partial', 'Fail'].includes(state)) await page.screenshot({ path: `${output}/f2-autocomplete-${width}-${state}.png` });
        reports.push({ surface: 'autocomplete', width, state, layout: 'pass' });
      }
      for (const old of ['SlowNormal', 'SlowFail']) {
        const count = requests.length; await autocomplete.fill(old);
        while (requests.length === count) await pause(25);
        await autocomplete.fill('NewPartial'); await list.getByText(partial, { exact: true }).waitFor();
        await pause(1000); await list.getByText(partial, { exact: true }).waitFor();
      }
      await autocomplete.press('ArrowDown'); await autocomplete.press('Enter');
      assert.equal(await autocomplete.inputValue(), 'SYN');
      reports.push({ surface: 'autocomplete', width, staleSuccessAndFailureIgnored: true, keyboardSelection: 'SYN', persistence: 0 });
    }
    await page.goto(`${base}/live/SYN`, { waitUntil: 'domcontentloaded' });
    await pause(1500);
    reports.push({ surface: 'live-room', url: page.url(), newPostButtons: await page.getByRole('button', { name: 'New post', exact: true }).count(), text: (await page.locator('body').innerText()).slice(-1600) });
    if (output) await page.screenshot({ path: `${output}/f2-live-room-guest.png` });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ pass: true, browser: 'installed Edge via bundled Playwright', apiFixturesOnly: true, errors, reports }, null, 2));
  } catch (error) {
    console.log('FAILURE_CONTEXT', JSON.stringify({ url: page.url(), requests, errors, text: (await page.locator('body').innerText()).slice(-6500) }));
    if (output) await page.screenshot({ path: `${output}/f2-browser-failure.png` });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
