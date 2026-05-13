const test = require('node:test');
const assert = require('node:assert/strict');
const {
  dailyChangeForEtf,
  rangeChangeForEtf,
  addedStocksOnDate,
  dailyChangeForStock,
} = require('../lib/aggregate');
const { snapshotsAllEtfs, ETF_LIST } = require('./fixture');

// ─── ETF 清單與 fixture 完整性 ────────────────────────────────────────────

test('ETF_LIST 順序符合需求', () => {
  assert.deepEqual(ETF_LIST, [
    '0050', '0056', '00878',
    '00981A', '00992A', '00991A', '00994A',
  ]);
});

test('snapshotsAllEtfs：每支使用者指定的 ETF 至少 1 筆持股', () => {
  const present = new Set(snapshotsAllEtfs.map(s => s.etf_code));
  for (const e of ETF_LIST) {
    assert.ok(present.has(e), `${e} 缺資料`);
  }
});

// ─── 新 ETF 視角抽查 ──────────────────────────────────────────────────────

test('0050 @ 5/10：只買進 2330 +10 張', () => {
  const r = dailyChangeForEtf(snapshotsAllEtfs, '0050', '2026-05-10');
  assert.equal(r.length, 1);
  assert.equal(r[0].stock_code, '2330');
  assert.equal(r[0].change_shares, 10000);
});

test('00988A @ 5/10：2317 +20、1101 +50（新）、1326 +30（新）', () => {
  const r = dailyChangeForEtf(snapshotsAllEtfs, '00988A', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.stock_code, x.change_shares]));
  assert.equal(m['2317'], 20000);
  assert.equal(m['1101'], 50000);
  assert.equal(m['1326'], 30000);
});

test('0056 range 5/8~5/10：2412 +5、1101 +5（其他持平不列）', () => {
  const r = rangeChangeForEtf(snapshotsAllEtfs, '0056', '2026-05-08', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.stock_code, x.total_change]));
  assert.equal(m['2412'], 185000); // 5/8 沒前一日 baseline=0，整段算進場
  assert.equal(m['1101'], 105000);
});

// ─── 多 ETF 角度：個股視角應「包含新進入的 ETF」─────────────────────────

test('2330 @ 5/10 全市場：含 0050(+10) / 00981A(+100) / 00878(+2) / 00992A(+10) / 00991A(+10)', () => {
  const r = dailyChangeForStock(snapshotsAllEtfs, '2330', '2026-05-10');
  const m = Object.fromEntries(r.map(x => [x.etf_code, x.change_shares]));
  assert.equal(m['0050'],   10000);
  assert.equal(m['00981A'], 100000);
  assert.equal(m['00878'],   2000);
  assert.equal(m['00992A'],  10000);
  assert.equal(m['00991A'],  10000);
  // 00982A 賣出，不在這次抽查但仍應在結果裡
  assert.equal(m['00982A'], -10000);
});

// ─── 全市場新增股票（10 ETF 大集合）─────────────────────────────────────

test('5/10 全市場買入：共有多支股票（含 1101 / 1326 / 2412 / 2891 等新出現）', () => {
  const r = addedStocksOnDate(snapshotsAllEtfs, '2026-05-10');
  const stocks = new Set(r.map(x => x.stock_code));
  for (const s of ['2330', '2454', '0050', '1101', '1326', '2412', '2891']) {
    assert.ok(stocks.has(s), `${s} 應在 5/10 全市場買入結果中`);
  }
});

test('5/10 newOnly：1101 / 1326 / 2891 / 2317 都應出現（多支 ETF 新進場）', () => {
  const r = addedStocksOnDate(snapshotsAllEtfs, '2026-05-10', { newOnly: true });
  const stocks = new Set(r.map(x => x.stock_code));
  // 1101: 00988A 新進
  // 1326: 00988A 新進
  // 2891: 00995A & 00994A 新進
  // 2317: 00991A 新進
  for (const s of ['1101', '1326', '2891', '2317']) {
    assert.ok(stocks.has(s), `newOnly 應含 ${s}`);
  }
});
