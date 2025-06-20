const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const bodyParser = require("body-parser");
const { generateReply } = require("./gpt");
const { GoogleSTTStream } = require("./stt");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());

// Храним активные звонки
const activeCalls = new Map();

// Endpoint для инициации звонков
app.post("/call", async (req, res) => {
  const { to } = req.body;

  const client = require("twilio")(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  try {
    const call = await client.calls.create({
      url: `${process.env.PUBLIC_HOST}/api/webhooks/twiml`,
      to,
      from: process.env.TWILIO_NUMBER,
    });

    console.log(`📞 Звонок инициирован: ${call.sid} → ${to}`);
    res.json({ success: true, sid: call.sid });
  } catch (error) {
    console.error("❌ Ошибка вызова:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/webhooks/twiml", (req, res) => {
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

  // Извлекаем callSid из URL
  const urlParams = new URLSearchParams(req.url.split("?")[1]);
  const callSid = urlParams.get("sid") || uuidv4();

  console.log("🔌 WebSocket подключен от Twilio:", callSid);

  // Создаем Google STT для этого звонка
  const stt = new GoogleSTTStream("sk-SK");

  // Сохраняем в активных звонках
  activeCalls.set(callSid, { ws, stt });

  // Настраиваем обработчик распознанного текста
  stt.onText(async (userText) => {
    console.log(`🗣️ Распознано (${callSid}): ${userText}`);

    try {
      const reply = await generateReply(userText);
      console.log(`🤖 GPT ответ (${callSid}): ${reply}`);

      // Отправляем ответ в звонок через Twilio API
      const client = require("twilio")(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      await client.calls(callSid).update({
        twiml: `<Response><Say language="ru-RU" voice="Polly.Tatyana">${reply}</Say></Response>`,
      });

      console.log(`✅ Ответ отправлен в звонок: ${callSid}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки ответа для ${callSid}:`, error);
    }
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error("❌ Невозможно распарсить сообщение:", e);
      return;
    }

    if (msg.event === "start") {
      console.log(`🎬 Стрим начался для ${callSid}:`, msg.start);
    } else if (msg.event === "media") {
      // Отправляем аудио данные напрямую в Google STT
      const audioBuffer = Buffer.from(msg.media.payload, "base64");

      // Логируем каждый 20-й чанк
      if (parseInt(msg.media.chunk) % 20 === 0) {
        console.log(
          `🎵 Обрабатываем аудио чанк ${msg.media.chunk} для ${callSid} (${audioBuffer.length} байт)`
        );
      }

      stt.write(audioBuffer);
    } else if (msg.event === "stop") {
      console.log(`🛑 Стрим остановлен для ${callSid}`);
    }
  });

  ws.on("close", () => {
    console.log(`🔌 WebSocket отключен для ${callSid}`);

    // Закрываем STT
    if (stt) {
      stt.close();
    }

    // Удаляем из активных звонков
    activeCalls.delete(callSid);
  });

  ws.on("error", (err) => {
    console.error(`❌ Ошибка WebSocket для ${callSid}:`, err);
  });
});

// Обработка upgrade WebSocket
const server = createServer(app);
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/media")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Завершение работы сервера...");
  activeCalls.forEach(({ stt }, callSid) => {
    console.log(`🔌 Закрываем STT для ${callSid}`);
    stt.close();
  });
  server.close();
});

server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});
