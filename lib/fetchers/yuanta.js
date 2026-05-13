// 元大投信 ETF 每日 PCF (Portfolio Composition File) fetcher。
//
// 資料源：https://www.yuantaetfs.com/tradeInfo/pcf/<ETF_CODE>
//   - 元大投信 robots.txt: User-agent:* Allow:/ — 個人研究 OK；商業/高頻請另行洽詢。
//   - Nuxt.js SSR：完整資料嵌在 HTML 內 window.__NUXT__ IIFE，無需 headless browser。
//
// 欄位對應：
//   pcfData.FundWeights.StockWeights[]
//     - code:    股票代號（4~6 位數字）
//     - name:    中文名
//     - weights: 權重 (%)
//     - qty:     ETF 持有股數（「股」單位；我們的 schema 也用股）
//     - ym:      期貨月份（非 null 代表是期貨而非個股，要排除）
//   pcfData.PCF.trandate:  YYYYMMDD 交易日
//
// 注意：StockWeights 可能含期貨（如台股期貨），用 ym 與 code 樣式雙重排除。

const vm = require('vm');

// 接受台股代號 (4 位數)、ETF (6 位)、槓桿反向有英文後綴，以及含國別後綴的海外股票
// 例如 "MU US" (美股 Micron)、"5706 JP" (日股三井金屬)、"285A JP"。
// 排除空字串與純空白。
const STOCK_CODE_RE = /^[0-9A-Za-z][0-9A-Za-z\s\.\-]{0,15}$/;

async function fetchYuantaPcf(etfCode, { userAgent = 'etf-tracker/0.1 (+research)' } = {}) {
  const url = `https://www.yuantaetfs.com/tradeInfo/pcf/${etfCode}`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const html = await res.text();

  const m = html.match(/window\.__NUXT__\s*=\s*(\(function[\s\S]*?\}\(.*?\)\));<\/script>/);
  if (!m) throw new Error('NUXT payload not found — site structure may have changed');

  // 用 vm 跑 IIFE 取得 data 物件。不是真正沙箱（Node 官方說 vm 非安全邊界），
  // 但比直接 eval() 稍微好控制，且 timeout 防止無限迴圈。
  const ctx = vm.createContext({});
  const data = vm.runInContext(m[1], ctx, { timeout: 2000 });

  if (!data || !data.data || !data.data[1] || !data.data[1].pcfData) {
    throw new Error('pcfData not found in NUXT payload');
  }
  const pcf = data.data[1].pcfData;
  const trandate = pcf.PCF && pcf.PCF.trandate;
  if (!/^\d{8}$/.test(trandate || '')) throw new Error(`unexpected trandate: ${trandate}`);
  const snapshotDate = `${trandate.slice(0,4)}-${trandate.slice(4,6)}-${trandate.slice(6,8)}`;

  const weights = (pcf.FundWeights && pcf.FundWeights.StockWeights) || [];
  const rows = [];
  let skipped = 0;
  for (const w of weights) {
    if (!w || w.ym != null) { skipped++; continue; }        // 排除期貨
    if (!w.code || !STOCK_CODE_RE.test(w.code)) { skipped++; continue; }
    if (typeof w.qty !== 'number' || w.qty < 0) { skipped++; continue; }
    rows.push({
      etf_code: etfCode,
      stock_code: w.code,
      snapshot_date: snapshotDate,
      shares: w.qty,
      stock_name: w.name || null,
    });
  }

  return {
    etfCode,
    snapshotDate,
    source: url,
    rows,
    skipped,
    meta: {
      fundname: pcf.PCF.fundname,
      nav: pcf.PCF.nav,
      totalav: pcf.PCF.totalav,
      anndate: pcf.PCF.anndate,
    },
  };
}

module.exports = { fetchYuantaPcf };
