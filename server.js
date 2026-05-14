// 最小 HTTP server。Node 內建 http，無新依賴。
// 啟動：node etf-tracker/server.js  或  npm run etf:server
// 預設 port 3000，可用 PORT=4000 覆蓋。
//
// 路由：
//   GET /                      → public/index.html
//   GET /api/daily?stock=&date=
//   GET /api/range?stock=&start=&end=
//   GET /api/range?stock=&days=N&end=

const http = require('http');
const fs = require('fs');
const path = require('path');

const { openDb } = require('./lib/db');
const { ingestSnapshots } = require('./lib/ingest');
const { dailyChangeForStockSql, rangeChangeForStockSql } = require('./lib/query-sql');
const {
  splitBuySell,
  dailyChangeForStock, rangeChangeForStock,
  dailyChangeForEtf, rangeChangeForEtf,
  addedStocksOnDate,
} = require('./lib/aggregate');
const { sharesToLots } = require('./lib/unit');
const { snapshotsAllEtfs, ETF_LIST } = require('./test/fixture');

// ─── DB 啟動 ───────────────────────────────────────────────────────────────
// 預設使用檔案 SQLite，重啟保留資料。:memory: 仍可選（測試用）。
//   ETF_DB_PATH     覆蓋 DB 檔路徑
//   ETF_DB_RESET=1  啟動前刪除 DB（重新從 fixture 灌）
const DB_PATH = process.env.ETF_DB_PATH || path.join(__dirname, 'data', 'etf.sqlite');
const useMemory = DB_PATH === ':memory:';
if (!useMemory) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (process.env.ETF_DB_RESET === '1' && !useMemory && fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
  console.log(`[reset] removed ${DB_PATH}`);
}

const isNewDb = useMemory || !fs.existsSync(DB_PATH);
const db = openDb(DB_PATH);

// 首次啟動才灌 fixture；既有檔保持原樣不污染
// ETF_DB_NO_SEED=1 即使新 DB 也跳過 fixture（純真實模式）
const skipSeed = process.env.ETF_DB_NO_SEED === '1';
if (isNewDb && !skipSeed) {
  ingestSnapshots(db, [...snapshotsAllEtfs]);
  console.log(`[init] seeded fixture into new DB (${DB_PATH})`);
} else if (isNewDb && skipSeed) {
  console.log(`[init] new DB, fixture seed SKIPPED (ETF_DB_NO_SEED=1)`);
} else {
  console.log(`[init] using existing DB (${DB_PATH})`);
}

// 從 DB 載入 snapshots 陣列供純函式查詢使用（ETF 視角、added-stocks）
let snapshots = db.prepare(
  'SELECT etf_code, stock_code, snapshot_date, shares, weight FROM holding_snapshot'
).all();
console.log(`[init] loaded ${snapshots.length} snapshot rows`);

// 給 CSV 匯入用：把新資料同步推入 snapshots 與 db。
function appendSnapshots(rows) {
  ingestSnapshots(db, rows);
  // 避免重複（同 key 視為覆蓋）
  const keyOf = r => `${r.etf_code}|${r.stock_code}|${r.snapshot_date}`;
  const incoming = new Map(rows.map(r => [keyOf(r), r]));
  snapshots = snapshots.filter(s => !incoming.has(keyOf(s)));
  snapshots.push(...rows);
  return rows.length;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function shiftDate(isoDate, deltaDays) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function parseCsvList(param) {
  if (!param) return null;
  const out = param.split(',').map(s => s.trim()).filter(Boolean);
  return out.length ? out : null;
}

function filterByEtfs(rows, etfList) {
  if (!etfList) return rows;
  const set = new Set(etfList);
  return rows.filter(r => set.has(r.etf_code));
}

function withLots(item) {
  if ('change_shares' in item) {                  // daily 結果
    return {
      ...item,
      change_lots: sharesToLots(item.change_shares),
      today_lots: item.today_shares != null ? sharesToLots(item.today_shares) : null,
    };
  }
  if (Array.isArray(item.etfs)) {                 // addedStocksOnDate 結果
    return {
      ...item,
      total_lots: sharesToLots(item.total_change),
      etfs: item.etfs.map(e => ({ ...e, change_lots: sharesToLots(e.change_shares) })),
    };
  }
  // range 結果
  return {
    ...item,
    total_lots: sharesToLots(item.total_change),
    end_lots: item.end_shares != null ? sharesToLots(item.end_shares) : null,
    daily: item.daily.map(d => ({ ...d, change_lots: sharesToLots(d.change) })),
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // 個股視角：?stock= 或 ?stocks=a,b,c；?etfs= 為可選 filter
    if (req.method === 'GET' && url.pathname === '/api/daily') {
      const stocks = parseCsvList(url.searchParams.get('stocks'))
                 ?? (url.searchParams.get('stock') ? [url.searchParams.get('stock')] : null);
      const date   = url.searchParams.get('date');
      if (!stocks || stocks.length === 0) return sendJson(res, 400, { error: 'stock or stocks required' });
      if (!date) return sendJson(res, 400, { error: 'date required' });

      const etfFilter = parseCsvList(url.searchParams.get('etfs'));
      const src = filterByEtfs(snapshots, etfFilter);

      const oneStock = (s) => {
        // 有 etfFilter 時走純函式（吃 filtered array）；無 filter 仍可用 SQL
        const items = etfFilter
          ? dailyChangeForStock(src, s, date).map(withLots)
          : dailyChangeForStockSql(db, s, date).map(withLots);
        return {
          stock: s,
          buys:  items.filter(r => r.change_shares > 0),
          sells: items.filter(r => r.change_shares < 0),
        };
      };

      // 單 stock 且無多選參數、無 etfFilter 保留舊形狀以維持 curl 範例相容
      if (stocks.length === 1 && !url.searchParams.get('stocks') && !etfFilter) {
        return sendJson(res, 200, { date, ...oneStock(stocks[0]) });
      }
      return sendJson(res, 200, { stocks, date, etfFilter, results: stocks.map(oneStock) });
    }

    if (req.method === 'GET' && url.pathname === '/api/range') {
      const stocks = parseCsvList(url.searchParams.get('stocks'))
                 ?? (url.searchParams.get('stock') ? [url.searchParams.get('stock')] : null);
      let start = url.searchParams.get('start');
      let end   = url.searchParams.get('end');
      const days = url.searchParams.get('days');
      if (!stocks || stocks.length === 0) return sendJson(res, 400, { error: 'stock or stocks required' });
      if (days && end) start = shiftDate(end, -(Number(days) - 1));
      if (!start || !end) return sendJson(res, 400, { error: 'need (start,end) or (days,end)' });

      const etfFilter = parseCsvList(url.searchParams.get('etfs'));
      const src = filterByEtfs(snapshots, etfFilter);

      const oneStock = (s) => {
        const items = etfFilter
          ? rangeChangeForStock(src, s, start, end).map(withLots)
          : rangeChangeForStockSql(db, s, start, end).map(withLots);
        const { buys, sells, flat } = splitBuySell(items);
        return { stock: s, buys, sells, flat };
      };

      if (stocks.length === 1 && !url.searchParams.get('stocks') && !etfFilter) {
        return sendJson(res, 200, { start, end, ...oneStock(stocks[0]) });
      }
      return sendJson(res, 200, { stocks, start, end, etfFilter, results: stocks.map(oneStock) });
    }

    // 提供前端 UI 用的 ETF 清單（ETF_LIST 為主，再合併 DB 中已出現的）
    if (req.method === 'GET' && url.pathname === '/api/etfs/list') {
      const fromDb = db.prepare(
        'SELECT DISTINCT etf_code FROM holding_snapshot ORDER BY etf_code'
      ).all().map(r => r.etf_code);
      const merged = [...ETF_LIST];
      for (const e of fromDb) if (!merged.includes(e)) merged.push(e);
      return sendJson(res, 200, { etfs: merged });
    }

    // 立即刷新：抓 yuanta + etfedge 所有 ETF，灌進 DB
    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      const yuantaList = ['0050', '0056'];
      const etfedgeList = ['00981A', '00987A', '00991A', '00992A', '00994A'];
      const { fetchYuantaPcf } = require('./lib/fetchers/yuanta');
      const { fetchEtfedge } = require('./lib/fetchers/etfedge-research');
      (async () => {
        const all = [];
        const errors = [];
        for (const etf of yuantaList) {
          try { const r = await fetchYuantaPcf(etf); all.push(...r.rows); }
          catch (e) { errors.push({ source: 'yuanta', etf, err: e.message }); }
        }
        for (const etf of etfedgeList) {
          try { const r = await fetchEtfedge(etf); all.push(...r.rows); }
          catch (e) { errors.push({ source: 'etfedge', etf, err: e.message }); }
        }
        if (all.length) appendSnapshots(all);
        sendJson(res, 200, { ingested: all.length, errors, total_rows: snapshots.length });
      })().catch(e => sendJson(res, 500, { error: e.message }));
      return;
    }

    // 所有有資料的日期（給日曆 widget 高亮用）
    if (req.method === 'GET' && url.pathname === '/api/dates') {
      const rows = db.prepare(
        'SELECT DISTINCT snapshot_date AS date FROM holding_snapshot ORDER BY snapshot_date'
      ).all();
      return sendJson(res, 200, { dates: rows.map(r => r.date) });
    }

    // DB 狀態檢視
    if (req.method === 'GET' && url.pathname === '/api/db-info') {
      const row = db.prepare(`
        SELECT COUNT(*) AS rows,
               MIN(snapshot_date) AS min_date,
               MAX(snapshot_date) AS max_date,
               COUNT(DISTINCT etf_code) AS etfs,
               COUNT(DISTINCT stock_code) AS stocks
        FROM holding_snapshot
      `).get();
      return sendJson(res, 200, { db_path: useMemory ? ':memory:' : DB_PATH, ...row });
    }

    // 提供前端 UI 用的「目前還被 ETF 持有」股票清單（含名稱）
    // 邏輯：對每個 ETF 取其自己的最新 snapshot_date，當天有持股的股票才入清單。
    // 已被全部 ETF 出清的股票（不在任何 ETF 的最新一日揭露）自動排除。
    if (req.method === 'GET' && url.pathname === '/api/stocks/list') {
      const stocks = db.prepare(`
        WITH etf_latest AS (
          SELECT etf_code, MAX(snapshot_date) AS max_date
          FROM holding_snapshot GROUP BY etf_code
        )
        SELECT DISTINCT h.stock_code AS code, s.name
        FROM holding_snapshot h
        JOIN etf_latest e ON e.etf_code = h.etf_code AND e.max_date = h.snapshot_date
        LEFT JOIN stock s ON s.code = h.stock_code
        WHERE h.shares > 0
        ORDER BY h.stock_code
      `).all();
      return sendJson(res, 200, { stocks });
    }

    // ETF 視角：單支或多支（?etf=00981A 或 ?etfs=00981A,00992A）
    // 單日 / 區間 / 近 N 日皆通。多支時回傳 { results: [{etf, ...}, ...] }
    if (req.method === 'GET' && url.pathname === '/api/etf') {
      const etfsParam = url.searchParams.get('etfs');
      const etfParam  = url.searchParams.get('etf');
      const etfs = etfsParam
        ? etfsParam.split(',').map(s => s.trim()).filter(Boolean)
        : (etfParam ? [etfParam] : []);
      if (etfs.length === 0) return sendJson(res, 400, { error: 'etf or etfs required' });

      const date = url.searchParams.get('date');
      let start  = url.searchParams.get('start');
      let end    = url.searchParams.get('end');
      const days = url.searchParams.get('days');
      if (days && end) start = shiftDate(end, -(Number(days) - 1));

      const oneEtfResult = (etfCode) => {
        if (date) {
          const items = dailyChangeForEtf(snapshots, etfCode, date).map(withLots);
          return {
            etf: etfCode, mode: 'daily', date,
            buys:  items.filter(r => r.change_shares > 0),
            sells: items.filter(r => r.change_shares < 0),
          };
        }
        if (!start || !end) throw new Error('need date, or (start,end), or (days,end)');
        const items = rangeChangeForEtf(snapshots, etfCode, start, end).map(withLots);
        const { buys, sells, flat } = splitBuySell(items);
        return { etf: etfCode, mode: 'range', start, end, buys, sells, flat };
      };

      // 單支保留舊回傳形狀以便相容 curl 範例與舊測試
      if (etfs.length === 1 && !etfsParam) {
        return sendJson(res, 200, oneEtfResult(etfs[0]));
      }
      const results = etfs.map(oneEtfResult);
      return sendJson(res, 200, { etfs, results });
    }

    // 全市場：當日有 ETF 買入的所有股票（可選多 ETF 過濾）
    if (req.method === 'GET' && url.pathname === '/api/added-stocks') {
      const date = url.searchParams.get('date');
      if (!date) return sendJson(res, 400, { error: 'date required' });
      const newOnly = url.searchParams.get('newOnly') === 'true';
      const etfsParam = url.searchParams.get('etfs');
      const etfFilter = etfsParam
        ? etfsParam.split(',').map(s => s.trim()).filter(Boolean)
        : null;
      const items = addedStocksOnDate(snapshots, date, { newOnly, etfFilter }).map(withLots);
      return sendJson(res, 200, { date, newOnly, etfFilter, items });
    }

    // CSV 匯入（POST text/csv）— 後續 UI 也提供 ingest 入口
    if (req.method === 'POST' && url.pathname === '/api/ingest') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          const rows = parseCsvSnapshots(text);
          const n = appendSnapshots(rows);
          sendJson(res, 200, { ingested: n, total_rows: snapshots.length });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    // 從遠端 URL 抓 CSV 匯入（server-side fetch）
    // 限制：只允許 http(s)，10 秒 timeout，1 MB 上限
    if (req.method === 'POST' && url.pathname === '/api/ingest-url') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!body.url) throw new Error('url required');
          const u = new URL(body.url);
          if (!/^https?:$/.test(u.protocol)) throw new Error('only http(s) allowed');

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          let text;
          try {
            const r = await fetch(u, {
              signal: controller.signal,
              headers: { 'User-Agent': 'etf-tracker/0.1 (+research)' },
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            if (buf.byteLength > 1024 * 1024) throw new Error('payload > 1 MB');
            text = new TextDecoder('utf-8').decode(buf);
          } finally {
            clearTimeout(timer);
          }
          const rows = parseCsvSnapshots(text);
          const n = appendSnapshots(rows);
          sendJson(res, 200, { source: u.toString(), ingested: n, total_rows: snapshots.length });
        } catch (e) {
          sendJson(res, 400, { error: e.message });
        }
      });
      return;
    }

    res.writeHead(404).end();
  } catch (e) {
    const status = (e instanceof RangeError || e instanceof TypeError) ? 400 : 500;
    sendJson(res, status, { error: e.message });
  }
});

// CSV → snapshot rows
// 表頭：etf_code,stock_code,snapshot_date,shares[,stock_name]
function parseCsvSnapshots(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('CSV empty');
  const header = lines[0].split(',').map(s => s.trim().toLowerCase());
  const required = ['etf_code', 'stock_code', 'snapshot_date', 'shares'];
  for (const c of required) {
    if (!header.includes(c)) throw new Error(`CSV header missing: ${c}`);
  }
  const idx = {
    etf_code:      header.indexOf('etf_code'),
    stock_code:    header.indexOf('stock_code'),
    snapshot_date: header.indexOf('snapshot_date'),
    shares:        header.indexOf('shares'),
    stock_name:    header.indexOf('stock_name'), // -1 if absent
    weight:        header.indexOf('weight'),     // -1 if absent
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    const shares = parseInt(cols[idx.shares], 10);
    if (!Number.isInteger(shares) || shares < 0) {
      throw new Error(`Row ${i + 1}: shares must be non-negative integer`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cols[idx.snapshot_date])) {
      throw new Error(`Row ${i + 1}: snapshot_date must be YYYY-MM-DD`);
    }
    let weight = null;
    if (idx.weight >= 0 && cols[idx.weight] !== '' && cols[idx.weight] != null) {
      const w = parseFloat(cols[idx.weight]);
      weight = Number.isFinite(w) ? w : null;
    }
    rows.push({
      etf_code:      cols[idx.etf_code],
      stock_code:    cols[idx.stock_code],
      snapshot_date: cols[idx.snapshot_date],
      shares,
      stock_name:    idx.stock_name >= 0 ? (cols[idx.stock_name] || null) : null,
      weight,
    });
  }
  return rows;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ETF tracker server on http://localhost:${PORT}`);
  console.log(`DB: ${useMemory ? ':memory:' : DB_PATH}`);
  console.log('管理：');
  console.log('  npm run server:reset    # 重灌 fixture');
  console.log('  npm run server:clean    # 清空 (純真實模式)');
  console.log('  curl ' + `http://localhost:${PORT}` + '/api/db-info  # 看 DB 狀態');
});
