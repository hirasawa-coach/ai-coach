require("dotenv").config();
const express = require("express");
const multer = require("multer");
const db = require("./db");
const OpenAI = require("openai");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();

const COOLDOWN_MS = 2000; // 2秒
const lastRequestMap = new Map();

const DAILY_LIMIT = 10;
const MAX_PROMPT_LENGTH = 500;

function getJSTDateString() {
  const now = new Date();
  const jst = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })
  );
  const yyyy = jst.getFullYear();
  const mm = String(jst.getMonth() + 1).padStart(2, "0");
  const dd = String(jst.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function countTodayRequests(userName) {
  return new Promise((resolve, reject) => {
    const today = getJSTDateString();

    const sql = `
      SELECT COUNT(*) as count
      FROM chats
      WHERE user_name = ?
      AND date(created_at, '+9 hours') = ?
    `;

    db.get(sql, [userName, today], (err, row) => {
      if (err) return reject(err);
      resolve(row.count);
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 5 * 1024 * 1024 }
});

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json());

const allowedOrigins = [
  "https://hira-ai-coach.com",
  "https://www.hira-ai-coach.com"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("CORS not allowed: " + origin));
  }
}));

/**
 * 生徒からの質問受付
 */
app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { user_name, prompt } = req.body;
    const image = req.file;

    if (!user_name || !prompt) {
      return res.status(400).json({ error: "user_name と prompt は必須です" });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        error: `入力は${MAX_PROMPT_LENGTH}文字以内にしてください`
      });
    }

    // 2秒クールダウンチェック
    const now = Date.now();
    const lastTime = lastRequestMap.get(user_name) || 0;

    if (now - lastTime < COOLDOWN_MS) {
      return res.status(429).json({
        error: "送信間隔が短すぎます。2秒待ってから再度送信してください。"
      });
    }

    // 記録
    lastRequestMap.set(user_name, now);

    const todayCount = await countTodayRequests(user_name);

    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `1日の利用回数は${DAILY_LIMIT}回までです`
      });
    }

    let userContent = [
      { type: "input_text", text: prompt }
    ];

    if (image) {
      const mimeType = image.mimetype;

      const allowedMimeTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
      ];

      if (!allowedMimeTypes.includes(mimeType)) {
        return res.status(400).json({
          error: "画像は JPG / PNG / WEBP / GIF のみ対応しています。iPhoneの場合はスクリーンショットで送信してください。"
        });
      }

      const imageBuffer = fs.readFileSync(image.path);
      const base64Image = imageBuffer.toString("base64");

      userContent.push({
        type: "input_image",
        image_url: `data:${mimeType};base64,${base64Image}`
      });
    }

    const response = await client.responses.create({
      model: "gpt-5.4-mini",
      input: [
        {
          role: "user",
          content: userContent
        }
      ]
    });

    const answer = response.output_text || "回答を取得できませんでした。";

    // DB保存
    db.run(
      `INSERT INTO chats (user_name, prompt, image_path, response)
       VALUES (?, ?, ?, ?)`,
      [user_name, prompt, image?.path || null, answer]
    );

    if (image?.path) {
      fs.unlink(image.path, (unlinkErr) => {
        if (unlinkErr) {
          console.error("画像ファイル削除エラー:", unlinkErr);
        }
      });
    }

    res.json({
      answer,
      remaining: DAILY_LIMIT - (todayCount + 1)
    });

  } catch (err) {
    console.error(err);

    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "画像サイズは5MB以下にしてください。"
      });
    }

    return res.status(500).json({
      error: err?.message || "サーバーエラーが発生しました。"
    });
  }
});

/**
 * コーチ用：履歴取得
 */
app.get("/chats", (req, res) => {
  db.all("SELECT * FROM chats ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).send("DB error");
    }

    const html = `
      <!DOCTYPE html>
      <html lang="ja">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>チャット履歴</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              max-width: 960px;
              margin: 24px auto;
              padding: 0 16px;
              line-height: 1.7;
              background: #f7f7f7;
              color: #222;
            }
            h1 {
              margin-bottom: 24px;
            }
            .chat {
              background: #fff;
              border: 1px solid #ddd;
              border-radius: 10px;
              padding: 16px;
              margin-bottom: 16px;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            }
            .meta {
              color: #666;
              font-size: 14px;
              margin-bottom: 12px;
            }
            .label {
              font-weight: 700;
              margin: 12px 0 6px;
            }
            pre {
              white-space: pre-wrap;
              word-break: break-word;
              background: #fafafa;
              border: 1px solid #eee;
              border-radius: 8px;
              padding: 12px;
              margin: 0;
            }
            .image-path {
              font-size: 13px;
              color: #555;
            }
            .empty {
              color: #666;
              background: #fff;
              border: 1px solid #ddd;
              border-radius: 10px;
              padding: 16px;
            }
          </style>
        </head>
        <body>
          <h1>チャット履歴</h1>
          ${rows.length === 0 ? '<div class="empty">まだ履歴がありません。</div>' : rows.map((row) => `
            <section class="chat">
              <div class="meta">ユーザ名: ${escapeHtml(row.user_name || "")} / 日時: ${escapeHtml(row.created_at || "")}</div>
              <div class="label">質問</div>
              <pre>${escapeHtml(row.prompt || "")}</pre>
              <div class="label">回答</div>
              <pre>${escapeHtml(row.response || "")}</pre>
              ${row.image_path ? `<div class="label">画像保存パス</div><pre class="image-path">${escapeHtml(row.image_path)}</pre>` : ""}
            </section>
          `).join("")}
        </body>
      </html>
    `;

    res.send(html);
  });
});

app.get("/", (req, res) => {
    res.send("AI Coach API is running");
  });
  
  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running"));