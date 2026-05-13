#!/usr/bin/env node
// 簡易 CLI。預設讀 fixture 作為 demo 資料；用 --db <path> 可改讀真實 SQLite 檔。
//
// 用法：
//   node etf-tracker/cli.js daily <stock> <date>
//   node etf-tracker/cli.js range <stock> <start> <end>
//   node etf-tracker/cli.js range <stock> --days N --end <YYYY-MM-DD>
//
// 範例：
//   node etf-tracker/cli.js daily 2330 2026-05-10
//   node etf-tracker/cli.js range 2330 2026-05-09 2026-05-10
//   node etf-tracker/cli.js range 2330 --days 2 --end 2026-05-10

const { openDb } = require('./lib/db');
const { ingestSnapshots } = require('./lib/ingest');
const { dailyChangeForStockSql, rangeChangeForStockSql } = require('./lib/query-sql');
const { splitBuySell } = require('./lib/aggregate');
const { sharesToLots } = require('./lib/unit');

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { args.flags[a.slice(2)] = argv[++i]; }
    else { args._.push(a); }
  }
  return args;
}

function shiftDate(isoDate, deltaDays) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function fmtLots(shares) {
  const lots = sharesToLots(shares);
  const sign = lots > 0 ? '+' : '';
  return `${sign}${lots} 張`;
}

function loadDb(dbPath) {
  const db = openDb(dbPath || ':memory:');
  if (!dbPath) {
    const { snapshots } = require('./test/fixture');
    ingestSnapshots(db, snapshots);
  }
  return db;
}

function cmdDaily(db, stock, date) {
  const day = dailyChangeForStockSql(db, stock, date);
  if (day.length === 0) { console.log(`(${date} 對 ${stock} 無變動)`); return; }
  const buys  = day.filter(r => r.change_shares > 0);
  const sells = day.filter(r => r.change_shares < 0);
  if (buys.length)  { console.log(`${date} 買入 ${stock}：`);  buys.forEach(r  => console.log(`  ${r.etf_code}  ${fmtLots(r.change_shares)}`)); }
  if (sells.length) { console.log(`${date} 賣出 ${stock}：`); sells.forEach(r => console.log(`  ${r.etf_code}  ${fmtLots(r.change_shares)}`)); }
}

function cmdRange(db, stock, start, end) {
  const range = rangeChangeForStockSql(db, stock, start, end);
  if (range.length === 0) { console.log(`(${start} ~ ${end} 對 ${stock} 無變動)`); return; }
  const { buys, sells, flat } = splitBuySell(range);
  const printGroup = (label, group) => {
    if (group.length === 0) return;
    console.log(`${start} ~ ${end} ${label} ${stock}：`);
    group.forEach(r => {
      const daily = r.daily.map(d => `${d.date.slice(5)} ${fmtLots(d.change)}`).join(' && ');
      console.log(`  ${r.etf_code}  共 ${fmtLots(r.total_change)}  (${daily})`);
    });
  };
  printGroup('買入', buys);
  printGroup('賣出', sells);
  if (flat.length) printGroup('進出相抵', flat);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  const db = loadDb(args.flags.db);

  try {
    if (cmd === 'daily') {
      const [stock, date] = rest;
      if (!stock || !date) { console.error('用法：daily <stock> <date>'); process.exit(2); }
      cmdDaily(db, stock, date);
    } else if (cmd === 'range') {
      const [stock, maybeStart, maybeEnd] = rest;
      let start, end;
      if (args.flags.days) {
        end = args.flags.end || maybeStart;
        if (!end) { console.error('--days 需配合 --end <date> 或位置參數 <end>'); process.exit(2); }
        start = shiftDate(end, -(Number(args.flags.days) - 1));
      } else {
        start = maybeStart; end = maybeEnd;
        if (!stock || !start || !end) { console.error('用法：range <stock> <start> <end>'); process.exit(2); }
      }
      cmdRange(db, stock, start, end);
    } else {
      console.error('指令：daily | range');
      console.error('範例：');
      console.error('  node etf-tracker/cli.js daily 2330 2026-05-10');
      console.error('  node etf-tracker/cli.js range 2330 2026-05-09 2026-05-10');
      console.error('  node etf-tracker/cli.js range 2330 --days 2 --end 2026-05-10');
      process.exit(2);
    }
  } finally {
    db.close();
  }
}

main();
