// 用 fixture 資料示範你原始需求的兩個查詢。
// 跑法：  node etf-tracker/demo.js

const { openDb } = require('./lib/db');
const { ingestSnapshots } = require('./lib/ingest');
const { dailyChangeForStockSql, rangeChangeForStockSql } = require('./lib/query-sql');
const { splitBuySell } = require('./lib/aggregate');
const { sharesToLots } = require('./lib/unit');
const { snapshots } = require('./test/fixture');

const db = openDb();
ingestSnapshots(db, snapshots);

function fmtLots(shares) {
  const lots = sharesToLots(shares);
  const sign = lots > 0 ? '+' : '';
  return `${sign}${lots} 張`;
}

console.log('═══ Demo 1：5/10 對 2330 的買賣明細 ═══\n');
const day = dailyChangeForStockSql(db, '2330', '2026-05-10');
const buys  = day.filter(r => r.change_shares > 0);
const sells = day.filter(r => r.change_shares < 0);

console.log('5/10 買入 2330：');
buys.forEach(r => console.log(`  ${r.etf_code}  ${fmtLots(r.change_shares)}`));
console.log('\n5/10 賣出 2330：');
sells.forEach(r => console.log(`  ${r.etf_code}  ${fmtLots(r.change_shares)}`));

console.log('\n═══ Demo 2：近 2 日 (5/9~5/10) 對 2330 的累計 ═══\n');
const range = rangeChangeForStockSql(db, '2330', '2026-05-09', '2026-05-10');
const { buys: rBuys, sells: rSells } = splitBuySell(range);

console.log('5/9 ~ 5/10 買入 2330：');
rBuys.forEach(r => {
  const daily = r.daily.map(d => `${d.date.slice(5)} ${fmtLots(d.change)}`).join(' && ');
  console.log(`  ${r.etf_code}  共 ${fmtLots(r.total_change)}  (${daily})`);
});

console.log('\n5/9 ~ 5/10 賣出 2330：');
rSells.forEach(r => {
  const daily = r.daily.map(d => `${d.date.slice(5)} ${fmtLots(d.change)}`).join(' && ');
  console.log(`  ${r.etf_code}  共 ${fmtLots(r.total_change)}  (${daily})`);
});

db.close();
