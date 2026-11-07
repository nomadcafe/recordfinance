// Browser tests: the bugs `node test.js` can't see, because they only show up when
// the page is clicked through (a form that isn't cleared, a table wider than a phone).
//
//   node e2e.js
//
// Optional and separate from test.js, which stays zero-dependency. This one needs
// Playwright and a local Google Chrome (it drives the installed Chrome, so no browser
// download is needed):
//
//   npm i --no-save playwright-core     # or set PLAYWRIGHT=/path/to/playwright
//
// It serves this folder itself on a free port. Chart.js loads from the CDN, so it
// needs a network connection.

const http = require('http');
const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  for (const id of [process.env.PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(id); } catch (_) { /* try the next */ }
  }
  console.error('Playwright not found. Install it with `npm i --no-save playwright-core`,\n' +
    'or point PLAYWRIGHT at an existing copy (the folder that contains its package.json).');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.txt': 'text/plain', '.xml': 'text/xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

let passed = 0, failed = 0;
const ck = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : '')); }
};

(async () => {
  const server = await serve();
  const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch({ channel: 'chrome' });

  // Each test gets a fresh context: empty storage, no service worker carried over.
  async function page({ width = 1100, lang = 'zh' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 1400 }, locale: lang === 'zh' ? 'zh-CN' : lang, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.errors = [];
    p.on('pageerror', e => p.errors.push(e.message));
    p.on('dialog', d => d.type() === 'confirm' ? d.accept() : d.dismiss());
    await p.goto(URL_);
    await p.click('#welcomeDemoBtn');
    await p.waitForSelector('#spendingPanel:not([hidden])', { timeout: 15000 });
    if (lang !== 'zh' || (await p.$eval('#langSelect', s => s.value)) !== lang) {
      await p.selectOption('#langSelect', lang);
    }
    return p;
  }
  const done = async p => { ck('no script errors', p.errors.length === 0, p.errors); await p.context().close(); };
  const sec = name => console.log('\n' + name);

  try {
    for (const lang of ['zh', 'en', 'ja']) {
      sec(`Demo renders (${lang})`);
      const p = await page({ lang });
      const text = await p.evaluate(() => document.body.innerText);
      ck('no missing translation shows as "undefined"', !/\bundefined\b|\bNaN\b/.test(text),
        (text.match(/.{0,30}(undefined|NaN).{0,30}/) || [])[0]);
      ck('the spending panel has bars', await p.$eval('#spendingChart', c => c.width > 0));
      await done(p);
    }

    sec('Phone width');
    {
      const p = await page({ width: 390 });
      await p.click('#spendingTableSummary');
      const w = await p.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        table: document.querySelector('.spend-table-scroll').scrollWidth,
        tableBox: document.querySelector('.spend-table-scroll').clientWidth,
      }));
      ck('the page does not scroll sideways', w.page <= 390, w);
      ck('the spending table fits without scrolling', w.table <= w.tableBox, w);
      await done(p);
    }

    sec('Spending table');
    {
      const p = await page();
      ck('collapsed until asked for', !(await p.$eval('#spendingTableWrap', d => d.open)));
      await p.click('#spendingTableSummary');
      const rows = await p.$$eval('#spendingTable tbody tr', trs => trs.map(tr => [...tr.cells].map(c => c.innerText.trim())));
      ck('one row per month', rows.length === 12, rows.length);
      ck('newest month first', rows[0][0] > rows[rows.length - 1][0], [rows[0][0], rows[rows.length - 1][0]]);
      ck('every row ends with a savings rate', rows.every(r => /%$|—$/.test(r[r.length - 1])), rows.map(r => r[r.length - 1]));
      await done(p);
    }

    sec('Copy last month\'s inflow');
    {
      const p = await page();
      await p.fill('#date', '2026-12-05');
      await p.waitForSelector('#inflowCopyBtn');
      const preview = await p.$eval('.inflow-copy-preview', e => e.innerText);
      ck('the reminder offers last month\'s figures', /\d/.test(preview), preview);
      await p.click('#inflowCopyBtn');
      const inflows = await p.$$eval('#balanceRows .row-inflow-input, #balanceRows .leg-inflow', a => a.map(i => i.value).filter(Boolean));
      const amounts = await p.$$eval('#balanceRows .balance-row .amt-input', a => a.map(i => i.value));
      ck('fills the inflow boxes', inflows.length > 0, inflows);
      ck('and derives the balances', amounts.every(Boolean), amounts);
      ck('and the reminder goes away', await p.$eval('#inflowReminder', e => e.hidden));
      await done(p);
    }

    sec('Saving a tagged expense');
    {
      const p = await page();
      const before = await p.locator('#historyTable tbody tr').count();
      await p.selectOption('#balanceRows .acc-sel >> nth=0', { index: 1 });
      await p.fill('#balanceRows .amt-input >> nth=0', '700000');
      await p.click('#expenseSummary');
      await p.fill('#expenseRows .exp-label >> nth=0', '房租e2e');
      await p.fill('#expenseRows .amt-input >> nth=0', '8000');
      await p.click('#saveBtn');
      await p.waitForFunction(n => document.querySelectorAll('#historyTable tbody tr').length > n, before);
      ck('the record shows its tag in history', (await p.$eval('#historyTable tbody', b => b.innerText)).includes('房租e2e'));
      ck('the form forgets the tag afterwards',
        (await p.$$eval('#expenseRows .exp-label', a => a.map(i => i.value))).every(v => v === ''));
      await done(p);
    }

    sec('Deleting the record being edited');
    {
      const p = await page();
      const row = p.locator('#historyTable tbody tr').first();
      await row.locator('button[data-edit]').click();
      ck('editing', !(await p.$eval('#editBadge', e => e.hidden)));
      await row.locator('button.danger').click();
      await p.waitForFunction(() => document.getElementById('editBadge').hidden);
      const left = await p.evaluate(() => ({
        amounts: [...document.querySelectorAll('#balanceRows .amt-input')].map(i => i.value).filter(Boolean),
        labels: [...document.querySelectorAll('#expenseRows .exp-label')].map(i => i.value).filter(Boolean),
      }));
      ck('leaves no trace of it in the form', !left.amounts.length && !left.labels.length, left);
      await done(p);
    }

    sec('Privacy blur');
    {
      const p = await page();
      await p.fill('#date', '2026-12-05');
      await p.waitForSelector('#inflowCopyBtn');
      await p.click('#spendingTableSummary');
      await p.click('#privacyBtn');
      const blurred = sel => p.$eval(sel, e => getComputedStyle(e).filter.includes('blur'));
      for (const sel of ['.stat-value', '.spend-avg', '.spend-chart', '#spendingTable td.num', '.copy-amt', '.inflow-line']) {
        ck(`${sel} is blurred`, await blurred(sel).catch(() => false));
      }
      await done(p);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
