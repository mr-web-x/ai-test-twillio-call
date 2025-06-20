const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const bodyParser = require("body-parser");
const { generateReply } = require("./gpt");
const { GoogleSTTStream } = require("./stt");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("public"));

const pendingCalls = new Map();
const activeCalls = new Map();
const startMessage =
  "Добрый день, меня зовут Ленка. Я представляю отдел по взысканию задолженности. Мы бы хотели обсудить с вами вопрос вашей неоплаченной задолженности. Этот разговор будет записан с целью улучшения качества обслуживания. Пожалуйста, подтвердите, что вы можете говорить.";

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

    pendingCalls.set(call.sid, to);

    console.log(`📞 Звонок инициирован: ${call.sid} → ${to}`);
    res.json({ success: true, sid: call.sid });
  } catch (error) {
    console.error("❌ Ошибка вызова:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/webhooks/twiml", (req, res) => {
  const callSid = req.body.CallSid;
  const wsUrl = `${process.env.PUBLIC_WS}/media/${callSid}`;

  // Объединяем приветствие и подключение к стриму в одном ответе
  const response = `<?xml version="1.0" encoding="UTF-8"?>
  <Response>
    <Say voice="Polly.Tatyana">${startMessage}</Say>
    <Connect>
      <Stream url="${wsUrl}" />
    </Connect>
  </Response>`;

  res.type("text/xml");
  res.send(response);
});

// Убираем отдельный endpoint /twiml-stream - он больше не нужен

// Функция для безопасного экранирования XML
function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  console.log("⚡ Запрос на WebSocket Upgrade:", req.url);

  // Извлекаем callSid из URL
  const callSid = req.url?.split("/").pop();

  console.log("🔌 WebSocket подключен от Twilio:", callSid);

  // Проверяем, есть ли уже активный звонок (для сохранения истории)
  let callData = activeCalls.get(callSid);

  if (callData) {
    // Обновляем WebSocket и STT, сохраняя историю диалога
    console.log(
      `🔄 Переподключение для ${callSid}, сохраняем историю (${callData.dialog.length} сообщений)`
    );
    callData.ws = ws;
    if (callData.stt) {
      callData.stt.close();
    }
    callData.stt = new GoogleSTTStream("ru-RU");
    callData.isProcessing = false;
  } else {
    // Создаем новый звонок
    const to = pendingCalls.get(callSid);
    const stt = new GoogleSTTStream("ru-RU");

    callData = {
      ws,
      stt,
      to,
      dialog: [{ from: "ai", text: startMessage }],
      isProcessing: false,
    };

    activeCalls.set(callSid, callData);
    pendingCalls.delete(callSid);
    console.log(`📝 Создан новый диалог для ${callSid}`);
  }

  // Настраиваем обработчик распознанного текста
  callData.stt.onText(async (userText) => {
    const currentCallData = activeCalls.get(callSid);
    if (!currentCallData || currentCallData.isProcessing) return;

    // Пропускаем пустые сообщения
    if (!userText || userText.trim() === "") {
      console.log(`🔇 Пропускаем пустое сообщение для ${callSid}`);
      return;
    }

    // Устанавливаем флаг обработки
    currentCallData.isProcessing = true;

    console.log(`🗣️ Распознано (${callSid}): ${userText}`);
    currentCallData.dialog.push({ from: "client", text: userText });

    try {
      // Генерируем ответ с помощью GPT
      const reply = await generateReply(userText, currentCallData.dialog);
      console.log(`🤖 GPT ответ (${callSid}): ${reply}`);
      currentCallData.dialog.push({ from: "ai", text: reply });

      // Отправляем ответ в звонок через Twilio API
      const client = require("twilio")(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );

      // Экранируем специальные символы для XML
      const escapedReply = escapeXml(reply);

      // ИСПРАВЛЕНО: После Say возвращаемся к стриму
      const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say language="ru-RU" voice="Polly.Tatyana">${escapedReply}</Say>
        <Pause length="2"/>
        <Connect>
          <Stream url="${process.env.PUBLIC_WS}/media/${callSid}" />
        </Connect>
      </Response>`;

      await client.calls(callSid).update({
        twiml: twimlResponse,
      });

      console.log(`✅ Ответ отправлен в звонок: ${callSid}`);
      console.log(
        `📊 История диалога: ${currentCallData.dialog.length} сообщений`
      );
    } catch (error) {
      console.error(`❌ Ошибка отправки ответа для ${callSid}:`, error);

      // Попытка отправить запасной ответ
      try {
        const client = require("twilio")(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        );

        // ИСПРАВЛЕНО: И тут тоже возвращаемся к стриму
        const fallbackResponse = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say language="ru-RU" voice="Polly.Tatyana">Извините, произошла техническая ошибка. Попробуйте повторить.</Say>
          <Pause length="2"/>
          <Connect>
            <Stream url="${process.env.PUBLIC_WS}/media/${callSid}" />
          </Connect>
        </Response>`;

        await client.calls(callSid).update({
          twiml: fallbackResponse,
        });

        console.log(`🔄 Запасной ответ отправлен для ${callSid}`);
      } catch (fallbackError) {
        console.error(
          `❌ Ошибка отправки запасного ответа для ${callSid}:`,
          fallbackError
        );
      }
    } finally {
      // Снимаем флаг обработки
      currentCallData.isProcessing = false;
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

      // Логируем каждый 50-й чанк для уменьшения спама в логах
      if (parseInt(msg.media.chunk) % 50 === 0) {
        console.log(
          `🎵 Обрабатываем аудио чанк ${msg.media.chunk} для ${callSid} (${audioBuffer.length} байт)`
        );
      }

      const currentCallData = activeCalls.get(callSid);
      if (currentCallData && currentCallData.stt) {
        currentCallData.stt.write(audioBuffer);
      }
    } else if (msg.event === "stop") {
      console.log(`🛑 Стрим остановлен для ${callSid}`);
    } else if (msg.event === "mark") {
      console.log(`🏷️ Получен mark для ${callSid}:`, msg.mark);
    }
  });

  ws.on("close", () => {
    console.log(`🔌 WebSocket отключен для ${callSid}`);

    // Закрываем STT
    const currentCallData = activeCalls.get(callSid);
    if (currentCallData && currentCallData.stt) {
      currentCallData.stt.close();
    }

    // Безопасное логирование активных звонков
    if (currentCallData) {
      console.log(`📋 Финальная история диалога для ${callSid}:`);
      console.log(JSON.stringify(currentCallData.dialog, null, 2));
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

// API endpoint для получения статуса активных звонков
app.get("/status", (req, res) => {
  const status = {
    activeCalls: activeCalls.size,
    pendingCalls: pendingCalls.size,
    calls: [],
  };

  for (const [callSid, data] of activeCalls) {
    status.calls.push({
      callSid,
      to: data.to,
      dialogLength: data.dialog ? data.dialog.length : 0,
      isProcessing: data.isProcessing || false,
    });
  }

  res.json(status);
});

// API endpoint для получения диалога конкретного звонка
app.get("/call/:callSid/dialog", (req, res) => {
  const { callSid } = req.params;
  const callData = activeCalls.get(callSid);

  if (!callData) {
    return res.status(404).json({ error: "Звонок не найден" });
  }

  res.json({
    callSid,
    to: callData.to,
    dialog: callData.dialog,
    isProcessing: callData.isProcessing,
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("🛑 Завершение работы сервера...");
  activeCalls.forEach(({ stt }, callSid) => {
    console.log(`🔌 Закрываем STT для ${callSid}`);
    if (stt) {
      stt.close();
    }
  });
  server.close(() => {
    console.log("✅ Сервер успешно остановлен");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🛑 Получен сигнал SIGINT, завершаем работу...");
  process.emit("SIGTERM");
});

server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📊 Status API: http://localhost:${PORT}/status`);
  console.log(`📞 Call API: POST http://localhost:${PORT}/call`);
});
