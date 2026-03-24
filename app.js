require("dotenv").config();
const express = require("express");
const multer = require("multer");
const db = require("./db");
const OpenAI = require("openai");
const cors = require("cors");

const app = express();

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

const upload = multer({ dest: "uploads/" });

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

    const todayCount = await countTodayRequests(user_name);

    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: `1日の利用回数は${DAILY_LIMIT}回までです`
      });
    }

    // OpenAIへ送信（FTモデル）
    const response = await client.responses.create({
        model: "gpt-5.4-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            ...(image
              ? [{ type: "input_image", image_url: `file://${image.path}` }]
              : [])
          ]
        }
      ]
    });

    const answer = response.output_text;

    // DB保存
    db.run(
      `INSERT INTO chats (user_name, prompt, image_path, response)
       VALUES (?, ?, ?, ?)`,
      [user_name, prompt, image?.path || null, answer]
    );

    res.json({
      answer,
      remaining: DAILY_LIMIT - (todayCount + 1)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "エラー発生" });
  }
});

/**
 * コーチ用：履歴取得
 */
app.get("/chats", (req, res) => {
  db.all("SELECT * FROM chats ORDER BY created_at DESC", (err, rows) => {
    res.json(rows);
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