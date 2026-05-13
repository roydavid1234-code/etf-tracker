// 對應使用者範例：
//   5/10 買入 2330：00981A +100張(100000股), 00992A +10張(10000股)
//   5/10 賣出 2330：00982A -10張(-10000股)
//   5/9  買入 2330：00981A +20張(20000股)
//
// 為了讓「N 日累計」可測，所有 ETF 在 5/8（基準前一日）皆有快照。
// 數字一律以「股」為單位（INTEGER）。

const snapshots = [
  // 5/8 基準
  { etf_code: '00981A', stock_code: '2330', snapshot_date: '2026-05-08', shares: 500000 },
  { etf_code: '00982A', stock_code: '2330', snapshot_date: '2026-05-08', shares:  60000 },
  { etf_code: '00992A', stock_code: '2330', snapshot_date: '2026-05-08', shares:  30000 },

  // 5/9：00981A 加碼 20 張 (+20000)
  { etf_code: '00981A', stock_code: '2330', snapshot_date: '2026-05-09', shares: 520000 },
  { etf_code: '00982A', stock_code: '2330', snapshot_date: '2026-05-09', shares:  60000 },
  { etf_code: '00992A', stock_code: '2330', snapshot_date: '2026-05-09', shares:  30000 },

  // 5/10：00981A +100 張、00992A +10 張、00982A -10 張
  { etf_code: '00981A', stock_code: '2330', snapshot_date: '2026-05-10', shares: 620000 },
  { etf_code: '00982A', stock_code: '2330', snapshot_date: '2026-05-10', shares:  50000 },
  { etf_code: '00992A', stock_code: '2330', snapshot_date: '2026-05-10', shares:  40000 },

  // 其他股票 noise（驗證 stockCode 篩選正確）
  { etf_code: '00981A', stock_code: '2317', snapshot_date: '2026-05-10', shares: 999999 },
];

// 擴充版：含多支股票（2330 / 2317 / 2454 / 0050 / 2882），給 ETF 視角、
// 「當日新增股票」測試與 UI demo 使用。保留 snapshots 中的 2330 9 筆做基底，
// 排除 2317 noise（999999 不真實），重新給 2317 合理數值。
const _baseStock2330 = snapshots.filter(s => s.stock_code === '2330');
const snapshotsExtended = [
  ..._baseStock2330,

  // ── 2454 聯發科 ──
  { etf_code: '00981A', stock_code: '2454', snapshot_date: '2026-05-08', shares: 100000 }, // 100 張
  { etf_code: '00981A', stock_code: '2454', snapshot_date: '2026-05-09', shares: 100000 }, // 不變
  { etf_code: '00981A', stock_code: '2454', snapshot_date: '2026-05-10', shares: 110000 }, // +10 張 (加碼)
  { etf_code: '00992A', stock_code: '2454', snapshot_date: '2026-05-10', shares:  20000 }, // 新進場 +20 張

  // ── 2317 鴻海 ──
  { etf_code: '00982A', stock_code: '2317', snapshot_date: '2026-05-08', shares: 200000 }, // 200 張
  { etf_code: '00982A', stock_code: '2317', snapshot_date: '2026-05-09', shares: 200000 }, // 不變
  { etf_code: '00982A', stock_code: '2317', snapshot_date: '2026-05-10', shares: 180000 }, // -20 張

  // ── 0050 台灣 50 ──（5/10 兩家新進場）
  { etf_code: '00981A', stock_code: '0050', snapshot_date: '2026-05-10', shares:  50000 }, // 新進 +50 張
  { etf_code: '00982A', stock_code: '0050', snapshot_date: '2026-05-10', shares:  30000 }, // 新進 +30 張

  // ── 2882 國泰金 ──（持平樣本，驗證 unchanged 不應被列）
  { etf_code: '00982A', stock_code: '2882', snapshot_date: '2026-05-08', shares:  80000 },
  { etf_code: '00982A', stock_code: '2882', snapshot_date: '2026-05-09', shares:  80000 },
  { etf_code: '00982A', stock_code: '2882', snapshot_date: '2026-05-10', shares:  80000 },
];

// ─── 多 ETF 大資料集 ───────────────────────────────────────────────────────
// 涵蓋使用者要求的 10 支 ETF：0050 / 0056 / 00878 / 00981A / 00992A / 00991A
// / 00990A / 00988A / 00995A / 00994A
//
// 含 snapshotsExtended（00981A、00982A、00992A 的詳細變動）以保留既有測試。
// 00982A 不在使用者清單但保留資料以維護測試；UI 多選只顯示使用者指定的 10 支。
// 五日資料：5/8 ~ 5/10（部分新 ETF 簡化為 5/8 與 5/10 兩日）

const _newEtfData = [
  // 0050 — 元大台灣 50（被動，市值權重大型股）
  { etf_code: '0050', stock_code: '2330', snapshot_date: '2026-05-08', shares: 800000 },
  { etf_code: '0050', stock_code: '2330', snapshot_date: '2026-05-10', shares: 810000 }, // +10 張
  { etf_code: '0050', stock_code: '2317', snapshot_date: '2026-05-08', shares: 300000 },
  { etf_code: '0050', stock_code: '2317', snapshot_date: '2026-05-10', shares: 300000 },
  { etf_code: '0050', stock_code: '2454', snapshot_date: '2026-05-08', shares: 200000 },
  { etf_code: '0050', stock_code: '2454', snapshot_date: '2026-05-10', shares: 200000 },
  { etf_code: '0050', stock_code: '2882', snapshot_date: '2026-05-08', shares: 150000 },
  { etf_code: '0050', stock_code: '2882', snapshot_date: '2026-05-10', shares: 150000 },

  // 0056 — 元大高股息
  { etf_code: '0056', stock_code: '2882', snapshot_date: '2026-05-08', shares: 200000 },
  { etf_code: '0056', stock_code: '2882', snapshot_date: '2026-05-10', shares: 200000 },
  { etf_code: '0056', stock_code: '2412', snapshot_date: '2026-05-08', shares: 180000 },
  { etf_code: '0056', stock_code: '2412', snapshot_date: '2026-05-10', shares: 185000 }, // +5
  { etf_code: '0056', stock_code: '1326', snapshot_date: '2026-05-08', shares: 120000 },
  { etf_code: '0056', stock_code: '1326', snapshot_date: '2026-05-10', shares: 120000 },
  { etf_code: '0056', stock_code: '1101', snapshot_date: '2026-05-08', shares: 100000 },
  { etf_code: '0056', stock_code: '1101', snapshot_date: '2026-05-10', shares: 105000 }, // +5

  // 00878 — 國泰永續高股息
  { etf_code: '00878', stock_code: '2330', snapshot_date: '2026-05-08', shares: 250000 },
  { etf_code: '00878', stock_code: '2330', snapshot_date: '2026-05-10', shares: 252000 }, // +2
  { etf_code: '00878', stock_code: '2454', snapshot_date: '2026-05-08', shares: 150000 },
  { etf_code: '00878', stock_code: '2454', snapshot_date: '2026-05-10', shares: 150000 },
  { etf_code: '00878', stock_code: '2412', snapshot_date: '2026-05-08', shares: 120000 },
  { etf_code: '00878', stock_code: '2412', snapshot_date: '2026-05-10', shares: 120000 },

  // 00991A — 主動（虛構數值）
  { etf_code: '00991A', stock_code: '2330', snapshot_date: '2026-05-08', shares: 40000 },
  { etf_code: '00991A', stock_code: '2330', snapshot_date: '2026-05-10', shares: 50000 }, // +10
  { etf_code: '00991A', stock_code: '1101', snapshot_date: '2026-05-08', shares: 50000 },
  { etf_code: '00991A', stock_code: '1101', snapshot_date: '2026-05-10', shares: 60000 }, // +10
  { etf_code: '00991A', stock_code: '2317', snapshot_date: '2026-05-10', shares: 30000 }, // 新進

  // 00990A
  { etf_code: '00990A', stock_code: '2454', snapshot_date: '2026-05-08', shares: 80000 },
  { etf_code: '00990A', stock_code: '2454', snapshot_date: '2026-05-10', shares: 90000 }, // +10
  { etf_code: '00990A', stock_code: '2882', snapshot_date: '2026-05-10', shares: 40000 }, // 新進

  // 00988A
  { etf_code: '00988A', stock_code: '2317', snapshot_date: '2026-05-08', shares: 60000 },
  { etf_code: '00988A', stock_code: '2317', snapshot_date: '2026-05-10', shares: 80000 }, // +20
  { etf_code: '00988A', stock_code: '1101', snapshot_date: '2026-05-10', shares: 50000 }, // 新進
  { etf_code: '00988A', stock_code: '1326', snapshot_date: '2026-05-10', shares: 30000 }, // 新進

  // 00995A
  { etf_code: '00995A', stock_code: '2412', snapshot_date: '2026-05-08', shares: 50000 },
  { etf_code: '00995A', stock_code: '2412', snapshot_date: '2026-05-10', shares: 55000 }, // +5
  { etf_code: '00995A', stock_code: '2891', snapshot_date: '2026-05-10', shares: 30000 }, // 新進

  // 00994A
  { etf_code: '00994A', stock_code: '1101', snapshot_date: '2026-05-08', shares: 40000 },
  { etf_code: '00994A', stock_code: '1101', snapshot_date: '2026-05-10', shares: 45000 }, // +5
  { etf_code: '00994A', stock_code: '2412', snapshot_date: '2026-05-08', shares: 30000 },
  { etf_code: '00994A', stock_code: '2412', snapshot_date: '2026-05-10', shares: 30000 },
  { etf_code: '00994A', stock_code: '2891', snapshot_date: '2026-05-10', shares: 25000 }, // 新進
];

const snapshotsAllEtfs = [...snapshotsExtended, ..._newEtfData];

// UI 多選用的 ETF 清單（依使用者指定順序）
const ETF_LIST = [
  '0050', '0056', '00878',
  '00981A', '00992A', '00991A', '00994A',
];

module.exports = { snapshots, snapshotsExtended, snapshotsAllEtfs, ETF_LIST };
