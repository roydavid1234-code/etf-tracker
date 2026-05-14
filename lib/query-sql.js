// SQL 版的聚合查詢。輸出格式與 lib/aggregate.js 純函式版完全一致，
// 用於整合測試 cross-check 兩種實作的結果。
//
// 依賴 SQLite 3.25+ 的 window function (LAG / ROW_NUMBER)。
// better-sqlite3 內建 SQLite >= 3.40，無問題。

/**
 * 對應 aggregate.dailyChangeForStock。
 * 排序規則：絕對變動降冪 → 同量買入優先 → etf_code 字典序。
 */
function dailyChangeForStockSql(db, stockCode, targetDate) {
  const sql = `
    WITH today AS (
      SELECT etf_code, shares, weight
      FROM holding_snapshot
      WHERE stock_code = @stock AND snapshot_date = @date
    ),
    prev_ranked AS (
      SELECT etf_code, shares, weight,
             ROW_NUMBER() OVER (PARTITION BY etf_code ORDER BY snapshot_date DESC) AS rn
      FROM holding_snapshot
      WHERE stock_code = @stock AND snapshot_date < @date
    ),
    prev AS (
      SELECT etf_code, shares, weight FROM prev_ranked WHERE rn = 1
    ),
    etfs AS (
      SELECT etf_code FROM today
      UNION
      SELECT etf_code FROM prev
    )
    SELECT
      e.etf_code,
      (COALESCE(t.shares, 0) - COALESCE(p.shares, 0)) AS change_shares,
      COALESCE(t.shares, 0) AS today_shares,
      t.weight AS today_weight,
      CASE WHEN t.weight IS NULL AND p.weight IS NULL THEN NULL
           ELSE COALESCE(t.weight, 0) - COALESCE(p.weight, 0) END AS weight_change
    FROM etfs e
    LEFT JOIN today t ON t.etf_code = e.etf_code
    LEFT JOIN prev  p ON p.etf_code = e.etf_code
    WHERE (COALESCE(t.shares, 0) - COALESCE(p.shares, 0)) != 0
    ORDER BY
      ABS(change_shares) DESC,
      CASE WHEN change_shares > 0 THEN 0 ELSE 1 END,  -- 同量買入優先
      e.etf_code ASC
  `;
  return db.prepare(sql).all({ stock: stockCode, date: targetDate });
}

/**
 * 對應 aggregate.rangeChangeForStock。
 * 用 LAG 算每筆對前筆的 diff，再篩到區間內，最後 JS 端 group by etf_code 加總。
 */
function rangeChangeForStockSql(db, stockCode, startDate, endDate) {
  if (startDate > endDate) throw new RangeError('startDate must be <= endDate');

  const sql = `
    WITH base AS (
      SELECT
        etf_code, snapshot_date, shares,
        LAG(shares, 1, 0) OVER (
          PARTITION BY etf_code ORDER BY snapshot_date
        ) AS prev_shares
      FROM holding_snapshot
      WHERE stock_code = @stock
    ),
    changes AS (
      SELECT etf_code, snapshot_date AS date, (shares - prev_shares) AS change, shares
      FROM base
      WHERE snapshot_date >= @start AND snapshot_date <= @end
        AND (shares - prev_shares) != 0
    ),
    -- 區間末：每 ETF 最後一筆 <= end
    endstate AS (
      SELECT etf_code, weight AS end_weight FROM (
        SELECT etf_code, weight,
               ROW_NUMBER() OVER (PARTITION BY etf_code ORDER BY snapshot_date DESC) AS rn
        FROM holding_snapshot
        WHERE stock_code = @stock AND snapshot_date <= @end
      ) WHERE rn = 1
    ),
    -- 區間前基準：每 ETF 最後一筆 < start
    baseline AS (
      SELECT etf_code, weight AS baseline_weight FROM (
        SELECT etf_code, weight,
               ROW_NUMBER() OVER (PARTITION BY etf_code ORDER BY snapshot_date DESC) AS rn
        FROM holding_snapshot
        WHERE stock_code = @stock AND snapshot_date < @start
      ) WHERE rn = 1
    )
    SELECT
      c.etf_code, c.date, c.change, c.shares,
      es.end_weight,
      CASE WHEN es.end_weight IS NULL AND bl.baseline_weight IS NULL THEN NULL
           ELSE COALESCE(es.end_weight, 0) - COALESCE(bl.baseline_weight, 0) END AS weight_change
    FROM changes c
    LEFT JOIN endstate es ON es.etf_code = c.etf_code
    LEFT JOIN baseline bl ON bl.etf_code = c.etf_code
    ORDER BY c.etf_code, c.date
  `;
  const rows = db.prepare(sql).all({ stock: stockCode, start: startDate, end: endDate });

  const byEtf = new Map(); // etf_code -> { daily, endShares, endWeight, weightChange }
  for (const r of rows) {
    if (!byEtf.has(r.etf_code)) {
      byEtf.set(r.etf_code, { daily: [], endShares: 0, endWeight: r.end_weight, weightChange: r.weight_change });
    }
    const acc = byEtf.get(r.etf_code);
    acc.daily.push({ date: r.date, change: r.change });
    acc.endShares = r.shares; // 最後一筆（rows ORDER BY date asc）= 區間末持有
  }

  const result = [];
  for (const [etf_code, { daily, endShares, endWeight, weightChange }] of byEtf) {
    const total_change = daily.reduce((acc, d) => acc + d.change, 0);
    result.push({
      etf_code, total_change, daily,
      end_shares: endShares, end_weight: endWeight, weight_change: weightChange,
    });
  }

  result.sort((a, b) => {
    const diff = Math.abs(b.total_change) - Math.abs(a.total_change);
    if (diff !== 0) return diff;
    if (Math.sign(b.total_change) !== Math.sign(a.total_change)) {
      return b.total_change - a.total_change;
    }
    return a.etf_code < b.etf_code ? -1 : a.etf_code > b.etf_code ? 1 : 0;
  });
  return result;
}

module.exports = { dailyChangeForStockSql, rangeChangeForStockSql };
