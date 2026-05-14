#!/usr/bin/env node
// CLI：抓元大投信 ETF 持股，輸出 CSV 並可選自動歸檔 / 直接灌進 running server。
//
// 用法：
//   node etf-tracker/fetch-yuanta.js 0050              # 印到 stdout
//   node etf-tracker/fetch-yuanta.js 0050 0056         # 多支
//   node etf-tracker/fetch-yuanta.js 0050 --archive    # 同時存到 daily-snapshots/<date>/yuanta-0050.csv
//   node etf-tracker/fetch-yuanta.js 0050 --ingest     # 灌進 http://localhost:3000/api/ingest（含 --archive）
//   node etf-tracker/fetch-yuanta.js 0050 --ingest --server http://localhost:4000
//
// 注意：元大 PCF 揭露 T+1，每日只有「最新一日」可抓，無歷史日期參數。
// 排程：建議每工作日下午 5 點以後跑（盤後揭露完成）。

const fs = require('fs');
const path = require('path');
const { fetchYuantaPcf } = require('./lib/fetchers/yuanta');

function parseArgs(argv) {
  const positional = [];
  const flags = { archive: false, ingest: false, server: 'http://localhost:3000' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--archive') flags.archive = true;
    else if (a === '--ingest') { flags.ingest = true; flags.archive = true; }
    else if (a === '--server') flags.server = argv[++i];
    else if (a.startsWith('--')) { console.error(`unknown flag: ${a}`); process.exit(2); }
    else positional.push(a);
  }
  return { etfs: positional, flags };
}

function toCsv(rows) {
  const lines = ['etf_code,stock_code,snapshot_date,shares,stock_name,weight'];
  for (const r of rows) {
    const name = ((r.stock_name || '') + '').replace(/[,\r\n]/g, '/').trim();
    const weight = (r.weight == null) ? '' : r.weight;
    lines.push(`${r.etf_code},${r.stock_code},${r.snapshot_date},${r.shares},${name},${weight}`);
  }
  return lines.join('\n');
}

function archivePath(snapshotDate, etfCode) {
  const dir = path.join(__dirname, 'daily-snapshots', snapshotDate);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `yuanta-${etfCode}.csv`);
}

async function ingest(serverUrl, csv) {
  const res = await fetch(`${serverUrl}/api/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: csv,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

(async () => {
  const { etfs, flags } = parseArgs(process.argv.slice(2));
  if (etfs.length === 0) {
    console.error('用法：node fetch-yuanta.js <etf-code> [<etf-code> ...] [--archive] [--ingest] [--server URL]');
    process.exit(1);
  }

  const allRows = [];
  for (const etf of etfs) {
    try {
      const result = await fetchYuantaPcf(etf);
      console.error(
        `[${result.snapshotDate}] ${etf} ${result.meta.fundname} — ` +
        `${result.rows.length} 檔股票（skipped ${result.skipped}），nav ${result.meta.nav}`
      );
      allRows.push(...result.rows);

      if (flags.archive) {
        const file = archivePath(result.snapshotDate, etf);
        fs.writeFileSync(file, toCsv(result.rows));
        console.error(`  → archived: ${path.relative(process.cwd(), file)}`);
      }
    } catch (e) {
      console.error(`[ERR] ${etf}: ${e.message}`);
    }
  }

  // 不用 --ingest 時印 CSV 到 stdout（向後相容 pipe 用法）
  if (!flags.ingest) {
    console.log(toCsv(allRows));
    return;
  }

  // --ingest：把所有 rows 一次灌進 server
  try {
    const result = await ingest(flags.server, toCsv(allRows));
    console.error(`✓ ingested ${result.ingested} rows into ${flags.server}; total in DB: ${result.total_rows}`);
  } catch (e) {
    console.error(`ingest failed: ${e.message}`);
    process.exit(3);
  }
})();
