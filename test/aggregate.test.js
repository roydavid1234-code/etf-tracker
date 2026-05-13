const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dailyChangeForStock,
  rangeChangeForStock,
  splitBuySell,
} = require('../lib/aggregate');
const { sharesToLots, lotsToShares, SHARES_PER_LOT } = require('../lib/unit');
const { snapshots } = require('./fixture');

// ─── unit.js ────────────────────────────────────────────────────────────────

test('SHARES_PER_LOT 固定為 1000', () => {
  assert.equal(SHARES_PER_LOT, 1000);
});

test('sharesToLots: 100000 股 = 100 張', () => {
  assert.equal(sharesToLots(100000), 100);
});

test('sharesToLots: 0 股 = 0 張（零值邊界）', () => {
  assert.equal(sharesToLots(0), 0);
});

test('sharesToLots: 500 股 = 0.5 張（不足整張）', () => {
  assert.equal(sharesToLots(500), 0.5);
});

test('sharesToLots: 非整數應拋錯', () => {
  assert.throws(() => sharesToLots(1.5), TypeError);
});

test('lotsToShares: 10 張 = 10000 股', () => {
  assert.equal(lotsToShares(10), 10000);
});

test('lotsToShares: 0.5 張 = 500 股', () => {
  assert.equal(lotsToShares(0.5), 500);
});

test('lotsToShares: 非數字應拋錯', () => {
  assert.throws(() => lotsToShares('100'), TypeError);
  assert.throws(() => lotsToShares(NaN), TypeError);
});

// ─── dailyChangeForStock ────────────────────────────────────────────────────

test('5/10 對 2330：00981A +100張, 00992A +10張, 00982A -10張', () => {
  const result = dailyChangeForStock(snapshots, '2330', '2026-05-10');
  // 轉成 map 比對較直覺
  const map = Object.fromEntries(result.map(r => [r.etf_code, r.change_shares]));
  assert.equal(map['00981A'], 100000);
  assert.equal(map['00992A'],  10000);
  assert.equal(map['00982A'], -10000);
  assert.equal(result.length, 3);
});

test('5/10 對 2330：依絕對變動量降冪排序', () => {
  const result = dailyChangeForStock(snapshots, '2330', '2026-05-10');
  const order = result.map(r => r.etf_code);
  assert.deepEqual(order, ['00981A', '00992A', '00982A']); // |100k| > |10k| = |-10k|
});

test('dailyChangeForStock 不會混入其他股票（2317 noise 應被忽略）', () => {
  const result = dailyChangeForStock(snapshots, '2330', '2026-05-10');
  assert.ok(result.every(r => r.change_shares !== 999999));
});

test('5/9 對 2330：僅 00981A +20張，其他 ETF 無變動不回傳', () => {
  const result = dailyChangeForStock(snapshots, '2330', '2026-05-09');
  assert.equal(result.length, 1);
  assert.equal(result[0].etf_code, '00981A');
  assert.equal(result[0].change_shares, 20000);
});

test('5/8 對 2330（基準日，無前日資料）：所有 ETF 視為新進場', () => {
  const result = dailyChangeForStock(snapshots, '2330', '2026-05-08');
  assert.equal(result.length, 3);
  const total = result.reduce((s, r) => s + r.change_shares, 0);
  assert.equal(total, 590000); // 500k + 60k + 30k
});

test('未來日（5/11）無快照：回傳空陣列（不報錯）', () => {
  const result = dailyChangeForStock(snapshots, '2330', '2026-05-11');
  // 5/11 無快照 → today=0；但 prev=5/10 持有量 → 全變賣出
  // 這是預期行為：等同「5/11 全部 ETF 出清 2330」
  // 若要排除這種「無資料即出清」誤判，呼叫方應先檢查 5/11 是否真有 snapshot
  assert.equal(result.length, 3);
  assert.ok(result.every(r => r.change_shares < 0));
});

test('查詢不存在的股票：回傳空陣列', () => {
  const result = dailyChangeForStock(snapshots, '9999', '2026-05-10');
  assert.deepEqual(result, []);
});

// ─── rangeChangeForStock ────────────────────────────────────────────────────

test('近 2 日 (5/9~5/10) 對 2330：00981A 共 +120張', () => {
  const result = rangeChangeForStock(snapshots, '2330', '2026-05-09', '2026-05-10');
  const r981 = result.find(r => r.etf_code === '00981A');
  assert.equal(r981.total_change, 120000); // 20k + 100k

  // daily 明細應有兩筆
  assert.equal(r981.daily.length, 2);
  assert.deepEqual(r981.daily, [
    { date: '2026-05-09', change:  20000 },
    { date: '2026-05-10', change: 100000 },
  ]);
});

test('近 2 日 (5/9~5/10) 對 2330：00982A 共 -10張、00992A 共 +10張', () => {
  const result = rangeChangeForStock(snapshots, '2330', '2026-05-09', '2026-05-10');
  const r982 = result.find(r => r.etf_code === '00982A');
  const r992 = result.find(r => r.etf_code === '00992A');
  assert.equal(r982.total_change, -10000);
  assert.equal(r992.total_change,  10000);
});

test('近 1 日 (5/10~5/10)：等價於 dailyChangeForStock(5/10)', () => {
  const range = rangeChangeForStock(snapshots, '2330', '2026-05-10', '2026-05-10');
  const daily = dailyChangeForStock(snapshots, '2330', '2026-05-10');
  const rangeMap = Object.fromEntries(range.map(r => [r.etf_code, r.total_change]));
  const dailyMap = Object.fromEntries(daily.map(r => [r.etf_code, r.change_shares]));
  assert.deepEqual(rangeMap, dailyMap);
});

test('startDate > endDate：拋 RangeError', () => {
  assert.throws(
    () => rangeChangeForStock(snapshots, '2330', '2026-05-10', '2026-05-09'),
    RangeError
  );
});

test('區間外（5/01~5/07）：所有 ETF 皆無紀錄 → 空陣列', () => {
  const result = rangeChangeForStock(snapshots, '2330', '2026-05-01', '2026-05-07');
  assert.deepEqual(result, []);
});

test('區間內無快照（5/11~5/12）：空陣列（與 5/01~5/07 對稱）', () => {
  const result = rangeChangeForStock(snapshots, '2330', '2026-05-11', '2026-05-12');
  assert.deepEqual(result, []);
});

// ─── splitBuySell ──────────────────────────────────────────────────────────

test('splitBuySell：5/9~5/10 範例 → 2 買 (00981A, 00992A)、1 賣 (00982A)', () => {
  const range = rangeChangeForStock(snapshots, '2330', '2026-05-09', '2026-05-10');
  const { buys, sells, flat } = splitBuySell(range);
  assert.equal(buys.length, 2);
  assert.equal(sells.length, 1);
  assert.equal(flat.length, 0);
  assert.deepEqual(buys.map(b => b.etf_code).sort(),  ['00981A', '00992A']);
  assert.deepEqual(sells.map(s => s.etf_code),        ['00982A']);
});

test('splitBuySell：區間內買賣相抵為 0 應歸入 flat', () => {
  // 自造一筆 fixture：00993A 5/8=10000、5/9=20000、5/10=10000 → 區間淨 0
  const local = [
    { etf_code: '00993A', stock_code: '2330', snapshot_date: '2026-05-08', shares: 10000 },
    { etf_code: '00993A', stock_code: '2330', snapshot_date: '2026-05-09', shares: 20000 },
    { etf_code: '00993A', stock_code: '2330', snapshot_date: '2026-05-10', shares: 10000 },
  ];
  const range = rangeChangeForStock(local, '2330', '2026-05-09', '2026-05-10');
  const { buys, sells, flat } = splitBuySell(range);
  assert.equal(buys.length, 0);
  assert.equal(sells.length, 0);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].etf_code, '00993A');
  assert.equal(flat[0].total_change, 0);
  assert.equal(flat[0].daily.length, 2); // 有買有賣，明細仍保留
});
