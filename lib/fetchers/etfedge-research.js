// etfedge.xyz research fetcher — ONE-TIME / LOW-FREQUENCY ONLY
//
// ⚠️ 注意：etfedge.xyz robots.txt 明文 `Disallow: /preview/*.json$`
//    站方為個人開發者，此 endpoint 是他們不希望被機器人取的對象。
//
// 本 fetcher 的合理使用情境：
//   - 一次性研究：看資料結構、單次補歷史
//   - 個人非商業
//   - 不重新發佈站方資料
//
// 不應使用的情境：
//   - 寫進 cron / launchd 排程
//   - 高頻次（每小時、每分鐘）抓取
//   - 公開分享抓下來的 JSON 檔
//
// 使用者已知情並承擔自身決定的責任。
//
// 資料來源：GET https://etfedge.xyz/preview/<slug>.json
//   slug = etfCode.toLowerCase()
// payload 含 233+ 天歷史 series + current[]，每筆 series 點 = 該股一次持股變動。

async function fetchEtfedge(etfCode, { userAgent = 'etf-tracker-research/0.1' } = {}) {
  const slug = etfCode.toLowerCase();
  const url = `https://etfedge.xyz/preview/${slug}.json`;
  const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const data = await res.json();
  if (!data.etf || !data.series) throw new Error('unexpected payload shape (no etf/series)');

  const nameOf = data.name_of || {};
  const rows = [];
  // series.<stockCode>[] = [{date: "YYYYMMDD", weight, shares}, ...]
  for (const [stockCode, points] of Object.entries(data.series)) {
    for (const p of points) {
      if (!/^\d{8}$/.test(p.date || '')) continue;
      if (typeof p.shares !== 'number' || p.shares < 0) continue;
      const iso = `${p.date.slice(0,4)}-${p.date.slice(4,6)}-${p.date.slice(6,8)}`;
      rows.push({
        etf_code: etfCode,
        stock_code: stockCode,
        snapshot_date: iso,
        shares: p.shares,
        stock_name: nameOf[stockCode] || null,
        weight: typeof p.weight === 'number' ? p.weight : null,
      });
    }
  }

  return {
    etfCode,
    source: url,
    rows,
    skipped: 0,
    meta: {
      fundname: data.etf.name,
      issuer:   data.etf.issuer,
      nav:      null,
      n_days:   data.n_days,
      as_of:    data.as_of,
      first_date: data.first_date,
    },
  };
}

module.exports = { fetchEtfedge };
