# Record · Finance

**English** · [中文](README.zh.md) · [日本語](README.ja.md)

Private, offline-first multi-currency net worth tracker.
Your data never leaves your device.

**Live:** https://record.finance

---

## Features

- **Multi-currency** — CNY, USD, JPY, EUR, GBP, HKD, SGD, TWD, KRW, AUD, CAD, CHF, INR, THB, MYR with automatic exchange rates
- **Asset / liability accounts** with categories (cash, savings, investment, property, crypto, other)
- **Net worth or total assets** — switch the entire app's basis with one toggle
- **Goal tracking** with ETA estimation and milestone celebrations
- **Charts** — balance trend, year-over-year, account drilldown, currency / category breakdown
- **MTD / YTD decomposition** — splits a period's change into inflow, market move and unrecorded spending, per portfolio and per account. An investment account revalues on its own, a bank account doesn't, so the residual is labelled for what it actually is
- **Capital efficiency** — how much is sitting in cash and savings, what your own investment accounts actually returned (Modified Dietz, so mid-period deposits are time-weighted), and the gap between the two — and, when a loan has an implied rate, that rate beside it, with the interest a year your idle money would stop paying if it went to the debt. No rate feed and no product suggestions: the benchmark is your own realized return
- **Tagged large expenses** — note a few big outflows (rent, a trip…) when you record, and the MTD/YTD "Unrecorded" figure breaks down into "rent −8,000 · trip −5,000 · rest −2,000". Annotation only: no balance math depends on it, so there is no ledger to keep
- **Monthly spending** — what each of the last 12 months spent (the part of the balance change that is neither inflow nor market), with tagged expenses shaded separately. Computed only for months with recorded inflow; a month it can't read stays blank rather than guessed. Also gives a savings rate, taking income to be the inflow you entered, so there is nothing extra to fill in
- **Transfers between your own accounts** — one dialog writes both inflow legs, so moving money never shows up as spending on one side and a gain on the other
- **Debt** — total owed, debt ratio, and per loan the monthly principal paydown, the interest rate your records imply, and when it would be paid off at that pace. Mortgage and loan interest shows up by name inside "Unrecorded" and in monthly spending, worked out from the balances you already enter — no contract rate asked for
- **Accounts gone quiet** — an account not updated for longer than its own usual rhythm (1.5× its median gap, at least 45 days) is marked on its card, and the entry form offers to add all of them in one click; the headline says how many days old the latest record is
- **Local file sync** via the File System Access API — point it at any cloud-synced folder (iCloud Drive, Dropbox, OneDrive); auto-syncs on change, with lossless merge so edits from multiple devices never clobber each other
- **Rolling local snapshots** (last 20 changes) for undo-safety
- **Passphrase encryption** at rest (AES-GCM) — covers localStorage, local backups, and the sync file; privacy blur with press-and-hold to peek
- **PWA** — install to home screen, works offline (Service Worker)
- **i18n** — English / 中文 / 日本語
- **Light / dark theme**, fiscal year start configuration

## Tech

Pure static site. No build step, no framework.

- HTML / CSS / vanilla JS in `index.html` (translations split into `i18n.js`)
- [Chart.js](https://www.chartjs.org/) via jsDelivr CDN
- [`@fawazahmed0/currency-api`](https://github.com/fawazahmed0/exchange-api) via jsDelivr CDN (free, no API key)
- File System Access API + IndexedDB for sync handle persistence
- Service Worker for offline + asset caching
- Web Crypto API (PBKDF2 + AES-GCM) for optional at-rest encryption
- `node test.js` runs the regression tests for the money math — how a balance change is attributed, realized return with cash flows, the data migration. No dependencies and no build step: it reads the functions straight out of `index.html`
- `node e2e.js` (optional) clicks through the page in a real Chrome — form clearing, phone width, privacy blur, all three languages. It needs Chrome installed and `npm i --no-save playwright-core`, so it stays out of the zero-dependency `test.js`

## Privacy

- **No backend.** No server stores your data.
- **No analytics, no tracking, no cookies.**
- **No account / signup.** Open the page, start using.
- **Open source.** Every line is in this repo — audit anything.
- All data lives in your browser's LocalStorage and IndexedDB.
- Optional sync writes a single JSON file to a location you choose.
- Exchange rate API receives only the date you request — no PII.
