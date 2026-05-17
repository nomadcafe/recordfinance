# Record · Finance

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
- All data lives in your browser's LocalStorage and IndexedDB.
- Optional sync writes a single JSON file to a location you choose.
- Exchange rate API receives only the date you request — no PII.

## Develop locally

Just serve the directory over HTTP — no build required.

```bash
git clone https://github.com/nomadcafe/recordfinance.git
cd recordfinance
python3 -m http.server 8000
# open http://localhost:8000
```

> Opening `index.html` directly via `file://` works for most features but
> the manifest, Service Worker, and File System Access API need `http(s)://`.

## Deploy

Drop the directory on any static host. Recommended: **Cloudflare Pages**
(free, unlimited bandwidth, global CDN).

1. Push to GitHub
2. [pages.cloudflare.com](https://pages.cloudflare.com) → Connect Git → select repo
3. Build settings: empty (this is pure static)
4. Add custom domain (e.g. `record.finance`)

Vercel / Netlify / GitHub Pages / S3+CloudFront all work too.

## Browser support

| Browser            | Core | PWA install | File sync (FSA) |
|--------------------|:----:|:-----------:|:---------------:|
| Chrome / Edge      |  ✅  |     ✅      |       ✅        |
| Safari (macOS)     |  ✅  |     ✅      |   Read-only     |
| Firefox            |  ✅  |     ⚠️      |       ❌        |
| Safari (iOS)       |  ✅  |     ✅      |       ❌        |

On browsers without File System Access API, use the manual Export / Import
buttons with a file in your cloud-synced folder.

## Project layout

```
record-finance/
├── index.html        Main app (HTML + CSS + JS)
├── manifest.json     PWA manifest
├── icon.svg          App icon
├── og-image.jpg      Social preview (1200×630)
├── og-image.svg      Source for OG image
├── robots.txt
├── sitemap.xml
└── sw.js             Service Worker
```
