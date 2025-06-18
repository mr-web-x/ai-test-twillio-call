// server.js

const express = require("express");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const { transcribeAudio } = require("./stt");
const { generateReply } = require("./gpt");
const { synthesizeSpeech } = require("./tts");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("public"));

const playbacks = new Map();

app.get("/play/:filename", (req, res) => {
  const filePath = path.join(__dirname, "public/audio", req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("Not found");
  }
});

app.post("/api/webhooks/twiml", (req, res, next) => {
  req.url = "/twiml";
  next();
});

app.post("/twiml", (req, res) => {
  const callSid = req.body.CallSid;
  console.log(`📞 Новый звонок от CallSid: ${callSid}`);

  const response = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Say voice="Polly.Tatyana">Здравствуйте. Это автоматический агент. Пожалуйста, начните говорить после сигнала.</Say>
    <Redirect method="POST">${process.env.PUBLIC_HOST}/twiml-stream</Redirect>
  </Response>`;

  res.type("text/xml");
  res.send(response);
});

app.post("/twiml-stream", (req, res) => {
  const callSid = req.body.CallSid;
  const wsUrl = `${process.env.PUBLIC_WS}/media?sid=${callSid}`;
  console.log(`🔁 Переключение на стрим CallSid: ${callSid}`);

  const response = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Connect>
      <Stream url="${wsUrl}" />
    </Connect>
  </Response>`;

  res.type("text/xml");
  res.send(response);
});

const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws, req) => {
  console.log("⚡ Запрос на WebSocket Upgrade:", req.url);

  let audioBuffer = [];
  let silenceFrames = 0;
  const silenceThreshold = 6; // ~300ms если 20fps

  const urlParams = new URLSearchParams(req.url.split("?")[1]);
  const callSid = urlParams.get("sid") || uuidv4();

  console.log("🔌 WebSocket подключен от Twilio:", callSid);

  const processBufferedAudio = async () => {
    if (audioBuffer.length === 0) return;
    const audio = Buffer.concat(audioBuffer);
    audioBuffer = [];

    const text = await transcribeAudio(audio);
    if (!text) {
      console.warn("⚠️ Распознавание не дало текста");
      return;
    }

    const reply = await generateReply(text);
    const mp3File = await synthesizeSpeech(reply);

    if (!mp3File) {
      console.error("❌ Ошибка при озвучке");
      return;
    }

    playbacks.set(callSid, mp3File);
    console.log(
      "✅ Ответ подготовлен. Twilio должен запросить /twiml-stream снова для воспроизведения."
    );
  };

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error("❌ Невозможно распарсить сообщение:", e);
      return;
    }

    if (msg.event === "media") {
      const payload = Buffer.from(msg.media.payload, "base64");
      audioBuffer.push(payload);

      const avg =
        payload.reduce((a, b) => a + Math.abs(b - 128), 0) / payload.length;
      console.log("AVG lvl -", avg);

      if (avg < 3) {
        silenceFrames++;
        if (silenceFrames > silenceThreshold) {
          console.log("🛑 Обнаружена пауза. Обработка...");
          silenceFrames = 0;
          await processBufferedAudio();
        }
      } else {
        silenceFrames = 0;
      }
    }
  });

  ws.on("error", (err) => {
    console.error("❌ Ошибка WebSocket-соединения:", err);
  });
});

app.post("/call", async (req, res) => {
  const { to } = req.body;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_NUMBER;

  const client = require("twilio")(accountSid, authToken);

  try {
    const call = await client.calls.create({
      url: `${process.env.PUBLIC_HOST}/twiml`,
      to,
      from,
    });
    res.json({ success: true, sid: call.sid });
  } catch (error) {
    console.error("❌ Ошибка вызова:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
server.on("upgrade", (req, socket, head) => {
  console.log("🔄 Запрос на upgrade:", req.url);
  if (req.url.startsWith("/media")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }
});
