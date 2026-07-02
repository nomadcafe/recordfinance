# Record · Finance

[English](README.md) · **中文** · [日本語](README.ja.md)

私密、离线优先的多币种净资产记录工具。
你的数据永远不会离开你的设备。

**在线访问：** https://record.finance

---

## 功能

- **多币种** —— CNY、USD、JPY、EUR、GBP、HKD、SGD、TWD、KRW、AUD、CAD、CHF、INR、THB、MYR，自动获取汇率
- **资产 / 负债账户**，带分类（现金、存款、投资、房产、加密货币、其他）
- **净资产或总资产** —— 一个开关切换整个应用的统计口径
- **目标追踪**，含到达时间预估和里程碑庆祝
- **图表** —— 余额走势、同比、单账户钻取、币种 / 分类构成
- **本月至今 / 今年至今 / 入金 vs 市场涨跌** 拆解
- **本地文件同步** —— 基于 File System Access API，指向任意云同步文件夹（iCloud Drive、Dropbox、OneDrive），变更时自动同步
- **滚动本地快照**（最近 20 次变更），可安全撤销
- **口令加密**（AES-GCM）——覆盖本地数据、本地备份与同步文件；隐私模糊，长按可临时查看
- **PWA** —— 可添加到主屏幕，离线可用（Service Worker）
- **多语言** —— English / 中文 / 日本語
- **浅色 / 深色主题**，可配置财年起始月

## 技术

纯静态站点，无构建步骤，无框架。

- 单个 `index.html` 内的 HTML / CSS / 原生 JS
- [Chart.js](https://www.chartjs.org/)，通过 jsDelivr CDN 引入
- [`@fawazahmed0/currency-api`](https://github.com/fawazahmed0/exchange-api)，通过 jsDelivr CDN（免费，无需 API key）
- File System Access API + IndexedDB，用于持久化同步句柄
- Service Worker，用于离线和资源缓存
- Web Crypto API（PBKDF2 + AES-GCM），用于可选的落盘加密

## 隐私

- **无后端。** 没有服务器存储你的数据。
- **无分析、无追踪、无 Cookie。**
- **无账号 / 无注册。** 打开页面即可使用。
- **开源。** 每一行代码都在本仓库中——欢迎审计。
- 所有数据都保存在浏览器的 LocalStorage 和 IndexedDB 中。
- 可选的同步功能只会向你指定的位置写入一个 JSON 文件。
- 汇率 API 只会收到你请求的日期——不含任何个人信息。
