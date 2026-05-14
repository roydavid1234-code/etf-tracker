// 把 snapshot 陣列寫入 SQLite。同 (etf, stock, date) 採 UPSERT。
// 同時自動補登 etf / stock 主檔（用 INSERT OR IGNORE）。

function ingestSnapshots(db, snapshots) {
  const upsertEtf   = db.prepare('INSERT OR IGNORE INTO etf (code) VALUES (?)');
  // 股票主檔：若新資料帶名稱就更新；沒帶就保留既有
  const upsertStock = db.prepare(`
    INSERT INTO stock (code, name) VALUES (?, ?)
    ON CONFLICT(code) DO UPDATE SET name = COALESCE(excluded.name, stock.name)
  `);
  const upsertSnap  = db.prepare(`
    INSERT INTO holding_snapshot (etf_code, stock_code, snapshot_date, shares, weight)
    VALUES (@etf_code, @stock_code, @snapshot_date, @shares, @weight)
    ON CONFLICT(etf_code, stock_code, snapshot_date)
    DO UPDATE SET shares = excluded.shares,
                  weight = COALESCE(excluded.weight, holding_snapshot.weight)
  `);

  const tx = db.transaction((rows) => {
    for (const s of rows) {
      upsertEtf.run(s.etf_code);
      upsertStock.run(s.stock_code, s.stock_name || null);
      upsertSnap.run({ ...s, weight: s.weight ?? null });
    }
  });
  tx(snapshots);
  return snapshots.length;
}

module.exports = { ingestSnapshots };
