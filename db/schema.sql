-- 單位約定：shares 一律存「股數」(INTEGER)。1 張 = 1000 股。
-- 不存浮點，避免累加誤差。顯示層再除以 1000 轉「張」。
-- snapshot_date 用 ISO 字串 'YYYY-MM-DD'，SQLite 對其排序與比較皆為字典序，等價於日期序。

CREATE TABLE IF NOT EXISTS etf (
  code         TEXT PRIMARY KEY,           -- 例：'00981A'
  name         TEXT,
  inception_at TEXT                        -- 'YYYY-MM-DD'
);

CREATE TABLE IF NOT EXISTS stock (
  code TEXT PRIMARY KEY,                   -- 例：'2330'
  name TEXT
);

-- 核心表：每日「持股快照」。每 (etf, stock, date) 唯一一筆。
-- 「買入/賣出」不直接儲存，由相鄰日 shares 差算出 → 單一事實來源。
CREATE TABLE IF NOT EXISTS holding_snapshot (
  etf_code      TEXT    NOT NULL,
  stock_code    TEXT    NOT NULL,
  snapshot_date TEXT    NOT NULL,          -- 'YYYY-MM-DD'
  shares        INTEGER NOT NULL CHECK (shares >= 0),
  weight        REAL,                      -- 0~1，可選；來源若有就存
  market_value  INTEGER,                   -- 可選；台幣元
  PRIMARY KEY (etf_code, stock_code, snapshot_date),
  FOREIGN KEY (etf_code)   REFERENCES etf(code),
  FOREIGN KEY (stock_code) REFERENCES stock(code)
);

CREATE INDEX IF NOT EXISTS idx_snap_stock_date ON holding_snapshot(stock_code, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snap_date       ON holding_snapshot(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snap_etf_date   ON holding_snapshot(etf_code, snapshot_date);
