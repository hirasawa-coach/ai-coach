const sqlite3 = require("sqlite3").verbose();
const path = require("path");

// 本番（Render）ではPersistent Diskの /data を使う
// ローカルではプロジェクト配下のchat.dbを使う
const dbPath = process.env.NODE_ENV === "production"
  ? "/data/chat.db"
  : path.join(__dirname, "chat.db");

console.log("DB path:", dbPath);

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT,
      prompt TEXT,
      image_path TEXT,
      response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_chats_user_created_at
    ON chats (user_name, created_at)
  `);
});

module.exports = db;