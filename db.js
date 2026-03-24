const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./chat.db");

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