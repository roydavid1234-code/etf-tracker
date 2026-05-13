#!/usr/bin/env node
// 把 daily-snapshots/*/*.csv 全部灌進 running server。
// 用於 server 重啟後重建完整歷史，或一次匯入多日累積資料。
//
// 用法：
//   node etf-tracker/reingest-all.js
//   node etf-tracker/reingest-all.js --server http://localhost:4000

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const flags = { server: 'http://localhost:3000' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--server') flags.server = argv[++i];
  }
  return flags;
}

(async () => {
  const flags = parseArgs(process.argv.slice(2));
  const root = path.join(__dirname, 'daily-snapshots');
  if (!fs.existsSync(root)) {
    console.error(`No archive dir: ${root}`);
    process.exit(0);
  }

  const dateDirs = fs.readdirSync(root).sort();
  if (dateDirs.length === 0) {
    console.error('Archive empty.');
    return;
  }

  let totalIngested = 0;
  for (const date of dateDirs) {
    const dir = path.join(root, date);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.csv'));
    for (const f of files) {
      const csv = fs.readFileSync(path.join(dir, f), 'utf8');
      try {
        const res = await fetch(`${flags.server}/api/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: csv,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        totalIngested += data.ingested;
        console.error(`  ${date}/${f}: +${data.ingested} rows (total ${data.total_rows})`);
      } catch (e) {
        console.error(`  ${date}/${f}: FAILED — ${e.message}`);
      }
    }
  }
  console.error(`\nDone. Total ingested: ${totalIngested}`);
})();
