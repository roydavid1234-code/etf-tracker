const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dailyChangeForEtf,
  rangeChangeForEtf,
  addedStocksOnDate,
} = require('../lib/aggregate');
const { snapshotsExtended } = require('./fixture');

// ─── ETF 視角：單日 ─────────────────────────────────────────────────────

test('00981A @ 5/10：2330 +100張、2454 +10張、0050 +50張', () => {
  const r = dailyChangeForEtf(snapshotsExtended, '00981A', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.stock_code, x.change_shares]));
  assert.equal(m['2330'], 100000);
  assert.equal(m['2454'],  10000);
  assert.equal(m['0050'],  50000);
  assert.equal(r.length, 3);
});

test('00981A @ 5/10：排序依絕對變動量降冪', () => {
  const order = dailyChangeForEtf(snapshotsExtended, '00981A', '2026-05-10').map(r => r.stock_code);
  assert.deepEqual(order, ['2330', '0050', '2454']); // 100 > 50 > 10
});

test('00982A @ 5/10：2317 -20張、2330 -10張、0050 +30張，2882 不變不列', () => {
  const r = dailyChangeForEtf(snapshotsExtended, '00982A', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.stock_code, x.change_shares]));
  assert.equal(m['2317'], -20000);
  assert.equal(m['2330'], -10000);
  assert.equal(m['0050'],  30000);
  assert.equal(m['2882'], undefined); // 不變應排除
  assert.equal(r.length, 3);
});

test('00992A @ 5/10：2330 +10張、2454 +20張', () => {
  const r = dailyChangeForEtf(snapshotsExtended, '00992A', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.stock_code, x.change_shares]));
  assert.equal(m['2330'], 10000);
  assert.equal(m['2454'], 20000);
});

test('不存在的 ETF 代號：回空陣列', () => {
  const r = dailyChangeForEtf(snapshotsExtended, '99999A', '2026-05-10');
  assert.deepEqual(r, []);
});

// ─── ETF 視角：區間 ─────────────────────────────────────────────────────

test('00981A range 5/9~5/10：2330 +120張、2454 +10張、0050 +50張', () => {
  const r = rangeChangeForEtf(snapshotsExtended, '00981A', '2026-05-09', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.stock_code, x.total_change]));
  assert.equal(m['2330'], 120000); // 5/9 +20 + 5/10 +100
  assert.equal(m['2454'],  10000); // 5/10 +10
  assert.equal(m['0050'],  50000); // 5/10 新進
});

test('rangeChangeForEtf：startDate > endDate 拋 RangeError', () => {
  assert.throws(
    () => rangeChangeForEtf(snapshotsExtended, '00981A', '2026-05-10', '2026-05-09'),
    RangeError
  );
});

// ─── 全市場：當日新增股票（含加碼） ────────────────────────────────────

test('5/10 全市場買入：四支股票 2330 / 0050 / 2454（依買入量降冪）', () => {
  const r = addedStocksOnDate(snapshotsExtended, '2026-05-10');
  const stocks = r.map(x => x.stock_code);
  assert.deepEqual(stocks, ['2330', '0050', '2454']);

  const find = code => r.find(x => x.stock_code === code);
  assert.equal(find('2330').total_change, 110000); // 00981A +100k + 00992A +10k
  assert.equal(find('2330').etf_count, 2);
  assert.equal(find('0050').total_change,  80000); // 00981A +50k + 00982A +30k
  assert.equal(find('0050').etf_count, 2);
  assert.equal(find('2454').total_change,  30000); // 00981A +10k + 00992A +20k
});

test('5/10 全市場買入：2882 持平不列、2317 賣出不列', () => {
  const stocks = addedStocksOnDate(snapshotsExtended, '2026-05-10').map(x => x.stock_code);
  assert.ok(!stocks.includes('2882'));
  assert.ok(!stocks.includes('2317'));
});

test('5/10 全市場買入：每股票內 ETF 依買入量降冪', () => {
  const r = addedStocksOnDate(snapshotsExtended, '2026-05-10');
  const find = code => r.find(x => x.stock_code === code);
  assert.deepEqual(find('2330').etfs.map(e => e.etf_code), ['00981A', '00992A']); // 100k > 10k
  assert.deepEqual(find('0050').etfs.map(e => e.etf_code), ['00981A', '00982A']); // 50k > 30k
  assert.deepEqual(find('2454').etfs.map(e => e.etf_code), ['00992A', '00981A']); // 20k > 10k
});

// ─── 全市場：當日新進場 (newOnly) ─────────────────────────────────────

test('5/10 newOnly：只列「該 ETF 此前未持有」的進場', () => {
  const r = addedStocksOnDate(snapshotsExtended, '2026-05-10', { newOnly: true });

  // 2330 全部 ETF 之前都持有 → 不列
  assert.ok(!r.some(x => x.stock_code === '2330'));

  // 0050 雙進場
  const r0050 = r.find(x => x.stock_code === '0050');
  assert.ok(r0050);
  assert.equal(r0050.total_change, 80000);
  assert.equal(r0050.etf_count, 2);

  // 2454：00981A 既已持有不入 newOnly；只剩 00992A +20k
  const r2454 = r.find(x => x.stock_code === '2454');
  assert.ok(r2454);
  assert.equal(r2454.total_change, 20000);
  assert.equal(r2454.etf_count, 1);
  assert.equal(r2454.etfs[0].etf_code, '00992A');
});

test('5/10 newOnly：排序 0050 (80000) > 2454 (20000)', () => {
  const order = addedStocksOnDate(snapshotsExtended, '2026-05-10', { newOnly: true })
    .map(x => x.stock_code);
  assert.deepEqual(order, ['0050', '2454']);
});

test('5/8 基準日：所有買入都算新進場（一切從 0 起算）', () => {
  const all  = addedStocksOnDate(snapshotsExtended, '2026-05-08');
  const onew = addedStocksOnDate(snapshotsExtended, '2026-05-08', { newOnly: true });
  assert.deepEqual(
    all.map(x => x.stock_code).sort(),
    onew.map(x => x.stock_code).sort()
  );
});

test('5/9：僅 00981A 對 2330 加碼 +20 張', () => {
  const r = addedStocksOnDate(snapshotsExtended, '2026-05-09');
  assert.equal(r.length, 1);
  assert.equal(r[0].stock_code, '2330');
  assert.equal(r[0].total_change, 20000);
  assert.equal(r[0].etfs[0].etf_code, '00981A');
});

test('完全沒資料的日期（5/15）：回空陣列', () => {
  const r = addedStocksOnDate(snapshotsExtended, '2026-05-15');
  // prev=last snapshot, today=0 → change<0 → 不入 buys
  assert.deepEqual(r, []);
});
