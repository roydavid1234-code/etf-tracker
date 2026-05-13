// ETF 代號 → 發行投信 對應表（依 TWSE OpenAPI 基金基本資料彙總表 t187ap47_L）。
// 來源：https://openapi.twse.com.tw/v1/opendata/t187ap47_L
//
// fetcher 對應：目前只有 yuanta 已實作；其他家為 TODO。新增一家時：
//   1. 寫 lib/fetchers/<issuer>.js 匯出 fetch<Name>Pcf(etfCode)
//   2. 在下面 FETCHERS 加一筆
//
// 缺 fetcher 的家：CLI 會拋友善錯誤並建議走 CSV 匯入路徑。

const yuanta = require('./fetchers/yuanta');

// 投信名稱 → fetcher 函式（接 etfCode，回 {snapshotDate, rows, ...}）
const FETCHERS = {
  '元大': yuanta.fetchYuantaPcf,
  // '國泰': require('./fetchers/cathay').fetchCathayPcf,   // TODO: 國泰是 SPA，需要 Playwright
  // '統一': require('./fetchers/uitf').fetchUitfPcf,        // TODO
  // '群益': require('./fetchers/capital').fetchCapitalPcf,  // TODO
  // '復華': require('./fetchers/fhtrust').fetchFhtrustPcf,  // TODO
  // '中信': require('./fetchers/ctbc').fetchCtbcPcf,        // TODO
};

// ETF 代號 → 發行投信（持續擴充）
const ETF_TO_ISSUER = {
  // 元大
  '0050': '元大', '0056': '元大', '006207': '元大', '006208': '元大',
  '00692': '元大', '00713': '元大', '00878': '國泰',
  // 統一
  '00981A': '統一',
  // 群益
  '00992A': '群益',
  // 復華
  '00991A': '復華',
};

function getIssuer(etfCode) {
  return ETF_TO_ISSUER[etfCode] || null;
}

async function fetchByEtf(etfCode) {
  const issuer = getIssuer(etfCode);
  if (!issuer) throw new Error(
    `未知 ETF ${etfCode}。請先到 https://openapi.twse.com.tw/v1/opendata/t187ap47_L 查發行投信，更新 lib/issuers.js`
  );
  const fetcher = FETCHERS[issuer];
  if (!fetcher) throw new Error(
    `${etfCode} 是 ${issuer} 發行，但尚未有 fetcher（請手動下載 CSV 用 /api/ingest 灌）`
  );
  return fetcher(etfCode);
}

module.exports = { FETCHERS, ETF_TO_ISSUER, getIssuer, fetchByEtf };
