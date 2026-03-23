require("dotenv").config();
const express = require("express");
const multer = require("multer");
const db = require("./db");
const OpenAI = require("openai");
const cors = require("cors");

const app = express();
const upload = multer({ dest: "uploads/" });

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json());

app.use(cors());

/**
 * 生徒からの質問受付
 */
app.post("/chat", upload.single("image"), async (req, res) => {
  try {
    const { user_name, prompt } = req.body;
    const image = req.file;

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

    res.json({ answer });

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