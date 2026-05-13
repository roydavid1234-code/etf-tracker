// 整合測試：把 fixture 灌進 in-memory SQLite，跑 SQL 聚合，
// 再與純函式版本逐項比對 — 兩個實作必須回傳「完全相同」的結果。
//
// 這層也順便驗證 schema.sql 能載入、UPSERT 正確、外鍵約束滿足。

const test = require('node:test');
const assert = require('node:assert/strict');

const { openDb } = require('../lib/db');
const { ingestSnapshots } = require('../lib/ingest');
const { dailyChangeForStockSql, rangeChangeForStockSql } = require('../lib/query-sql');
const { dailyChangeForStock, rangeChangeForStock } = require('../lib/aggregate');
const { snapshots } = require('./fixture');

function freshDb() {
  const db = openDb();
  ingestSnapshots(db, snapshots);
  return db;
}

// ─── schema / ingest 健康檢查 ──────────────────────────────────────────────

test('schema 載入後三表皆存在', () => {
  const db = openDb();
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map(r => r.name);
  assert.ok(tables.includes('etf'));
  assert.ok(tables.includes('stock'));
  assert.ok(tables.includes('holding_snapshot'));
});

test('ingest 後筆數與輸入相符', () => {
  const db = freshDb();
  const n = db.prepare('SELECT COUNT(*) AS c FROM holding_snapshot').get().c;
  assert.equal(n, snapshots.length);
});

test('ingest 自動補登 etf 與 stock 主檔', () => {
  const db = freshDb();
  const etfs = db.prepare('SELECT code FROM etf ORDER BY code').all().map(r => r.code);
  const stocks = db.prepare('SELECT code FROM stock ORDER BY code').all().map(r => r.code);
  assert.deepEqual(etfs,   ['00981A', '00982A', '00992A']);
  assert.deepEqual(stocks, ['2317', '2330']);
});

test('UPSERT：同 (etf, stock, date) 重灌會覆蓋 shares', () => {
  const db = freshDb();
  ingestSnapshots(db, [{
    etf_code: '00981A', stock_code: '2330', snapshot_date: '2026-05-10', shares: 999999,
  }]);
  const row = db.prepare(
    'SELECT shares FROM holding_snapshot WHERE etf_code=? AND stock_code=? AND snapshot_date=?'
  ).get('00981A', '2330', '2026-05-10');
  assert.equal(row.shares, 999999);
});

test('CHECK 約束：shares 不可為負', () => {
  const db = freshDb();
  assert.throws(() => ingestSnapshots(db, [{
    etf_code: '00981A', stock_code: '2330', snapshot_date: '2026-05-11', shares: -1,
  }]));
});

// ─── SQL vs JS 純函式 cross-check ──────────────────────────────────────────

function normalize(arr) {
  // SQLite 回傳的 row 物件可能有額外屬性，正規化方便比對
  return arr.map(r => ({ ...r }));
}

test('daily SQL == JS：5/10 對 2330', () => {
  const db = freshDb();
  const sql = normalize(dailyChangeForStockSql(db, '2330', '2026-05-10'));
  const js  = dailyChangeForStock(snapshots, '2330', '2026-05-10');
  assert.deepEqual(sql, js);
});

test('daily SQL == JS：5/9 對 2330（單 ETF 變動）', () => {
  const db = freshDb();
  const sql = normalize(dailyChangeForStockSql(db, '2330', '2026-05-09'));
  const js  = dailyChangeForStock(snapshots, '2330', '2026-05-09');
  assert.deepEqual(sql, js);
});

test('daily SQL == JS：5/8 對 2330（基準日，全部新進場）', () => {
  const db = freshDb();
  const sql = normalize(dailyChangeForStockSql(db, '2330', '2026-05-08'));
  const js  = dailyChangeForStock(snapshots, '2330', '2026-05-08');
  assert.deepEqual(sql, js);
});

test('daily SQL：未指定股票回空（與 JS 一致）', () => {
  const db = freshDb();
  const sql = normalize(dailyChangeForStockSql(db, '9999', '2026-05-10'));
  assert.deepEqual(sql, []);
});

test('range SQL == JS：5/9~5/10 對 2330', () => {
  const db = freshDb();
  const sql = rangeChangeForStockSql(db, '2330', '2026-05-09', '2026-05-10');
  const js  = rangeChangeForStock(snapshots, '2330', '2026-05-09', '2026-05-10');
  assert.deepEqual(sql, js);

  // 額外驗證：00981A 累計 +120 張（120000 股）
  const r = sql.find(x => x.etf_code === '00981A');
  assert.equal(r.total_change, 120000);
  assert.equal(r.daily.length, 2);
});

test('range SQL == JS：單日區間 5/10~5/10', () => {
  const db = freshDb();
  const sql = rangeChangeForStockSql(db, '2330', '2026-05-10', '2026-05-10');
  const js  = rangeChangeForStock(snapshots, '2330', '2026-05-10', '2026-05-10');
  assert.deepEqual(sql, js);
});

test('range SQL：startDate > endDate 拋 RangeError', () => {
  const db = freshDb();
  assert.throws(
    () => rangeChangeForStockSql(db, '2330', '2026-05-10', '2026-05-09'),
    RangeError
  );
});

test('range SQL：區間外回空陣列（與 JS 一致）', () => {
  const db = freshDb();
  const sql = rangeChangeForStockSql(db, '2330', '2026-05-01', '2026-05-07');
  const js  = rangeChangeForStock(snapshots, '2330', '2026-05-01', '2026-05-07');
  assert.deepEqual(sql, js);
  assert.deepEqual(sql, []);
});

// ─── 大量資料健全性 ─────────────────────────────────────────────────────────

test('range SQL：跨多日多 ETF 結果與 JS 純函式一致', () => {
  const db = freshDb();
  // 全區間
  const sql = rangeChangeForStockSql(db, '2330', '2026-05-08', '2026-05-10');
  const js  = rangeChangeForStock(snapshots, '2330', '2026-05-08', '2026-05-10');
  assert.deepEqual(sql, js);
});
