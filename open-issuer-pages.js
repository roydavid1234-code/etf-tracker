#!/usr/bin/env node
// 一鍵開所有指定 ETF 對應投信的揭露頁/官網。
// 找不到精準頁面的，用 Google search 當 fallback（點第一個結果通常就到）。
//
// 用法：
//   node open-issuer-pages.js                    # 開全部 7 支對應頁
//   node open-issuer-pages.js 00878 00981A       # 只開指定的
//   node open-issuer-pages.js --print            # 只列出 URL 不開瀏覽器

const { execSync } = require('child_process');
const { ETF_TO_ISSUER, getIssuer } = require('./lib/issuers');

// 各家投信的「最接近 ETF 持股揭露」入口。找不到精準頁的，用 Google search。
// 你常用的可以改成書籤式精準連結，省點滑鼠路徑。
const PAGE_OF = {
  // 元大：直接 PCF 頁，無需點選
  '元大': (etf) => `https://www.yuantaetfs.com/tradeInfo/pcf/${etf}`,

  // 國泰：首頁，需搜尋 ETF 代號
  '國泰': (etf) => `https://www.cathaysite.com.tw/`,

  // 群益：首頁
  '群益': (etf) => `https://www.capitalfund.com.tw/`,

  // 復華：ETF 專區
  '復華': (etf) => `https://www.fhtrust.com.tw/ETF`,

  // 中信：首頁
  '中信': (etf) => `https://www.ctbcinvestments.com.tw/`,

  // 統一：網域不確定，用 Google search 確保能找到
  '統一': (etf) => `https://www.google.com/search?q=${encodeURIComponent('統一投信 ' + etf + ' 持股 申購買回')}`,
};

function urlFor(etf) {
  const issuer = getIssuer(etf);
  if (!issuer) return { etf, issuer: null, url: `https://www.google.com/search?q=${encodeURIComponent(etf + ' ETF 持股')}` };
  const pageFn = PAGE_OF[issuer];
  if (!pageFn) return { etf, issuer, url: `https://www.google.com/search?q=${encodeURIComponent(issuer + ' 投信 ' + etf + ' 持股')}` };
  return { etf, issuer, url: pageFn(etf) };
}

function main() {
  const args = process.argv.slice(2);
  const printOnly = args.includes('--print');
  const etfs = args.filter(a => !a.startsWith('--'));
  const list = etfs.length > 0 ? etfs : Object.keys(ETF_TO_ISSUER);

  const entries = list.map(urlFor);

  console.log('ETF      投信   URL');
  console.log('─'.repeat(80));
  for (const { etf, issuer, url } of entries) {
    console.log(`${etf.padEnd(8)} ${(issuer || '?').padEnd(6)} ${url}`);
  }

  if (printOnly) return;
  console.log('\n開啟中…');
  for (const { url } of entries) {
    try { execSync(`open ${JSON.stringify(url)}`); } catch (e) { /* ignore */ }
  }
}

main();
