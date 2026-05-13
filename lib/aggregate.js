// 純函式：把「每日持股快照」轉成「買賣明細 / 區間累計」。
// 無 I/O、無副作用，所有輸入皆為 plain object 陣列。
//
// Snapshot 形狀：
//   { etf_code, stock_code, snapshot_date: 'YYYY-MM-DD', shares: int }
//
// 三種視角共用同一份原始資料：
//   - 個股視角：固定 stock_code，列各 ETF 變動
//   - ETF 視角：固定 etf_code，列各股票變動
//   - 全市場「當日新增股票」：固定 date，列被買入的股票及對應 ETF
//
// 約定：
//   - 缺值（某 (etf, stock) 該日無紀錄）視為 0 股。
//   - 「有 → 缺」算完整出清；「缺 → 有」算新進場。
//   - 日期一律字串比較 'YYYY-MM-DD'（字典序 = 日期序）。

// ─── 共用 helper ──────────────────────────────────────────────────────────

function _dailyDiffByPivot(snapshots, filterKey, filterValue, pivotKey, targetDate) {
  const byKey = new Map(); // pivotValue -> [{date, shares}, ...]
  for (const s of snapshots) {
    if (s[filterKey] !== filterValue) continue;
    if (s.snapshot_date > targetDate) continue;
    if (!byKey.has(s[pivotKey])) byKey.set(s[pivotKey], []);
    byKey.get(s[pivotKey]).push({ date: s.snapshot_date, shares: s.shares });
  }
  const out = [];
  for (const [key, rows] of byKey) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let today = 0, prev = 0;
    for (const r of rows) {
      if (r.date === targetDate) today = r.shares;
      else if (r.date < targetDate) prev = r.shares;
    }
    const change = today - prev;
    if (change !== 0) out.push({ key, change, today });
  }
  return out;
}

function _rangeDiffByPivot(snapshots, filterKey, filterValue, pivotKey, startDate, endDate) {
  if (startDate > endDate) throw new RangeError('startDate must be <= endDate');
  const byKey = new Map();
  for (const s of snapshots) {
    if (s[filterKey] !== filterValue) continue;
    if (!byKey.has(s[pivotKey])) byKey.set(s[pivotKey], []);
    byKey.get(s[pivotKey]).push({ date: s.snapshot_date, shares: s.shares });
  }
  const out = [];
  for (const [key, rows] of byKey) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let baseline = 0;
    for (const r of rows) {
      if (r.date < startDate) baseline = r.shares;
      else break;
    }
    const daily = [];
    let prev = baseline;
    let endShares = baseline;
    for (const r of rows) {
      if (r.date < startDate) continue;
      if (r.date > endDate) break;
      const change = r.shares - prev;
      if (change !== 0) daily.push({ date: r.date, change });
      prev = r.shares;
      endShares = r.shares;
    }
    const total = daily.reduce((acc, d) => acc + d.change, 0);
    if (total !== 0 || daily.length > 0) out.push({ key, total, daily, end: endShares });
  }
  return out;
}

function _sortByMagnitude(rows, codeField, valueField) {
  return rows.sort((a, b) => {
    const diff = Math.abs(b[valueField]) - Math.abs(a[valueField]);
    if (diff !== 0) return diff;
    if (Math.sign(b[valueField]) !== Math.sign(a[valueField])) {
      return b[valueField] - a[valueField]; // 同量買入(正)優先
    }
    return a[codeField] < b[codeField] ? -1 : a[codeField] > b[codeField] ? 1 : 0;
  });
}

// ─── 個股視角 ─────────────────────────────────────────────────────────────

function dailyChangeForStock(snapshots, stockCode, targetDate) {
  const raw = _dailyDiffByPivot(snapshots, 'stock_code', stockCode, 'etf_code', targetDate);
  const result = raw.map(r => ({ etf_code: r.key, change_shares: r.change, today_shares: r.today }));
  return _sortByMagnitude(result, 'etf_code', 'change_shares');
}

function rangeChangeForStock(snapshots, stockCode, startDate, endDate) {
  const raw = _rangeDiffByPivot(snapshots, 'stock_code', stockCode, 'etf_code', startDate, endDate);
  const result = raw.map(r => ({ etf_code: r.key, total_change: r.total, daily: r.daily, end_shares: r.end }));
  return _sortByMagnitude(result, 'etf_code', 'total_change');
}

// ─── ETF 視角 ─────────────────────────────────────────────────────────────

function dailyChangeForEtf(snapshots, etfCode, targetDate) {
  const raw = _dailyDiffByPivot(snapshots, 'etf_code', etfCode, 'stock_code', targetDate);
  const result = raw.map(r => ({ stock_code: r.key, change_shares: r.change, today_shares: r.today }));
  return _sortByMagnitude(result, 'stock_code', 'change_shares');
}

function rangeChangeForEtf(snapshots, etfCode, startDate, endDate) {
  const raw = _rangeDiffByPivot(snapshots, 'etf_code', etfCode, 'stock_code', startDate, endDate);
  const result = raw.map(r => ({ stock_code: r.key, total_change: r.total, daily: r.daily, end_shares: r.end }));
  return _sortByMagnitude(result, 'stock_code', 'total_change');
}

// ─── 全市場「當日新增股票」 ────────────────────────────────────────────────

/**
 * 列出「targetDate 當日被任一 ETF 買入」的股票。
 * 預設含「加碼」；newOnly=true 則只列「該 ETF 在 targetDate 之前持有 0 股」的進場。
 *
 * @returns {Array<{
 *   stock_code, total_change, etf_count,
 *   etfs: Array<{etf_code, change_shares}>
 * }>}  依當日總買入量降冪
 */
function addedStocksOnDate(snapshots, targetDate, { newOnly = false, etfFilter = null } = {}) {
  // etfFilter：陣列；若提供，只計入這些 ETF 的買入。null 或空陣列 = 不過濾。
  const etfSet = (etfFilter && etfFilter.length > 0) ? new Set(etfFilter) : null;

  // (etf, stock) -> { etf, stock, today, prev }
  const map = new Map();
  const keyOf = (e, s) => e + '|' + s;
  for (const s of snapshots) {
    if (s.snapshot_date > targetDate) continue;
    if (etfSet && !etfSet.has(s.etf_code)) continue;
    const k = keyOf(s.etf_code, s.stock_code);
    if (!map.has(k)) {
      map.set(k, { etf: s.etf_code, stock: s.stock_code, today: 0, prev: 0, prevDate: '' });
    }
    const e = map.get(k);
    if (s.snapshot_date === targetDate) e.today = s.shares;
    else if (s.snapshot_date > e.prevDate) { e.prev = s.shares; e.prevDate = s.snapshot_date; }
  }

  // group by stock_code
  const byStock = new Map();
  for (const e of map.values()) {
    const change = e.today - e.prev;
    if (change <= 0) continue;                 // 只看買入
    if (newOnly && e.prev > 0) continue;       // newOnly：之前持有 > 0 不算
    if (!byStock.has(e.stock)) {
      byStock.set(e.stock, { stock_code: e.stock, total_change: 0, etfs: [] });
    }
    const g = byStock.get(e.stock);
    g.etfs.push({ etf_code: e.etf, change_shares: change });
    g.total_change += change;
  }

  // 每組內 ETF 依買入量降冪
  for (const g of byStock.values()) {
    g.etfs.sort((a, b) => {
      const diff = b.change_shares - a.change_shares;
      if (diff !== 0) return diff;
      return a.etf_code < b.etf_code ? -1 : 1;
    });
    g.etf_count = g.etfs.length;
  }

  // 跨股票依總買入量降冪
  const result = Array.from(byStock.values());
  result.sort((a, b) => {
    const diff = b.total_change - a.total_change;
    if (diff !== 0) return diff;
    return a.stock_code < b.stock_code ? -1 : 1;
  });
  return result;
}

// ─── 買賣分組（共用） ─────────────────────────────────────────────────────

function splitBuySell(rangeResult) {
  const buys = [], sells = [], flat = [];
  for (const r of rangeResult) {
    if (r.total_change > 0) buys.push(r);
    else if (r.total_change < 0) sells.push(r);
    else flat.push(r);
  }
  return { buys, sells, flat };
}

module.exports = {
  dailyChangeForStock, rangeChangeForStock,
  dailyChangeForEtf, rangeChangeForEtf,
  addedStocksOnDate,
  splitBuySell,
};
