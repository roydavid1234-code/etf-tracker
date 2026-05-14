#!/usr/bin/env node
// 統一 fetcher CLI：依 ETF 代號自動 dispatch 到對應投信 fetcher。
//
// 用法：
//   node etf-tracker/fetch.js 0050 0056 00990A --ingest
//   node etf-tracker/fetch.js 00878 00981A         (未有 fetcher 會友善報錯)
//
// 與 fetch-yuanta.js 區別：fetch-yuanta 只走元大；本檔自動辨識投信。

const fs = require('fs');
const path = require('path');
const { fetchByEtf, getIssuer } = require('./lib/issuers');

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

function archivePath(snapshotDate, etfCode, issuer) {
  const dir = path.join(__dirname, 'daily-snapshots', snapshotDate);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${issuer || 'unknown'}-${etfCode}.csv`);
}

(async () => {
  const { etfs, flags } = parseArgs(process.argv.slice(2));
  if (etfs.length === 0) {
    console.error('用法：node fetch.js <etf-code> [<etf-code> ...] [--archive] [--ingest]');
    process.exit(1);
  }

  const allRows = [];
  for (const etf of etfs) {
    const issuer = getIssuer(etf);
    try {
      const result = await fetchByEtf(etf);
      console.error(
        `[${result.snapshotDate}] ${etf} (${issuer}) ${result.meta.fundname} — ` +
        `${result.rows.length} 檔，nav ${result.meta.nav}`
      );
      allRows.push(...result.rows);
      if (flags.archive) {
        const file = archivePath(result.snapshotDate, etf, issuer);
        fs.writeFileSync(file, toCsv(result.rows));
        console.error(`  → archived: ${path.relative(process.cwd(), file)}`);
      }
    } catch (e) {
      console.error(`[ERR] ${etf}: ${e.message}`);
    }
  }

  if (!flags.ingest) { console.log(toCsv(allRows)); return; }

  try {
    const res = await fetch(`${flags.server}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: toCsv(allRows),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    console.error(`✓ ingested ${data.ingested} rows into ${flags.server}; total in DB: ${data.total_rows}`);
  } catch (e) {
    console.error(`ingest failed: ${e.message}`);
    process.exit(3);
  }
})();
