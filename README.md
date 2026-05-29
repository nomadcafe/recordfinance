# Record · Finance

**English** · [中文](README.zh.md) · [日本語](README.ja.md)

Private, offline-first multi-currency net worth tracker.
Your data never leaves your device.

**Live:** https://record.finance

---

## Features

- **Multi-currency** — CNY, USD, JPY, EUR, SGD, HKD with automatic exchange rates
- **Asset / liability accounts** with categories (cash, savings, investment, property, crypto, other)
- **Net worth or total assets** — switch the entire app's basis with one toggle
- **Goal tracking** with ETA estimation and milestone celebrations
- **Charts** — balance trend, year-over-year, account drilldown, currency / category breakdown
- **MTD / YTD / inflow vs market gain** decomposition
- **Local file sync** via the File System Access API — point it at any cloud-synced folder (iCloud Drive, Dropbox, OneDrive); auto-syncs on change
- **Rolling local snapshots** (last 20 changes) for undo-safety
- **PIN lock** with session unlock, privacy blur with press-and-hold to peek
- **PWA** — install to home screen, works offline (Service Worker)
- **i18n** — English / 中文 / 日本語
- **Light / dark theme**, fiscal year start configuration

## Tech

Pure static site. No build step, no framework.

- HTML / CSS / vanilla JS in a single `index.html`
- [Chart.js](https://www.chartjs.org/) via jsDelivr CDN
- [`@fawazahmed0/currency-api`](https://github.com/fawazahmed0/exchange-api) via jsDelivr CDN (free, no API key)
- File System Access API + IndexedDB for sync handle persistence
- Service Worker for offline + asset caching
- Web Crypto API (SHA-256) for PIN hashing

## Privacy

- **No backend.** No server stores your data.
- **No analytics, no tracking, no cookies.**
- **No account / signup.** Open the page, start using.
- **Open source.** Every line is in this repo — audit anything.
- All data lives in your browser's LocalStorage and IndexedDB.
- Optional sync writes a single JSON file to a location you choose.
- Exchange rate API receives only the date you request — no PII.
