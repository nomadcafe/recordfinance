#!/usr/bin/env node
'use strict';
/*
 * Regression tests for the money math in index.html.  Run: node test.js
 *
 * No dependencies and no build step: the app is one <script> inside index.html, so the
 * functions under test are pulled out of it by name and evaluated against the stub
 * globals below.  That couples this file to the source's shape — functions are found by
 * a `\n  function NAME(` match, i.e. top-level in that script at two-space indent.  If a
 * function is renamed, moved or re-indented, the run fails fast with "not found: NAME"
 * rather than silently testing nothing.
 *
 * Covers what is expensive to get wrong and invisible when it is: how a balance change is
 * attributed (money you moved vs. market vs. unrecorded), realized return with cash flows,
 * the legacy-inflow migration, and the transfer helper's row arithmetic.
 */
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, 'index.html');

/* ---------- pull the app's functions out of index.html ---------- */
const html = fs.readFileSync(SRC, 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).sort((a, b) => b.length - a.length)[0];   // the app script is the big one

function grabFn(name) {
  const at = inline.search(new RegExp('\\n  function ' + name + '\\s*\\('));
  if (at < 0) throw new Error('not found: ' + name + ' (renamed, moved, or re-indented?)');
  const start = at + 1;
  let i = inline.indexOf('{', inline.indexOf(')', start)), depth = 0;
  for (;; i++) {
    if (inline[i] === '{') depth++;
    else if (inline[i] === '}' && --depth === 0) break;
  }
  return inline.slice(start, i + 1);
}
function grabConst(re) {
  const m = inline.match(re);
  if (!m) throw new Error('not found: ' + re);
  return m[0];
}

const FNS = [
  'residualKind', 'chargesInterest', 'interestPart', 'theilSen', 'debtPayoffMonths', 'computeDebt', 'isIdleAccount', 'snapshotAccountInflow', 'accountInflowInDisplay',
  'accountOpeningContribution', 'windowHasUnattributedInflow', 'decomposePeriod',
  'sumConvertedAt', 'realizedReturn', 'trailingYearStart', 'computeEfficiency',
  'computePeriodChange', 'computeAccountPeriodChange', 'hasAnyInflowData',
  'renderSplitChips', 'renderEfficiency', 'isNegligible', 'fmtPct', 'fmtSigned', 'fmt',
  'decimalsFor', '_computeTimeline', 'totalForBasis', 'updateLegs',
  'snapshotInflowInDisplay', 'buildDemoData', 'migrate', 'sanitizePublicExport',
  'getAmountPlaceholder', 'bestRatesForDate', 'autofillRowBalance', 'autofillLegBalance',
  'transferLegFor', 'setRowInflow', 'adaptColor', 'sanitizeExpenses', 'expensesInWindow', 'expenseSearchTotal', 'monthlySpending', 'savingsRate', 'monthHasIncome', 'formHasInflow', 'collectExpenses',
  'expenseItemsHtml', 'previousMonthInflows', 'applyInflowCopy', 'renderSpendingTable',
];

/* ---------- stub globals the extracted code closes over ---------- */
// Node >= 21 exposes `navigator` and `crypto` as getter-only globals, so plain
// assignment throws. Define over them where allowed; the runtime's own
// crypto.randomUUID is a fine fallback (no test depends on predictable ids).
const stubGlobal = (name, value) => {
  try { Object.defineProperty(global, name, { value, configurable: true, writable: true }); }
  catch (_) { /* keep whatever the runtime provides */ }
};
stubGlobal('navigator', { languages: ['zh-CN'] });
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  stubGlobal('crypto', { randomUUID: (() => { let n = 0; return () => 'id-' + (++n); })() });
}
const BODY_CLASSES = new Set();
const DOM = {};
global.document = { getElementById: id => (DOM[id] = DOM[id] || { id, value: '',
  set hidden(v) { this._h = v; }, get hidden() { return this._h; },
  set textContent(v) { this._t = v; }, get textContent() { return this._t; },
  set innerHTML(v) { this._i = v; }, get innerHTML() { return this._i; } }) };
// seriesHex() reads the painted theme off <body>; mirror app.state.theme onto it.
global.document.body = { classList: {
  contains: c => BODY_CLASSES.has(c), add: c => BODY_CLASSES.add(c), remove: c => BODY_CLASSES.delete(c),
} };

const PRELUDE = `
  ${grabConst(/  const CURRENCIES = \[[\s\S]*?\n  \];/)}
  ${grabConst(/  const PALETTE = \[[\s\S]*?\];/)}
  ${grabConst(/  const SERIES = \{[\s\S]*?\n  \};/)}
  ${grabConst(/  const seriesHex =[\s\S]*?;\n/)}
  ${grabConst(/  const LEGACY_SLOT = \{[\s\S]*?\n  \};/)}
  ${grabConst(/  const SLOT_OF_HEX = \(\(\) => \{[\s\S]*?\n  \}\)\(\);/)}
  ${grabConst(/  const CURRENCY_SLOT = \{[\s\S]*?\n  \};/)}
  ${grabConst(/  const CURRENCY_COLORS = new Proxy[^\n]+/)}
  ${grabConst(/  const CATEGORY_SLOT = \{[\s\S]*?\n  \};/)}
  ${grabConst(/  const CATEGORY_COLORS = new Proxy[^\n]+/)}
  ${grabConst(/  const monthRate = [^\n]+/)}
  ${grabConst(/  const INTEREST_CATEGORIES = [^\n]+/)}
  ${grabConst(/  const MIN_DEBT_WINDOW_DAYS = [^\n]+/)}
  const SYMBOLS = Object.fromEntries(CURRENCIES.map(c => [c.code, c.symbol]));
  const CUR_CODES = CURRENCIES.map(c => c.code);
  const ZERO_DECIMAL = new Set(['JPY', 'KRW']);
  const CATEGORIES = ['cash','savings','investment','property','crypto','other'];
  const LIABILITY_CATEGORIES = ['mortgage','creditCard','loan','other'];
  function categoriesFor(type) { return type === 'liability' ? LIABILITY_CATEGORIES : CATEGORIES; }
  const SELF_MOVING_CATEGORIES = new Set(['investment','property','crypto']);
  const IDLE_CATEGORIES = new Set(['cash','savings']);
  const DAY_MS = 86400000;
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY_MS);
  const MIN_RETURN_WINDOW_DAYS = 60;

  let state = { language: 'zh', displayCurrency: 'CNY', basis: 'net', rates: {}, accounts: [], snapshots: [] };
  let entryRows = [];
  let entryExpenses = [];
  function t(key, ...a) { const d = I18N[state ? state.language : 'zh'] || I18N.zh; const v = d[key]; return typeof v === 'function' ? v(...a) : v; }
  const signFor = type => (type === 'liability' ? -1 : 1);
  const signedAmount = (amount, type) => amount * signFor(type);
  const accountById = id => state.accounts.find(a => a.id === id) || null;
  const sortedSnapshots = () => [...state.snapshots].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const accountCurrencies = a => (a.currencies && a.currencies.length ? a.currencies : [a.currency]);
  const isMultiCurrency = a => accountCurrencies(a).length > 1;
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function convert(amount, from, to, rates) {
    if (amount == null || isNaN(amount)) return null;
    if (from === to) return Number(amount);
    if (!rates) return null;
    const r = rates[from] && rates[from][to];
    return r == null ? null : Number(amount) * r;
  }
  const localDateStr = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const detectLanguage = () => 'zh';
  const todayStr = () => '2026-01-01';
  function computeTimeline() { return _computeTimeline(); }
  function currentSnapshot() { const tl = computeTimeline(); return tl.length ? tl[tl.length - 1] : null; }
  function newEmptyRow() { return { rowId: 'r' + (++rowSeq), accountId: '', amount: '', currency: state.displayCurrency, inflow: '' }; }
  let rowSeq = 0;
`;

const I18N_SRC = fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8').replace('const I18N', 'var I18N');
const app = new Function(`
  ${I18N_SRC}
  ${PRELUDE}
  ${FNS.map(grabFn).join('\n\n')}
  return { get state() { return state; }, set state(v) { state = v; },
    get rows() { return entryRows; }, set rows(v) { entryRows = v; },
    set expenseRows(v) { entryExpenses = v; },
    computeTimeline, signFor, SERIES, PALETTE, CATEGORY_COLORS, CURRENCY_COLORS,
    ${FNS.join(', ')} };
`)();

/* ---------- assertions ---------- */
let pass = 0, fail = 0, section = '';
const sec = n => { section = n; console.log('\n' + n); };
const ck = (name, cond, got) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (got !== undefined ? '  -> ' + JSON.stringify(got) : '')); }
};
const near = (a, b, tol = 0.01) => a != null && Math.abs(a - b) <= tol;
const pc = v => v == null ? 'null' : (v * 100).toFixed(1) + '%';
const day = (base, n) => new Date(new Date(base).getTime() + n * 86400000).toISOString().slice(0, 10);
const strip = h => String(h).replace(/<[^>]+>/g, '|').replace(/\|+/g, ' | ').replace(/\s+/g, ' ').trim();
const B = '2025-01-01';
const snap = (d, u, extra) => Object.assign({ id: 'S' + d + Math.random(), date: d, note: '', updates: u }, extra || {});
const A = (id, category, over) => Object.assign({ id, name: id, type: 'asset', category, currency: 'CNY', color: '#4ade80' }, over || {});
const LI = (id, category) => ({ id, name: id, type: 'liability', category, currency: 'CNY', color: '#fb7185' });
const load = (accounts, snapshots, over) => {
  app.state = Object.assign({
    accounts, snapshots, basis: 'net', displayCurrency: 'CNY', language: 'zh',
    rates: Object.fromEntries(snapshots.map(s => [s.date, { USD: { CNY: 7 }, CNY: { USD: 1 / 7 } }])),
  }, over || {});
};

sec('Attribution: what a balance change was');
load([A('b', 'savings')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
  snap('2026-10-15', { b: { amount: 112000, currency: 'CNY', inflow: 20000 } }),
]);
{
  const r = app.computePeriodChange('2026-10-01');
  ck('a bank residual is unrecorded spending, not a loss', near(r.split.untracked, -8000), r.split);
  ck('and never a market move', near(r.split.market, 0));
  ck('buckets reconcile with the headline', near(r.split.inflow + r.split.market + r.split.untracked, r.delta));
}
load([A('s', 'investment')], [
  snap('2026-09-30', { s: { amount: 500000, currency: 'CNY' } }),
  snap('2026-10-15', { s: { amount: 505000, currency: 'CNY', inflow: 30000 } }),
]);
{
  const r = app.computePeriodChange('2026-10-01');
  ck('a brokerage residual IS a market loss', near(r.split.market, -25000), r.split);
  ck('its unrecorded bucket stays empty', near(r.split.untracked, 0));
}
load([LI('c', 'creditCard')], [
  snap('2026-09-30', { c: { amount: 5000, currency: 'CNY' } }),
  snap('2026-10-15', { c: { amount: 3000, currency: 'CNY', inflow: -5000 } }),
]);
{
  const r = app.computePeriodChange('2026-10-01');
  ck('net worth rises as debt falls', near(r.delta, 2000), r.delta);
  ck('repayment reads as inflow', near(r.split.inflow, 5000));
  ck('unrecorded card spend is negative', near(r.split.untracked, -3000));
  ck('debt is never a market gain', near(r.split.market, 0));
}

sec('Interest on a mortgage or loan');
{
  // A 5,000 instalment from the bank, of which only 3,000 came off the mortgage.
  const accs = [A('b', 'savings'), LI('m', 'mortgage')];
  load(accs, [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, m: { amount: 400000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 95000, currency: 'CNY', inflow: -5000 }, m: { amount: 397000, currency: 'CNY', inflow: -5000 } }),
  ]);
  const r = app.computePeriodChange('2026-10-01');
  ck('the 2,000 not taken off principal is interest', near(r.split.interest, -2000), r.split);
  ck('and stays inside the unrecorded bucket', near(r.split.untracked, -2000));
  ck('so the split still reconciles', near(r.split.inflow + r.split.market + r.split.untracked, r.delta));
  const html = app.renderSplitChips(r);
  ck('the chips name it', /利息/.test(html), html);
  const acc = app.computeAccountPeriodChange('m', '2026-10-01');
  ck('the mortgage drilldown calls its residual interest', near(acc.split.interest, -2000) && /利息/.test(app.renderSplitChips(acc, acc.kind)), acc.split);
  // A loan is the same; a card is not — what grows a card is spending.
  load([A('b', 'savings'), LI('m', 'loan')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, m: { amount: 50000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 99000, currency: 'CNY', inflow: -1000 }, m: { amount: 49300, currency: 'CNY', inflow: -1000 } }),
  ]);
  ck('a loan charges interest too', near(app.computePeriodChange('2026-10-01').split.interest, -300));
  load([LI('c', 'creditCard')], [
    snap('2026-09-30', { c: { amount: 5000, currency: 'CNY' } }),
    snap('2026-10-15', { c: { amount: 3000, currency: 'CNY', inflow: -5000 } }),
  ]);
  ck('a card balance that grew is spending, not interest', near(app.computePeriodChange('2026-10-01').split.interest, 0));
  // Paid down by more than was recorded: an unrecorded repayment, never negative interest.
  load(accs, [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, m: { amount: 400000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 95000, currency: 'CNY', inflow: -5000 }, m: { amount: 390000, currency: 'CNY', inflow: -5000 } }),
  ]);
  ck('a balance that fell further than recorded is not interest', near(app.computePeriodChange('2026-10-01').split.interest, 0));
  // On the total-assets basis no liability is counted, so there is no interest either.
  load(accs, [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, m: { amount: 400000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 95000, currency: 'CNY', inflow: -5000 }, m: { amount: 397000, currency: 'CNY', inflow: -5000 } }),
  ], { basis: 'assets' });
  const ra = app.computePeriodChange('2026-10-01');
  ck('the assets basis carries no interest', !ra.split || near(ra.split.interest, 0), ra.split);
}

sec('Debt overview');
{
  // 13 monthly instalments of 3,000 on a 4%/yr mortgage, each recorded as a transfer
  // from the bank, the balance taken from the statement.
  const r = 0.04 / 12;
  let owed = 400000, bank = 200000;
  const snaps = [snap('2025-10-31', { b: { amount: bank, currency: 'CNY' }, m: { amount: owed, currency: 'CNY' } })];
  for (let k = 1; k <= 13; k++) {
    owed = Math.round((owed * (1 + r) - 3000) * 100) / 100;
    bank -= 3000;
    const d = new Date(2025, 10 + k, 0);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    snaps.push(snap(date, { b: { amount: bank, currency: 'CNY', inflow: -3000 }, m: { amount: owed, currency: 'CNY', inflow: -3000 } }));
  }
  load([A('b', 'savings'), LI('m', 'mortgage')], snaps);
  const d = app.computeDebt();
  const m = d.accounts[0];
  ck('total owed is the mortgage', near(d.total, owed), d.total);
  ck('debt ratio is owed over assets', near(d.ratio, owed / bank), d.ratio);
  ck('a year of paydown reads as a fall', d.change < 0, d.change);
  ck('the implied rate is close to the real 4%', Math.abs(m.rate - 0.04) < 0.003, m.rate);
  ck('principal per month is what came off', m.principal > 1600 && m.principal < 1750, m.principal);
  // The true payoff: keep paying 3,000 at 4% from today's balance.
  let left = owed, n = 0;
  while (left > 0 && n < 1000) { left = left * (1 + r) - 3000; n++; }
  ck('payoff matches a real amortization within a month', m.status === 'payoff' && Math.abs(m.months - n) <= 1, [m.months, n]);
  ck('and is named as a month', /^\d{4}-\d{2}$/.test(m.payoff), m.payoff);
  ck('interest paid is summed', d.interest > 15000 && d.interest < 17000, d.interest);

  // The annuity solve beats a straight line, which only errs late.
  ck('without a rate the estimate is a straight line', app.debtPayoffMonths(12000, 1000, 0) === 12);
  ck('with a rate it is shorter than owed ÷ principal', app.debtPayoffMonths(300000, 1500, 0.04 / 12) < 200);
  ck('no paydown, no date', app.debtPayoffMonths(1000, 0, 0) === null);
  ck('past 50 years, no date', app.debtPayoffMonths(1e9, 1, 0) === null);

  // A card revolves; a loan that isn't falling gets no date; a short history gets none.
  load([A('b', 'savings'), LI('c', 'creditCard')], [
    snap('2026-01-31', { b: { amount: 10000, currency: 'CNY' }, c: { amount: 3000, currency: 'CNY' } }),
    snap('2026-06-30', { b: { amount: 10000, currency: 'CNY' }, c: { amount: 2000, currency: 'CNY' } }),
  ]);
  ck('a card gets no payoff date', app.computeDebt().accounts[0].status === 'revolving');
  load([LI('l', 'loan')], [
    snap('2026-01-31', { l: { amount: 3000, currency: 'CNY' } }),
    snap('2026-06-30', { l: { amount: 3500, currency: 'CNY' } }),
  ]);
  ck('a loan that grew is not falling', app.computeDebt().accounts[0].status === 'notFalling');
  load([LI('l', 'loan')], [
    snap('2026-06-01', { l: { amount: 3000, currency: 'CNY' } }),
    snap('2026-06-30', { l: { amount: 2500, currency: 'CNY' } }),
  ]);
  ck('under two months, no estimate', app.computeDebt().accounts[0].status === 'short');
  // Without any repayment recorded there is no interest to read, so no rate either.
  load([LI('l', 'loan')], [
    snap('2026-01-31', { l: { amount: 3000, currency: 'CNY' } }),
    snap('2026-06-30', { l: { amount: 2500, currency: 'CNY' } }),
  ]);
  ck('no recorded repayment, no rate', app.computeDebt().accounts[0].rate === null && app.computeDebt().interest === null);
  load([A('b', 'savings')], [snap('2026-01-31', { b: { amount: 1, currency: 'CNY' } })]);
  ck('no debt, no panel', app.computeDebt() === null);
}

sec('Transfers between your own accounts');
{
  const accs = [A('b', 'savings'), A('s', 'investment')];
  load(accs, [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 500000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 90000, currency: 'CNY', inflow: -10000 }, s: { amount: 510000, currency: 'CNY', inflow: 10000 } }),
  ]);
  let r = app.computePeriodChange('2026-10-01');
  ck('both legs recorded -> no phantom spending or gain', near(r.split.untracked, 0) && near(r.split.market, 0), r.split);
  load(accs, [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 500000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 90000, currency: 'CNY' }, s: { amount: 510000, currency: 'CNY' } }),
  ]);
  r = app.computePeriodChange('2026-10-01');
  ck('unrecorded -> fake spending appears (what the dialog prevents)', near(r.split.untracked, -10000));
  ck('unrecorded -> fake gain appears', near(r.split.market, 10000));
}

sec('When the split must stay silent');
load([A('b', 'savings')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
  snap('2026-10-15', { b: { amount: 115000, currency: 'CNY' } }, { inflow: { amount: 20000, currency: 'CNY' } }),
]);
{
  const r = app.computePeriodChange('2026-10-01');
  ck('an unattributable legacy inflow suppresses the split', r.split === null);
  ck('and the fallback says "rest", not "gains"', /其余/.test(strip(app.renderSplitChips(r))), strip(app.renderSplitChips(r)));
}
load([A('u', 'savings', { currency: 'USD' })], [
  snap('2026-09-30', { u: { amount: 1000, currency: 'USD' } }),
  snap('2026-10-20', { u: { amount: 2000, currency: 'USD', inflow: 1000 } }),
], { rates: { '2026-09-30': { USD: { CNY: 7 } } } });
{
  const r = app.computePeriodChange('2026-10-01');
  ck('a missing rate suppresses rather than misattributes', r === null || r.split === null);
}
load([A('b', 'savings')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
  snap('2026-10-15', { b: { amount: 104000, currency: 'CNY' } }),
]);
ck('no inflow ever recorded -> no chips at all', app.renderSplitChips(app.computePeriodChange('2026-10-01')) === '');

sec('Basis and multi-currency');
load([A('b', 'savings'), LI('c', 'creditCard')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, c: { amount: 5000, currency: 'CNY' } }),
  snap('2026-10-15', { b: { amount: 110000, currency: 'CNY', inflow: 10000 }, c: { amount: 8000, currency: 'CNY' } }),
], { basis: 'assets' });
{
  const r = app.computePeriodChange('2026-10-01');
  ck('assets-only excludes the liability', near(r.delta, 10000), r.delta);
  ck('and still reconciles', near(r.split.inflow + r.split.market + r.split.untracked, r.delta));
}
load([A('m', 'savings', { currency: 'CNY', currencies: ['CNY', 'USD'] })], [
  snap('2026-09-30', { m: { currency: 'CNY', byCurrency: { CNY: { amount: 70000 }, USD: { amount: 1000 } } } }),
  snap('2026-10-15', { m: { currency: 'CNY', byCurrency: { CNY: { amount: 70000 }, USD: { amount: 2000, inflow: 1000 } } } }),
]);
{
  const r = app.computePeriodChange('2026-10-01');
  ck('a per-pocket inflow is converted', near(r.split.inflow, 7000), r.split);
  ck('and leaves no residual', near(r.split.untracked, 0));
}

sec('Per-account drilldown');
load([A('b', 'savings'), A('s', 'investment')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 500000, currency: 'CNY' } }),
  snap('2026-10-15', { b: { amount: 88000, currency: 'CNY', inflow: -10000 }, s: { amount: 515000, currency: 'CNY', inflow: 10000 } }),
]);
{
  const bank = app.computeAccountPeriodChange('b', '2026-10-01');
  ck('bank: transfer out, plus real spending', bank.kind === 'untracked' && near(bank.split.inflow, -10000) && near(bank.split.untracked, -2000), bank.split);
  const brk = app.computeAccountPeriodChange('s', '2026-10-01');
  ck('broker: money in, plus a real gain', brk.kind === 'market' && near(brk.split.inflow, 10000) && near(brk.split.market, 5000), brk.split);
}

sec('An account opened mid-window is not profit');
{
  const accs = [A('old', 'investment'), A('new', 'investment')];
  const base = [
    snap(B, { old: { amount: 1000000, currency: 'CNY' } }),
    snap(day(B, 183), { old: { amount: 1000000, currency: 'CNY' }, new: { amount: 500000, currency: 'CNY' } }),
    snap(day(B, 365), { old: { amount: 1080000, currency: 'CNY' }, new: { amount: 500000, currency: 'CNY' } }),
  ];
  load(accs, base);
  ck('the long-held fund alone reads +8%', near(app.realizedReturn(['old'], day(B, 1)).annualized, 0.08, 0.002), pc(app.realizedReturn(['old'], day(B, 1)).annualized));
  let r = app.realizedReturn(['old', 'new'], day(B, 1));
  ck('combined is 6.4%, not the 58% a raw endpoint diff gives', near(r.annualized, 0.064, 0.002), pc(r.annualized));
  ck('the gain is exactly the old fund\'s 80,000', near(r.gain, 80000, 1), r.gain);
  // Two records on the arrival date must not apply the contribution twice.
  const dupe = [base[0], base[1], snap(day(B, 183), { old: { amount: 1000000, currency: 'CNY' }, new: { amount: 500000, currency: 'CNY' } }), base[2]];
  load(accs, dupe);
  const r2 = app.realizedReturn(['old', 'new'], day(B, 1));
  ck('a duplicated record date changes nothing', near(r2.annualized, r.annualized, 1e-9) && r2.gain === r.gain, [pc(r2.annualized), r2.gain]);
}
load([A('b', 'savings'), A('s', 'investment')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY', inflow: 1000 } }),
  snap('2026-10-15', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 300000, currency: 'CNY' } }),
]);
{
  const r = app.computePeriodChange('2026-10-01');
  ck('the same correction applies to the MTD split', near(r.split.inflow, 300000) && near(r.split.market, 0), r.split);
  ck('and reconciles', near(r.split.inflow + r.split.market + r.split.untracked, r.delta));
}
load([A('b', 'savings'), A('s', 'investment')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY', inflow: 1000 } }),
  snap('2026-10-15', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 300000, currency: 'CNY', inflow: 300000 } }),
]);
ck('an opening balance already recorded is not counted twice', near(app.computePeriodChange('2026-10-01').split.inflow, 300000));
load([A('b', 'savings'), A('s', 'investment')], [
  snap('2026-09-30', { b: { amount: 100000, currency: 'CNY', inflow: 1000 } }),
  snap('2026-10-15', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 280000, currency: 'CNY', inflow: 300000 } }),
]);
ck('a day-one loss on a new account stays a loss', near(app.computePeriodChange('2026-10-01').split.market, -20000));

sec('Realized return (Modified Dietz)');
const one = pts => load([A('s', 'investment')], pts.map(p => snap(p.d, { s: Object.assign({ amount: p.a, currency: 'CNY' }, p.i != null ? { inflow: p.i } : {}) })));
one([{ d: B, a: 100000 }, { d: day(B, 365), a: 110000 }]);
ck('no flows: 10% over a year', near(app.realizedReturn(['s'], day(B, 1)).rate, 0.10, 0.0005));
one([{ d: B, a: 100000 }, { d: day(B, 1), a: 200000, i: 100000 }, { d: day(B, 365), a: 220000 }]);
ck('money in on day 1 was invested all year -> ~10%', near(app.realizedReturn(['s'], day(B, 1)).rate, 0.1001, 0.002), pc(app.realizedReturn(['s'], day(B, 1)).rate));
one([{ d: B, a: 100000 }, { d: day(B, 364), a: 210000, i: 100000 }, { d: day(B, 365), a: 210000 }]);
ck('money in on the last day earned nothing -> still ~10%', near(app.realizedReturn(['s'], day(B, 1)).rate, 0.0997, 0.002));
one([{ d: B, a: 100000 }, { d: day(B, 182), a: 105000 }]);
ck('half a year at 5% compounds to ~10.3%', near(app.realizedReturn(['s'], day(B, 1)).annualized, 0.1030, 0.002));
one([{ d: B, a: 200000 }, { d: day(B, 182), a: 110000, i: -100000 }, { d: day(B, 365), a: 115000 }]);
ck('a mid-period withdrawal is weighted too', near(app.realizedReturn(['s'], day(B, 1)).rate, 0.1001, 0.003));
one([{ d: B, a: 100000 }, { d: day(B, 365), a: 80000 }]);
ck('a loss reads as -20%', near(app.realizedReturn(['s'], day(B, 1)).rate, -0.20, 0.0005));
one([{ d: B, a: 100000 }, { d: day(B, 30), a: 103000 }]);
ck('a window under 60 days refuses to annualize', app.realizedReturn(['s'], day(B, 1)) === null);
one([{ d: B, a: 100000 }, { d: day(B, 365), a: 110000 }]);
ck('an empty account set is null', app.realizedReturn([], day(B, 1)) === null);
ck('a start on the first record uses it as the baseline', near(app.realizedReturn(['s'], B).rate, 0.10, 0.0005));
one([{ d: B, a: 100000 }, { d: day(B, 243), a: 106000 }]);
{
  const r = app.realizedReturn(['s'], day(B, -122));
  ck('less history than requested is measured, not refused', r.days === 243, r.days);
  ck('and annualized from the real span', near(r.annualized, 0.0914, 0.002), pc(r.annualized));
}
one([{ d: B, a: 100000 }, { d: day(B, 365), a: 0, i: 0 }]);
{
  const r = app.realizedReturn(['s'], day(B, 1));
  ck('-100% reports the period but will not annualize', near(r.rate, -1, 0.0005) && r.annualized === null, r);
}
{
  one([{ d: B, a: 100000 }, { d: day(B, 365), a: 110000 }]);
  app.state.snapshots[1].inflow = { amount: 5000, currency: 'CNY' };
  ck('a legacy unattributed inflow gives null, not a wrong rate', app.realizedReturn(['s'], day(B, 1)) === null);
}
load([A('u', 'investment', { currency: 'USD' })], [
  snap(B, { u: { amount: 10000, currency: 'USD' } }),
  snap(day(B, 365), { u: { amount: 11000, currency: 'USD' } }),
]);
ck('10% in display-currency terms', near(app.realizedReturn(['u'], day(B, 1)).rate, 0.10, 0.0005));

sec('Capital-efficiency panel');
load([A('cash', 'cash'), A('sav', 'savings'), A('inv', 'investment'), A('inv2', 'investment'), LI('card', 'creditCard')], [
  snap(B, { cash: { amount: 400000, currency: 'CNY' }, sav: { amount: 200000, currency: 'CNY' }, inv: { amount: 300000, currency: 'CNY' }, inv2: { amount: 100000, currency: 'CNY' }, card: { amount: 5000, currency: 'CNY' } }),
  snap(day(B, 365), { cash: { amount: 400000, currency: 'CNY' }, sav: { amount: 200000, currency: 'CNY' }, inv: { amount: 336000, currency: 'CNY' }, inv2: { amount: 103000, currency: 'CNY' }, card: { amount: 5000, currency: 'CNY' } }),
]);
{
  const e = app.computeEfficiency();
  ck('idle is cash + savings only', near(e.idleTotal, 600000, 1), e.idleTotal);
  ck('a liability is never idle capital', ![...e.idle, ...e.working].some(x => x.acc.type === 'liability'));
  ck('combined return is money-weighted', near(e.benchmark, 0.0975, 0.002), pc(e.benchmark));
  ck('the gap is idle x that rate', near(e.opportunity, 600000 * e.benchmark, 1));
  ck('working accounts rank best first', e.working.map(w => w.acc.id).join(',') === 'inv,inv2', e.working.map(w => w.acc.id));
}
load([A('big', 'investment'), A('small', 'investment'), A('cash', 'cash')], [
  snap(B, { big: { amount: 1000000, currency: 'CNY' }, small: { amount: 1000, currency: 'CNY' }, cash: { amount: 100000, currency: 'CNY' } }),
  snap(day(B, 365), { big: { amount: 1020000, currency: 'CNY' }, small: { amount: 1200, currency: 'CNY' }, cash: { amount: 100000, currency: 'CNY' } }),
]);
ck('2% on a million outweighs 20% on a thousand', near(app.computeEfficiency().benchmark, 0.0202, 0.002), pc(app.computeEfficiency().benchmark));
load([A('cash', 'cash'), A('sav', 'savings')], [
  snap(B, { cash: { amount: 400000, currency: 'CNY' }, sav: { amount: 200000, currency: 'CNY' } }),
  snap(day(B, 365), { cash: { amount: 400000, currency: 'CNY' }, sav: { amount: 200000, currency: 'CNY' } }),
]);
ck('no investments means nothing to compare -> hidden', app.computeEfficiency() === null);
app.renderEfficiency();
ck('and the renderer hides the panel', DOM.efficiencyPanel.hidden === true);
load([A('cash', 'cash'), A('inv', 'investment')], [
  snap(B, { cash: { amount: 400000, currency: 'CNY' }, inv: { amount: 300000, currency: 'CNY' } }),
  snap(day(B, 365), { cash: { amount: 400000, currency: 'CNY' }, inv: { amount: 240000, currency: 'CNY' } }),
]);
{
  const e = app.computeEfficiency();
  ck('a losing year reports the loss', near(e.benchmark, -0.20, 0.002), pc(e.benchmark));
  ck('and shows no gap, the alternative lost money', e.opportunity === null);
}
load([A('cash', 'cash'), A('inv', 'investment'), A('misc', 'other')], [
  snap(B, { cash: { amount: 100000, currency: 'CNY' }, inv: { amount: 100000, currency: 'CNY' }, misc: { amount: 800000, currency: 'CNY' } }),
  snap(day(B, 365), { cash: { amount: 100000, currency: 'CNY' }, inv: { amount: 110000, currency: 'CNY' }, misc: { amount: 800000, currency: 'CNY' } }),
]);
{
  const e = app.computeEfficiency();
  const assets = app.computeTimeline().slice(-1)[0].assetsTotal;
  const listed = e.idleTotal + e.working.reduce((s, w) => s + w.value, 0) + e.rest.reduce((s, w) => s + w.value, 0);
  ck('an unclassified asset gets its own group', e.rest.length === 1 && near(e.rest[0].value, 800000, 1), e.rest);
  ck('so the groups add up to total assets', near(listed, assets, 1), { listed, assets });
  ck('it is not miscounted as idle', near(e.idleTotal, 100000, 1));
  app.renderEfficiency();
  ck('rows carry an account id and are keyboard reachable',
     (DOM.efficiencyGroups.innerHTML.match(/data-acc-id="/g) || []).length === 3 &&
     (DOM.efficiencyGroups.innerHTML.match(/tabindex="0"/g) || []).length === 3);
  ck('rows with no honest rate show a dash, never a number', (DOM.efficiencyGroups.innerHTML.match(/—/g) || []).length === 2);
}
load([A('x', 'cash', { name: '<img src=x onerror=alert(1)>' }), A('inv', 'investment')], [
  snap(B, { x: { amount: 1000, currency: 'CNY' }, inv: { amount: 1000, currency: 'CNY' } }),
  snap(day(B, 365), { x: { amount: 1000, currency: 'CNY' }, inv: { amount: 1100, currency: 'CNY' } }),
]);
app.renderEfficiency();
ck('a hostile account name cannot break out of the markup',
   /&lt;img/.test(DOM.efficiencyGroups.innerHTML) && !/<img/.test(DOM.efficiencyGroups.innerHTML));

sec('Legacy whole-record inflow migration');
{
  const SA = A('sav', 'savings'), SL = LI('mort', 'other');
  const MA = A('m', 'savings', { currency: 'CNY', currencies: ['CNY', 'USD'] });
  const rec = (updates, inflow) => ({ id: 'r1', date: '2025-01-31', note: '', updates, ...(inflow ? { inflow } : {}) });
  const run = (accounts, snapshots) => app.migrate({ accounts, snapshots });
  let d = run([SA], [rec({ sav: { amount: 100, currency: 'CNY' } }, { amount: 50, currency: 'CNY', accountId: 'sav' })]);
  ck('an attributed inflow folds into its account', d.snapshots[0].updates.sav.inflow === 50);
  ck('and the legacy field is removed, so nothing counts twice', d.snapshots[0].inflow === undefined);
  d = run([SA], [rec({ sav: { amount: 100, currency: 'CNY' } }, { amount: 50, currency: 'USD', accountId: 'sav' })]);
  ck('a currency mismatch is left alone (migrate has no rates)', !!d.snapshots[0].inflow);
  d = run([SL], [rec({ mort: { amount: 100, currency: 'CNY' } }, { amount: 50, currency: 'CNY', accountId: 'mort' })]);
  ck('a liability is left alone (its sign convention differs)', !!d.snapshots[0].inflow);
  d = run([SA], [rec({ sav: { amount: 100, currency: 'CNY' } }, { amount: 50, currency: 'CNY' })]);
  ck('an unattributed inflow is left alone', !!d.snapshots[0].inflow);
  d = run([SA], [rec({}, { amount: 50, currency: 'CNY', accountId: 'sav' })]);
  ck('with no leg to attach to, left alone', !!d.snapshots[0].inflow);
  d = run([SA], [rec({ sav: { amount: 100, currency: 'CNY', inflow: 7 } }, { amount: 50, currency: 'CNY', accountId: 'sav' })]);
  ck('an existing per-account inflow is never overwritten', d.snapshots[0].updates.sav.inflow === 7);
  d = run([MA], [rec({ m: { currency: 'CNY', byCurrency: { CNY: { amount: 100 }, USD: { amount: 10 } } } }, { amount: 50, currency: 'USD', accountId: 'm' })]);
  ck('folds into the matching pocket only', d.snapshots[0].updates.m.byCurrency.USD.inflow === 50 && d.snapshots[0].updates.m.byCurrency.CNY.inflow === undefined);
  d = run([SA], [rec({ sav: { amount: 100, currency: 'CNY' } }, { amount: 50, currency: 'CNY', accountId: 'ghost' })]);
  ck('an unknown account id is left alone', !!d.snapshots[0].inflow);
  d = run([SA], [rec({ sav: { amount: 100, currency: 'CNY' } }, { amount: 'abc', currency: 'CNY', accountId: 'sav' })]);
  ck('a non-numeric amount is left alone, no crash', !!d.snapshots[0].inflow);
  const once = run([SA], [rec({ sav: { amount: 100, currency: 'CNY' } }, { amount: 50, currency: 'CNY', accountId: 'sav' })]);
  const twice = app.migrate(JSON.parse(JSON.stringify(once)));
  ck('migrating twice changes nothing', JSON.stringify(once.snapshots) === JSON.stringify(twice.snapshots));
  d = run([SA], [rec({ sav: { amount: 12345, currency: 'CNY' } }, { amount: 50, currency: 'CNY', accountId: 'sav' })]);
  ck('balances are never touched', d.snapshots[0].updates.sav.amount === 12345);
}

sec('Editing a record clears the legacy field it cannot show');
{
  // The entry form has no input for a whole-record inflow, so re-saving must drop it.
  // Keeping it meant a month could report more inflow than its entire change.
  const SA = A('b', 'savings');
  const legacy = () => app.migrate({ accounts: [SA], snapshots: [
    { id: 's1', date: '2026-09-30', note: '', updates: { b: { amount: 100000, currency: 'CNY' } } },
    { id: 's2', date: '2026-10-15', note: '', updates: { b: { amount: 120000, currency: 'CNY' } }, inflow: { amount: 20000, currency: 'CNY' } },
  ]});
  let s = legacy();
  app.state = Object.assign(s, { basis: 'net', displayCurrency: 'CNY', language: 'zh', rates: { '2026-09-30': {}, '2026-10-15': {} } });
  ck('the unattributable legacy inflow does survive migration', !!s.snapshots[1].inflow);
  // What the editing path produces now: form values replace updates, legacy field deleted.
  s.snapshots[1].updates.b.inflow = 20000;
  delete s.snapshots[1].inflow;
  app.state = s;
  const r = app.computePeriodChange('2026-10-01');
  ck('after an edit, inflow no longer exceeds the whole change', r.inflowTotal <= r.delta, { inflow: r.inflowTotal, delta: r.delta });
  ck('and the split it was blocking becomes available', r.split !== null);
  ck('reconciling as usual', near(r.split.inflow + r.split.market + r.split.untracked, r.delta));
  // Guard the source itself: the save path must delete the field.
  ck('the save path deletes snap.inflow', /delete snap\.inflow/.test(html));
  ck('and startEdit announces it first', /legacyInflowNotice/.test(html));
}

sec('The one-time inflow nudge');
{
  const only = u => { app.state = { snapshots: [snap('2025-01-31', u)], accounts: [], rates: {} }; };
  app.state = { snapshots: [], accounts: [], rates: {} };
  ck('no records -> the nudge applies', !app.hasAnyInflowData());
  only({ a: { amount: 100, currency: 'CNY' } });
  ck('balances only -> the nudge applies', !app.hasAnyInflowData());
  only({ a: { amount: 100, currency: 'CNY', inflow: 50 } });
  ck('one per-account inflow -> gone for good', app.hasAnyInflowData());
  app.state = { snapshots: [snap('2025-01-31', { a: { amount: 1, currency: 'CNY' } }, { inflow: { amount: 5, currency: 'CNY' } })], accounts: [], rates: {} };
  ck('a legacy inflow also counts as recorded', app.hasAnyInflowData());
  only({ m: { currency: 'CNY', byCurrency: { CNY: { amount: 1 }, USD: { amount: 2, inflow: 9 } } } });
  ck('an inflow in one pocket counts', app.hasAnyInflowData());
  only({ m: { currency: 'CNY', byCurrency: { CNY: { amount: 1 }, USD: { amount: 2 } } } });
  ck('multi-currency with none -> the nudge applies', !app.hasAnyInflowData());
}

sec('Transfer helper arithmetic');
{
  const BANK = A('b', 'savings');
  const INV = { id: 's', name: 'Broker', type: 'asset', category: 'investment', currency: 'USD', color: '#fbbf24' };
  const CARD = LI('c', 'creditCard');
  const MULTI = A('m', 'savings', { currency: 'CNY', currencies: ['CNY', 'USD'] });
  load([BANK, INV, CARD, MULTI], [snap('2026-10-01', {
    b: { amount: 100000, currency: 'CNY' }, s: { amount: 1000, currency: 'USD' },
    c: { amount: 5000, currency: 'CNY' },
    m: { currency: 'CNY', byCurrency: { CNY: { amount: 7000 }, USD: { amount: 500 } } },
  })], { rates: { '2026-10-01': { USD: { CNY: 7 }, CNY: { USD: 1 / 7 } } } });
  document.getElementById('date').value = '2026-10-01';
  const sf = type => (type === 'liability' ? -1 : 1);

  app.rows = [];
  app.setRowInflow('b', { code: 'CNY', value: -sf('asset') * 10000 });
  app.setRowInflow('m', { code: 'CNY', value: sf('asset') * 10000 });
  let rows = app.rows;
  const bank = rows.find(r => r.accountId === 'b'), multi = rows.find(r => r.accountId === 'm');
  ck('two rows, opposite legs', rows.length === 2 && bank.inflow === '-10000' && multi.inflows.CNY === '10000', rows);
  ck('source balance prefilled 100000 - 10000', bank.amount === '90000.00', bank.amount);
  ck('destination pocket prefilled 7000 + 10000', multi.amounts.CNY === '17000.00', multi.amounts);
  ck('the account\'s other pocket is untouched', !multi.amounts.USD, multi.amounts.USD);

  app.rows = [{ rowId: 'r1', accountId: 'b', amount: '', currency: 'CNY', inflow: '' }, { rowId: 'r2', accountId: '', amount: '', currency: 'CNY', inflow: '' }];
  app.setRowInflow('b', { code: 'CNY', value: -5000 });
  ck('an existing row for that account is reused', app.rows.filter(r => r.accountId === 'b').length === 1 && app.rows.length === 2, app.rows.map(r => r.accountId));

  const leg = app.transferLegFor(INV, 7000, 'CNY', '2026-10-01');
  ck('7000 CNY converts to 1000 USD for a USD account', leg.code === 'USD' && near(leg.amount, 1000), leg);
  // A converted leg must be rounded to its own currency, or the inflow written into the
  // form carries sixteen digits while the balance beside it is rounded to the cent.
  const odd = app.transferLegFor(INV, 26203, 'CNY', '2026-10-01');
  ck('a converted leg is rounded to the currency\'s precision',
     Number.isInteger(odd.amount * 100) && String(odd.amount).length <= 10, odd.amount);
  const jpy = app.transferLegFor({ id: 'j', name: 'J', type: 'asset', category: 'savings', currency: 'JPY' }, 1, 'JPY', '2026-10-01');
  ck('a same-currency leg is passed through untouched', jpy.amount === 1, jpy);
  app.rows = [];
  app.setRowInflow('s', { code: leg.code, value: sf('asset') * leg.amount });
  const brk = app.rows.find(r => r.accountId === 's');
  ck('the row stays in the account\'s own currency', brk.currency === 'USD' && brk.amount === '2000.00', brk);

  app.rows = [];
  app.setRowInflow('c', { code: 'CNY', value: sf('liability') * 3000 });
  const card = app.rows.find(r => r.accountId === 'c');
  ck('paying a card down writes a negative inflow and lowers what is owed',
     card.inflow === '-3000' && card.amount === '2000.00', card);
  const netEffect = (f, to, a) => (-sf(f) * a) * sf(f) + (sf(to) * a) * sf(to);
  ck('every transfer pair nets to zero net worth',
     [['asset', 'asset'], ['asset', 'liability'], ['liability', 'asset']].every(([f, to]) => netEffect(f, to, 10000) === 0));
}

sec('Several records sharing one date');
{
  const accs = [A('b', 'savings'), A('s', 'investment')];
  const single = [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 300000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 110000, currency: 'CNY', inflow: 10000 }, s: { amount: 320000, currency: 'CNY' } }),
  ];
  load(accs, single);
  const a = app.computePeriodChange('2026-10-01');
  load(accs, [single[0], single[1], snap('2026-10-15', { b: { amount: 110000, currency: 'CNY' }, s: { amount: 320000, currency: 'CNY' } })]);
  const b = app.computePeriodChange('2026-10-01');
  ck('a same-date correction changes no bucket',
     near(a.delta, b.delta) && near(a.split.inflow, b.split.inflow) && near(a.split.market, b.split.market) && near(a.split.untracked, b.split.untracked),
     { one: a.split, two: b.split });
}

sec('Demo data exercises both features');
{
  app.state = { language: 'zh', displayCurrency: 'CNY', basis: 'net', rates: {}, accounts: [], snapshots: [] };
  const { accounts, snapshots } = app.buildDemoData();
  load(accounts, snapshots, { rates: Object.fromEntries(snapshots.map(s => [s.date, { USD: { CNY: 7.1 }, CNY: { USD: 1 / 7.1 } }])) });
  ck('it writes no legacy whole-record inflow', snapshots.every(s => !s.inflow));
  ck('savings carries a per-account inflow throughout', snapshots.every(s => s.updates[accounts[0].id].inflow > 0));
  const after = d => new Date(new Date(d).getTime() + 86400000).toISOString().slice(0, 10);
  const r = app.computePeriodChange(after(snapshots[0].date));
  ck('the three-way split is available', !!r.split);
  ck('all three buckets are non-trivial', Math.abs(r.split.inflow) > 1 && Math.abs(r.split.market) > 1 && Math.abs(r.split.untracked) > 1, r.split);
  ck('and reconciles', near(r.split.inflow + r.split.market + r.split.untracked, r.delta, Math.max(1, Math.abs(r.delta) * 1e-6)));
  const e = app.computeEfficiency();
  ck('the efficiency panel appears', !!e);
  ck('with a believable return, not a boast', e.benchmark > 0 && e.benchmark < 0.25, pc(e.benchmark));
  ck('the demo mortgage is a mortgage', accounts[4].category === 'mortgage');
  ck('and its instalments show interest', r.split.interest < -1000 && r.split.interest > r.split.untracked, r.split);
  ck('the mortgage amortizes across the window',
     snapshots[0].updates[accounts[4].id].amount > snapshots[13].updates[accounts[4].id].amount);
  // The tagged-spending feature has to be visible in the demo, and visible the right
  // way: nested inside a negative "Unrecorded" with a small untagged rest, not under
  // the over-tagged warning (which a demo must never open with).
  const tagged = snapshots.filter(s => s.expenses);
  ck('the last two months carry tagged spending', snapshots[12].expenses && snapshots[13].expenses, tagged.map(s => s.date));
  // The monthly chart is the demo's spending story: every month readable, none below
  // zero (a negative month would open the demo on the "income not entered" caveat),
  // and a believable household figure rather than noise.
  const today = snapshots[13].date;
  const months = app.monthlySpending(12, today);
  ck('every demo month has a spending figure', months.every(m => m.spend != null), months.filter(m => m.spend == null).map(m => m.month));
  ck('no demo month is negative', months.every(m => m.spend > 0), months.map(m => Math.round(m.spend)));
  const avg = months.reduce((a, m) => a + m.spend, 0) / months.length;
  ck('average monthly spending is a household figure', avg > 3000 && avg < 10000, Math.round(avg));
  ck('tags never exceed their month', months.every(m => m.tagged <= m.spend + 0.01));
  const sr = app.savingsRate(months);
  ck('the demo saves a believable share', sr && sr.rate > 0.2 && sr.rate < 0.8, sr && pc(sr.rate));
  for (const [name, from] of [['this month', after(snapshots[12].date)], ['the last two months', after(snapshots[11].date)]]) {
    const m = app.computePeriodChange(from);
    const html = app.renderSplitChips(m);
    ck(`${name}: unrecorded is spending, and covers what is tagged`,
       m.split.untracked < 0 && m.split.untracked + m.expenses.total < 0, [m.split.untracked, m.expenses.total]);
    ck(`${name}: tags nest with a rest and no warning`, /其余/.test(strip(html)) && !/split-warn/.test(html), strip(html));
  }
  ck('mortgage repayments are recorded as inflow, not left unexplained',
     snapshots.slice(1).every(s => s.updates[accounts[4].id].inflow < 0));
}

sec('Chart palette resolves per theme');
{
  const dark = s => { BODY_CLASSES.delete('light'); return s(); };
  const light = s => { BODY_CLASSES.add('light'); return s(); };
  // A colour stored years ago still resolves to this theme's step for the same slot.
  ck('a legacy account colour keeps its slot in dark', dark(() => app.adaptColor('#4ade80')) === '#008300', dark(() => app.adaptColor('#4ade80')));
  ck('and takes the light step on the light surface', light(() => app.adaptColor('#4ade80')) === '#008300', light(() => app.adaptColor('#4ade80')));
  ck('a blue account differs between themes',
     dark(() => app.adaptColor('#60a5fa')) !== light(() => app.adaptColor('#60a5fa')),
     [dark(() => app.adaptColor('#60a5fa')), light(() => app.adaptColor('#60a5fa'))]);
  ck('a hand-edited colour is passed through untouched', dark(() => app.adaptColor('#123456')) === '#123456');
  // Categories and currencies follow the same slots.
  ck('cash and crypto are no longer the same hue family',
     dark(() => app.CATEGORY_COLORS.cash) !== dark(() => app.CATEGORY_COLORS.crypto));
  ck('investment and loan no longer share a yellow',
     dark(() => app.CATEGORY_COLORS.investment) !== dark(() => app.CATEGORY_COLORS.loan),
     [dark(() => app.CATEGORY_COLORS.investment), dark(() => app.CATEGORY_COLORS.loan)]);
  ck('category colours change with the theme',
     dark(() => app.CATEGORY_COLORS.investment) !== light(() => app.CATEGORY_COLORS.investment));
  ck('"other" stays a deliberate neutral, not a hue',
     dark(() => app.CATEGORY_COLORS.other) === '#8590a8' && light(() => app.CATEGORY_COLORS.other) === '#6b7280');
  // Past the eight slots a currency folds into the neutral rather than inventing a hue.
  ck('the first eight currencies each get their own slot',
     new Set(['CNY','USD','JPY','EUR','GBP','HKD','SGD','TWD'].map(c => dark(() => app.CURRENCY_COLORS[c]))).size === 8);
  ck('a ninth currency folds into the neutral',
     dark(() => app.CURRENCY_COLORS.KRW) === dark(() => app.CATEGORY_COLORS.other));
  // Every colour the app hands out must be recognised, or a theme switch would strand it
  // on its dark step. Green is deliberately the same in both modes, so it is exempt from
  // the "must change" half of the check.
  const slotted = hex => {
    const d = dark(() => app.adaptColor(hex)), l = light(() => app.adaptColor(hex));
    return d === hex && (l !== hex || hex === '#008300');
  };
  ck('every palette entry maps back to a slot', app.PALETTE.every(slotted),
     app.PALETTE.filter(h => !slotted(h)));
  ck('and so does every colour older versions handed out',
     ['#4ade80','#60a5fa','#f472b6','#fbbf24','#a78bfa','#fb7185','#34d399','#fb923c','#22d3ee','#facc15']
       .every(h => app.adaptColor(h) !== h));
}

sec('Tagged spending explains the unrecorded bucket');
{
  // Salary recorded as inflow, so the bank's residual is what was spent: 20,000 in,
  // balance up 7,000 -> 13,000 went out. Two of those items are tagged.
  const mk = expenses => load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 107000, currency: 'CNY', inflow: 20000 } }, expenses ? { expenses } : {}),
  ]);
  mk(null);
  const bare = app.computePeriodChange('2026-10-01');
  mk([{ label: '房租', amount: 8000, currency: 'CNY' }, { label: '旅行', amount: 500, currency: 'USD' }]);
  const r = app.computePeriodChange('2026-10-01');
  ck('tags never move the split', JSON.stringify(r.split) === JSON.stringify(bare.split), [r.split, bare.split]);
  ck('tagged total is converted at the record date', near(r.expenses.total, 8000 + 3500), r.expenses);
  ck('items are grouped and largest first', r.expenses.items[0].label === '房租' && near(r.expenses.items[1].amount, 3500));
  const html = strip(app.renderSplitChips(r));
  ck('the unrecorded chip lists the tags and the rest', /未记账 −¥13,000/.test(html) && /房租 −¥8,000/.test(html) && /其余 −¥1,500/.test(html), html);
  ck('no over-tag warning when the tags fit', !/工资/.test(html), html);

  // Same label in two records sums into one item.
  load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-05', { b: { amount: 95000, currency: 'CNY' } }, { expenses: [{ label: '房租', amount: 4000, currency: 'CNY' }] }),
    snap('2026-10-20', { b: { amount: 90000, currency: 'CNY' } }, { expenses: [{ label: '房租', amount: 4000, currency: 'CNY' }] }),
  ]);
  const two = app.computePeriodChange('2026-10-01').expenses;
  ck('one label across two records is one item', two.items.length === 1 && near(two.items[0].amount, 8000), two);
  ck('a record before the window is not counted', near(app.computePeriodChange('2026-10-10').expenses.total, 4000));
}
{
  // Salary NOT recorded as inflow: balance up, yet 8,000 is tagged. The rest comes out
  // positive, and that has to be explained rather than shown as a mystery refund.
  load([A('b', 'savings'), A('s', 'investment')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 50000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 104000, currency: 'CNY' }, s: { amount: 60000, currency: 'CNY', inflow: 10000 } },
      { expenses: [{ label: '房租', amount: 8000, currency: 'CNY' }] }),
  ]);
  const html = app.renderSplitChips(app.computePeriodChange('2026-10-01'));
  ck('over-tagging shows a positive rest', /其余 \+¥12,000/.test(strip(html)), strip(html));
  ck('and says why', /split-warn/.test(html) && /工资/.test(html), strip(html));
}
{
  // No inflow anywhere: the split stays silent, but the tags still show on their own.
  load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 90000, currency: 'CNY' } }, { expenses: [{ label: '房租', amount: 8000, currency: 'CNY' }] }),
  ]);
  const html = strip(app.renderSplitChips(app.computePeriodChange('2026-10-01')));
  ck('tags show without an inflow split', /支出 −¥8,000/.test(html) && !/未记账/.test(html) && !/其余/.test(html), html);
  ck('a drilldown never shows record-level tags',
     !/房租/.test(app.renderSplitChips(app.computePeriodChange('2026-10-01'), 'untracked')));
}
{
  // An item in a currency with no rate for its date: show no tags rather than a short sum.
  load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 107000, currency: 'CNY', inflow: 20000 } },
      { expenses: [{ label: 'x', amount: 10, currency: 'EUR' }, { label: '房租', amount: 8000, currency: 'CNY' }] }),
  ]);
  const r = app.computePeriodChange('2026-10-01');
  ck('an unconvertible item is flagged', r.expenses.missed);
  ck('and suppresses the tag breakdown', !/房租/.test(app.renderSplitChips(r)));
}
{
  // More than three labels fold into "N more"; HTML in a label is escaped.
  load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 80000, currency: 'CNY', inflow: 1 } }, { expenses: [
      { label: 'a', amount: 4000, currency: 'CNY' }, { label: 'b', amount: 3000, currency: 'CNY' },
      { label: 'c', amount: 2000, currency: 'CNY' }, { label: 'd', amount: 1000, currency: 'CNY' },
      { label: '<img>', amount: 500, currency: 'CNY' },
    ] }),
  ]);
  const html = app.renderSplitChips(app.computePeriodChange('2026-10-01'));
  ck('labels past the third fold into one item', /另 2 项 −¥1,500/.test(strip(html)), strip(html));
  ck('a label is never raw HTML', !/<img>/.test(html));
}
{
  // Total-assets basis: a card-paid bill never reaches the asset residual, so no "rest".
  load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-15', { b: { amount: 107000, currency: 'CNY', inflow: 20000 } }, { expenses: [{ label: '房租', amount: 8000, currency: 'CNY' }] }),
  ], { basis: 'assets' });
  const html = strip(app.renderSplitChips(app.computePeriodChange('2026-10-01')));
  app.state.basis = undefined;  // a fresh state before migrate() has filled it in
  ck('an unset basis counts as net worth', /其余/.test(strip(app.renderSplitChips(app.computePeriodChange('2026-10-01')))));
  app.state.basis = 'assets';
  ck('on total assets the tags stand alone', /未记账 −¥13,000/.test(html) && /支出 −¥8,000/.test(html) && !/其余/.test(html), html);
}

sec('Searching a tag totals it');
load([A('b', 'savings')], [
  snap('2026-08-31', { b: { amount: 1, currency: 'CNY' } }, { expenses: [{ label: '房租', amount: 8000, currency: 'CNY' }, { label: 'Trip', amount: 100, currency: 'USD' }] }),
  snap('2026-09-30', { b: { amount: 1, currency: 'CNY' } }, { expenses: [{ label: '房租 九月', amount: 8000, currency: 'CNY' }] }),
]);
{
  const r = app.expenseSearchTotal('房租');
  ck('every matching item across records is summed', r.count === 2 && near(r.total, 16000) && !r.missed, r);
  ck('matching ignores case (query arrives lower-cased)', near(app.expenseSearchTotal('trip').total, 700));
  ck('an empty query matches nothing', app.expenseSearchTotal('').count === 0);
  app.state.rates = {};
  ck('a missing rate is flagged, not summed short', app.expenseSearchTotal('trip').missed);
}

sec('Monthly spending');
{
  // Salary recorded every month; the bank's residual is spending.
  load([A('b', 'savings'), A('s', 'investment')], [
    snap('2026-07-31', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 50000, currency: 'CNY' } }),
    snap('2026-08-31', { b: { amount: 105000, currency: 'CNY', inflow: 10000 }, s: { amount: 55000, currency: 'CNY' } }),
    // September: no record at all.
    snap('2026-10-15', { b: { amount: 104000, currency: 'CNY', inflow: 10000 } },
      { expenses: [{ label: '房租', amount: 8000, currency: 'CNY' }] }),
    snap('2026-10-31', { b: { amount: 110000, currency: 'CNY', inflow: 10000 } }),
    // November: a record, but no inflow in it.
    snap('2026-11-03', { b: { amount: 108000, currency: 'CNY' } }),
  ]);
  const rows = app.monthlySpending(5, '2026-11-04');
  const by = Object.fromEntries(rows.map(r => [r.month, r]));
  ck('one row per month, oldest first, ending this month',
     rows.map(r => r.month).join() === '2026-07,2026-08,2026-09,2026-10,2026-11', rows.map(r => r.month));
  ck('a month with no earlier record is blank', by['2026-07'].spend === null);
  ck('spending is the bank residual, positive', near(by['2026-08'].spend, 5000), by['2026-08']);
  ck('a market move is not spending', near(by['2026-08'].spend, 5000));
  ck('a month with no record is blank, not zero', by['2026-09'].spend === null);
  // Oct: 105,000 -> 110,000 on the bank with 20,000 in = 15,000 out. The investment
  // account was not updated, so it moved nothing.
  ck('two records in a month add up', near(by['2026-10'].spend, 15000), by['2026-10']);
  ck('and the bar says it reaches back past a gap', by['2026-10'].since === '2026-08-31');
  ck('tagged spending is the month\'s own', near(by['2026-10'].tagged, 8000) && by['2026-10'].taggedKnown);
  ck('a month without inflow is blank, not "all of it was spending"', by['2026-11'].spend === null);
  // Reconciles with the MTD/YTD figure for the same window.
  const oct = app.computePeriodChange('2026-10-01');  // runs to the newest record (Nov 3)
  ck('the existing to-now window is unchanged by the end-date parameter', !!oct.split && near(oct.split.untracked, -17000), oct.split);
}

sec('Savings rate');
{
  load([A('b', 'savings')], [
    snap('2026-08-31', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-09-30', { b: { amount: 108000, currency: 'CNY', inflow: 12000 } }),   // kept 8,000 of 12,000
    snap('2026-10-31', { b: { amount: 112000, currency: 'CNY', inflow: 10000 } }),   // kept 4,000 of 10,000
  ]);
  const rows = app.monthlySpending(2, '2026-10-31');
  ck('a month\'s income is its recorded inflow', near(rows[0].income, 12000) && near(rows[1].income, 10000), rows);
  const sr = app.savingsRate(rows);
  ck('the rate is summed over months, not averaged', near(sr.rate, 12000 / 22000, 1e-9), sr);
  ck('and counts its months', sr.months === 2);
}
{
  // A brokerage account first recorded in October brings 50,000 with it. That is money
  // moved, not income: counted as income it would turn a 60% month into 93%.
  load([A('b', 'savings'), A('s', 'investment')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-31', { b: { amount: 106000, currency: 'CNY', inflow: 10000 }, s: { amount: 50000, currency: 'CNY' } }),
  ]);
  const [r] = app.monthlySpending(1, '2026-10-31');
  ck('a new account\'s opening balance is not income', near(r.income, 10000), r);
  ck('nor spending', near(r.spend, 4000), r);
  ck('so the rate stays 60%', near(app.savingsRate([r]).rate, 0.6, 1e-9));
}
{
  // Money only taken out: there is no income to take a share of.
  load([A('b', 'savings')], [
    snap('2026-09-30', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-10-31', { b: { amount: 90000, currency: 'CNY', inflow: -5000 } }),
  ]);
  ck('no rate when income is not positive', app.savingsRate(app.monthlySpending(1, '2026-10-31')) === null);
  ck('no rate with no qualifying month', app.savingsRate([{ spend: null, income: null }]) === null);
}

sec('Months that need inflow');
{
  load([A('b', 'savings'), A('s', 'investment')], [
    snap('2026-08-31', { b: { amount: 100000, currency: 'CNY' }, s: { amount: 50000, currency: 'CNY' } }),
    // September: only a transfer between own accounts. Salary went in but wasn't entered.
    snap('2026-09-30', { b: { amount: 102000, currency: 'CNY', inflow: -5000 }, s: { amount: 55000, currency: 'CNY', inflow: 5000 } }, { id: 'sep' }),
    snap('2026-10-31', { b: { amount: 110000, currency: 'CNY', inflow: 12000 } }, { id: 'oct' }),
  ]);
  const [sep, oct] = app.monthlySpending(2, '2026-10-31');
  ck('a transfer-only month is blank, not negative spending', sep.spend === null && sep.gap === 'noInflow', sep);
  ck('a month with salary entered reads normally', near(oct.spend, 4000) && oct.gap === null, oct);
  ck('a transfer does not count as the month having income', !app.monthHasIncome('2026-09-15'));
  ck('salary does', app.monthHasIncome('2026-10-02'));
  ck('the record being edited does not count for itself', !app.monthHasIncome('2026-10-02', 'oct'));

  app.rows = [{ accountId: 'b', amount: '1', currency: 'CNY', inflow: '' }];
  ck('an empty inflow box is no inflow', !app.formHasInflow());
  app.rows = [{ accountId: 'b', amount: '1', currency: 'CNY', inflow: '0' }];
  ck('nor is a zero', !app.formHasInflow());
  app.rows = [{ accountId: 'b', amount: '1', currency: 'CNY', inflow: '12000' }];
  ck('a typed inflow counts', app.formHasInflow());
  app.rows = [{ accountId: 'w', currency: 'USD', amounts: { USD: '1' }, inflows: { USD: '', EUR: '300' } }];
  ck('so does one in a multi-currency pocket', app.formHasInflow());
  app.rows = [{ accountId: '', amount: '', currency: 'CNY', inflow: '500' }];
  ck('a row with no account chosen does not', !app.formHasInflow());
  app.rows = [];
}

sec('Copy last month\'s inflow');
{
  load([A('b', 'savings'), A('m', 'savings', { type: 'liability', category: 'mortgage' }), A('w', 'savings', { currency: 'CNY', currencies: ['CNY', 'USD'] })], [
    snap('2026-08-31', { b: { amount: 100000, currency: 'CNY' }, m: { amount: 500000, currency: 'CNY' } }),
    snap('2026-09-10', { b: { amount: 120000, currency: 'CNY', inflow: 20000 } }),
    snap('2026-09-25', { b: { amount: 121000, currency: 'CNY', inflow: 1000 }, m: { amount: 495000, currency: 'CNY', inflow: -5000 },
      w: { currency: 'CNY', byCurrency: { USD: { amount: 300, inflow: 300 } } } }),
  ]);
  const p = app.previousMonthInflows('2026-10-31');
  ck('takes the latest earlier month', p && p.month === '2026-09', p);
  const get = (id, c) => p.items.find(i => i.accId === id && i.code === c);
  ck('sums the month per account', get('b', 'CNY').value === 21000, p.items);
  ck('keeps a repayment negative', get('m', 'CNY').value === -5000);
  ck('keeps a pocket in its own currency', get('w', 'USD').value === 300);
  ck('largest first', p.items[0].accId === 'b');
  ck('nothing before the first inflow month', app.previousMonthInflows('2026-09-05') === null);
  ck('the current month is not "last month"', app.previousMonthInflows('2026-09-30') === null);

  app.rows = [{ rowId: 'r0', accountId: 'm', amount: '494000', currency: 'CNY', inflow: '' }];
  app.applyInflowCopy(p.items);
  const row = id => app.rows.find(r => r.accountId === id);
  ck('fills an account not yet in the form, with its balance', row('b').inflow === '21000' && row('b').amount === '142000.00', row('b'));
  ck('a balance typed by hand is kept', row('m').inflow === '-5000' && row('m').amount === '494000', row('m'));
  ck('a multi-currency pocket gets its own', row('w').inflows.USD === '300' && row('w').amounts.USD === '600.00', row('w'));
  ck('and the reminder would now see inflow', app.formHasInflow());

  app.rows = [{ rowId: 'r1', accountId: 'b', amount: '', currency: 'CNY', inflow: '18000' }];
  app.applyInflowCopy(p.items);
  ck('an inflow already typed is not replaced', row('b').inflow === '18000');
  app.rows = [];
}
{
  load([A('b', 'savings'), A('x', 'savings')], [
    snap('2026-09-25', { b: { amount: 1, currency: 'CNY', inflow: 100 }, x: { amount: 1, currency: 'CNY', inflow: 100 } }),
  ]);
  app.state.accounts = app.state.accounts.filter(a => a.id !== 'x');
  const p = app.previousMonthInflows('2026-10-31');
  ck('a deleted account is skipped', p.items.length === 1 && p.items[0].accId === 'b', p);
}

sec('Spending table');
{
  const rows = [
    { month: '2026-08', spend: null, gap: 'noRecord', span: 1 },
    { month: '2026-09', spend: null, gap: 'noInflow', span: 1 },
    { month: '2026-10', spend: 8000, income: 20000, tagged: 5000, taggedKnown: false, span: 2, since: '2026-08-31' },
  ];
  app.state.language = 'zh'; app.state.displayCurrency = 'CNY';
  app.renderSpendingTable(rows, true);
  const html = document.getElementById('spendingTable').innerHTML;
  const trs = html.split('<tr>').slice(2);
  ck('newest month first', trs[0].startsWith('<td>2026-10'), trs);
  ck('shows spending, tagged, income and the rate', ['¥8,000<', '¥5,000', '¥20,000', '60%'].every(x => trs[0].includes(x)), trs[0]);
  ck('a month spanning two says so', trs[0].includes('2 个月'));
  ck('a tag missing a rate is flagged', trs[0].includes('*'));
  ck('a blank month says why, not zero', trs[1].includes('没填入金') && trs[2].includes('没有记录') && !trs[1].includes('¥'));
  app.renderSpendingTable(rows, false);
  ck('no tagged column without tags', !document.getElementById('spendingTable').innerHTML.includes('已标注'));
}

sec('Review fixes');
{
  // A bar measured across a missing month holds two months: the average must say so.
  load([A('b', 'savings')], [
    snap('2026-07-31', { b: { amount: 100000, currency: 'CNY' } }),
    snap('2026-08-31', { b: { amount: 106000, currency: 'CNY', inflow: 10000 } }),   // 4,000 spent
    // September: no record.
    snap('2026-10-31', { b: { amount: 118000, currency: 'CNY', inflow: 20000 } }),   // 8,000 over two months
  ]);
  const rows = app.monthlySpending(3, '2026-10-31');
  const oct = rows[2];
  ck('a bar across a gap knows how many months it spans', oct.span === 2 && rows[0].span === 1, rows.map(r => r.span));
  const known = rows.filter(r => r.spend != null);
  const avg = known.reduce((a, r) => a + r.spend, 0) / known.reduce((a, r) => a + r.span, 0);
  ck('so the monthly average is 4,000, not 6,000', near(avg, 4000), avg);
  ck('and the savings rate counts three months', app.savingsRate(rows).months === 3);
}
{
  // Salary entered in USD on a date whose rates haven't loaded: the reminder must not
  // tell the user to enter what they already did.
  load([A('u', 'savings', { currency: 'USD' })], [
    snap('2026-10-25', { u: { amount: 5000, currency: 'USD', inflow: 3000 } }),
  ], { rates: {} });
  ck('an inflow without a rate yet still counts as income entered', app.monthHasIncome('2026-10-31'));
  load([A('b', 'savings')], [snap('2026-10-25', { b: { amount: 5000, currency: 'CNY', inflow: 0.001 } })]);
  ck('a negligible inflow does not, matching the chart', !app.monthHasIncome('2026-10-31'));
}
{
  const r = (label, amount, extra) => Object.assign({ rowId: 'x', label, amount, currency: 'CNY' }, extra || {});
  app.state.displayCurrency = 'CNY';
  app.expenseRows = [r('', ''), r('房租', '8000')];
  let c = app.collectExpenses();
  ck('an untouched row is ignored, a filled one kept', c.bad.length === 0 && c.list.length === 1 && c.list[0].amount === 8000, c);
  app.expenseRows = [r('房租', '')];
  ck('a named item with no amount is refused, not dropped', app.collectExpenses().bad.length === 1);
  app.expenseRows = [r('房租', '', { badInput: true })];
  ck('text the number field could not parse ("8,000") is refused', app.collectExpenses().bad.length === 1);
  app.expenseRows = [r('', '', { badInput: true })];
  ck('even without a label', app.collectExpenses().bad.length === 1);
  app.expenseRows = [r('x', '1e999')];
  ck('an infinite amount is refused', app.collectExpenses().bad.length === 1);
  app.expenseRows = [r('x', '0')];
  ck('zero is refused', app.collectExpenses().bad.length === 1);
  app.expenseRows = [];
}

sec('Tagged spending survives import');
{
  const data = { accounts: [A('b', 'savings')], snapshots: [
    snap('2026-10-01', { b: { amount: 1, currency: 'CNY' } }, { expenses: [
      { label: '  房租  ', amount: '8000', currency: 'CNY' },
      { label: 'neg', amount: -5, currency: 'CNY' },
      { label: 'zero', amount: 0, currency: 'CNY' },
      { label: 'nan', amount: 'abc', currency: 'CNY' },
      { label: 'cur', amount: 5, currency: 'XXX' },
      null,
      { amount: 3, currency: 'USD' },
      { label: 'x'.repeat(100), amount: 1, currency: 'CNY' },
    ] }),
    snap('2026-10-02', { b: { amount: 1, currency: 'CNY' } }, { expenses: [{ amount: -1, currency: 'CNY' }] }),
    snap('2026-10-03', { b: { amount: 1, currency: 'CNY' } }, { expenses: 'garbage' }),
  ] };
  const out = app.migrate(data);
  const ex = out.snapshots[0].expenses;
  ck('valid items are kept, invalid ones dropped', ex.length === 3, ex);
  ck('labels are trimmed and amounts made numeric', ex[0].label === '房租' && ex[0].amount === 8000, ex[0]);
  ck('a missing label becomes empty', ex[1].label === '' && ex[1].currency === 'USD', ex[1]);
  ck('an overlong label is capped', ex[2].label.length === 40);
  ck('a list with nothing valid is removed', !('expenses' in out.snapshots[1]) && !('expenses' in out.snapshots[2]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
