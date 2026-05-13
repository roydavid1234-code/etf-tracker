// SQLite 連線工廠。預設 in-memory，整合測試用；正式可傳檔案路徑。
// 載入時自動執行 schema.sql 建表。

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function openDb(filename = ':memory:') {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(ddl);
  return db;
}

module.exports = { openDb };
