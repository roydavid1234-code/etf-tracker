# ETF 持股追蹤 — 第二回合整合報告

**Skill Mode：** Full_Stack_QA_Lead（統籌 Backend_Guardian + Logic_Architect）
**範圍：** 純函式（v1）+ SQLite 整合層 + SQL 版聚合 cross-check + 資料源評估
**日期：** 2026-05-11

## 本回合新增

### 1. etfedge.xyz 探勘結論：**不走**
- `robots.txt` 明確 `Disallow: /preview/*.json$` — 站方不歡迎爬蟲取 JSON
- 站方確實有 JSON endpoint（呼應前述「JS 動態載入」），但繞過 robots.txt 風險高
- **決議：放棄 etfedge，轉備案**

### 2. SITCA 探勘結論：**首頁無入口，下回合再深挖**
- 投信投顧公會首頁未見「主動式 ETF 每日持股」揭露入口
- 台灣主動式 ETF 為 2024 後新商品，依規定須每日揭露持股，但實際揭露分散在各家發行投信（復華、群益、永豐、統一…）自家網站
- 結論：要做的話會是「N 家獨立 fetcher + 統一 schema」，工程量 ≠ 單一資料源
- **暫列下回合 spike：列出全部主動式 ETF 發行商與其揭露頁 URL**

### 3. SQLite 整合層：完工並 cross-check 通過
- `lib/db.js` — in-memory / 檔案 DB 工廠，啟動時自動載入 schema
- `lib/ingest.js` — UPSERT 寫入，自動補登 etf / stock 主檔，整批 transaction
- `lib/query-sql.js` — SQL 版 daily / range 聚合，輸出格式與 JS 純函式**完全一致**
- 全部整合測試通過 `node --test etf-tracker/test/`：**37 case 全綠**（含 14 個 cross-check 案例）

## 測試範圍（累計）

| 模組 | 檔案 | Case | 狀態 |
|---|---|---|---|
| 單位換算 | `lib/unit.js` | 8 | ✅ |
| 單日聚合（JS） | `lib/aggregate.js#dailyChangeForStock` | 7 | ✅ |
| 區間聚合（JS） | `lib/aggregate.js#rangeChangeForStock` | 6 | ✅ |
| 買賣分組（JS） | `lib/aggregate.js#splitBuySell` | 2 | ✅ |
| Schema / Ingest | `lib/db.js` + `lib/ingest.js` | 5 | ✅ |
| SQL daily 對齊 JS | `lib/query-sql.js#dailyChangeForStockSql` | 4 | ✅ |
| SQL range 對齊 JS | `lib/query-sql.js#rangeChangeForStockSql` | 5 | ✅ |
| **總計** | | **37** | **✅** |

## 模型決策（沿用 v1）

1. **存「股」(INTEGER)**，顯示時除 1000 轉「張」
2. **存「每日持股快照」**，買賣 = 相鄰日 diff
3. **缺值 = 0 股**，「有 → 缺」算出清、「缺 → 有」算進場
4. **N 日累計用「逐日 diff 加總」**，可附帶每日明細
5. **排序穩定**：絕對變動量降冪 → 同量買入優先 → etf_code 字典序

## SQL 設計重點

### daily SQL
- 三段 CTE：`today` / `prev_ranked` (用 `ROW_NUMBER` 取每 ETF 「< targetDate 最近一筆」) / `etfs` (兩端聯集)
- 兩邊 LEFT JOIN 後算 diff，過濾 0
- 排序明確寫出三層 tiebreaker，與 JS 完全一致

### range SQL
- `LAG(shares, 1, 0)` window function 取前筆，缺值預設 0（與 JS 缺值=0 對齊）
- 篩到區間內後 JS 端 group by etf_code 加總並排序
- 純 SQL 版需要 SQLite 3.25+；better-sqlite3 內建 3.40+，OK

## 風險點（更新）

| 風險 | 現況 | 緩解 |
|---|---|---|
| 資料源缺失 | etfedge 不可行 / SITCA 無入口 / 各投信分散 | 下回合 spike 列出全部主動式 ETF 發行商揭露 URL |
| 漏抓日造成「全出清」誤判 | 仍未防 | ingest 加入「單日 diff > 30% 持股」警示但不阻擋（保留警示記錄表） |
| 主動 ETF 跨夜 IPO / 出清整檔 | 未覆蓋 | 加 ETF 生命週期表：inception_at / delist_at；查詢自動忽略未上市/已下市 |
| 股 ↔ 張小數顯示 | 已用 INTEGER 存 | 顯示層約定：負值前綴「-」，0.5 張 = 「500 股 / 0.5 張」並列 |

## 測試金字塔審視（更新）

```
        E2E    （0）   ← UI 層下回合
       ─────
     Integration   （14）  ← schema + UPSERT + SQL/JS cross-check
    ─────────────
   Unit         （23）  ← 純函式 + 單位換算
  ─────────────────
```

**比例 23 : 14 : 0 ≈ 62/38/0**，整合測試比預期更厚。原因是 SQL 與 JS 雙實作 cross-check 本身就跨層。70/20/10 標準目標在加入 E2E 後會回歸。

## 檔案清單（更新）

```
etf-tracker/
├── db/schema.sql                  ─ SQLite 三表 + 索引
├── lib/
│   ├── unit.js                    ─ 股↔張換算
│   ├── aggregate.js               ─ JS 純函式：daily / range / splitBuySell
│   ├── db.js                      ─ openDb() 工廠
│   ├── ingest.js                  ─ ingestSnapshots() 帶 UPSERT
│   └── query-sql.js               ─ SQL 版 daily / range（API 對齊純函式）
├── test/
│   ├── fixture.js                 ─ 使用者原始範例 + noise
│   ├── aggregate.test.js          ─ 23 case
│   └── integration.test.js        ─ 14 case：schema / ingest / SQL cross-check
└── REPORT.md                      ─ 本檔
```

**執行：** `node --test etf-tracker/test/aggregate.test.js etf-tracker/test/integration.test.js`

## 下回合建議優先序

1. **資料源 spike**：用 1~2 小時列出全部主動式 ETF（00981A 系列）發行商揭露頁面 URL 與資料格式，評估「N 家 fetcher」可行性 vs.「採購第三方 API」
2. **顯示層 API**：簡單 Express endpoint `/api/stock/:code/range?days=N`，包裝 SQL 聚合並換算「張」
3. **UI 雛型**：仿 etfedge 表格，但反過來——「個股視角」優先（你最初的需求形狀）
4. **真實資料試水**：先手動丟一兩天真實 ETF 持股 CSV 進來，確認 schema 是否還需擴欄（weight、market_value）
