#!/usr/bin/env node
// One-time research CLI for etfedge.xyz data.
// 看 lib/fetchers/etfedge-research.js 開頭的 ⚠️ 警告。
//
// 用法（建議只跑一次）：
//   node fetch-etfedge.js 00981A 00988A 00990A 00991A 00992A 00995A --ingest
//
// 注意：每個 ETF ~1MB JSON，請勿頻繁重複抓。

const fs = require('fs');
const path = require('path');
const { fetchEtfedge } = require('./lib/fetchers/etfedge-research');

function parseArgs(argv) {
  const flags = { archive: false, ingest: false, server: 'http://localhost:3000' };
  const positional = [];
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
  const lines = ['etf_code,stock_code,snapshot_date,shares,stock_name'];
  for (const r of rows) {
    const name = ((r.stock_name || '') + '').replace(/[,\r\n]/g, '/').trim();
    lines.push(`${r.etf_code},${r.stock_code},${r.snapshot_date},${r.shares},${name}`);
  }
  return lines.join('\n');
}

(async () => {
  const { etfs, flags } = parseArgs(process.argv.slice(2));
  if (etfs.length === 0) {
    console.error('用法：node fetch-etfedge.js <etf-code> [...] [--archive] [--ingest]');
    process.exit(1);
  }

  console.error('⚠️  research fetch — etfedge.xyz robots.txt 明文不歡迎，請勿排程');

  const allRows = [];
  for (const etf of etfs) {
    try {
      const r = await fetchEtfedge(etf);
      console.error(
        `[${r.meta.first_date}~${r.meta.as_of}] ${etf} ${r.meta.fundname} (${r.meta.issuer}) — ` +
        `${r.rows.length} rows · ${r.meta.n_days} 交易日`
      );
      allRows.push(...r.rows);
      if (flags.archive) {
        const dir = path.join(__dirname, 'daily-snapshots', 'etfedge-research');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${etf}-${r.meta.as_of}.csv`);
        fs.writeFileSync(file, toCsv(r.rows));
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
    console.error(`\n✓ ingested ${data.ingested} rows; total in DB: ${data.total_rows}`);
  } catch (e) {
    console.error(`ingest failed: ${e.message}`);
    process.exit(3);
  }
})();
