// server.js

const express = require("express");
const { WebSocketServer } = require("ws");
const { createServer } = require("http");
const bodyParser = require("body-parser");
const { generateReply } = require("./gpt");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("public"));

// Webhook для обработки входящих звонков
app.post("/api/webhooks/twiml", (req, res, next) => {
  req.url = "/twiml";
  next();
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

    console.log(`📞 Звонок инициирован: ${call.sid} → ${to}`);
    res.json({ success: true, sid: call.sid });
  } catch (error) {
    console.error("❌ Ошибка вызова:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/twiml", (req, res) => {
  try {
    const callSid = req.body.CallSid;
    console.log(`📞 Исходящий звонок клиенту CallSid: ${callSid}`);
    res.type("text/xml");
    res.send(`
      <Response>
        <Connect>
          <ConversationRelay url="${process.env.PUBLIC_WS}/conversation">
            <Language
          code="sk-SK"
          ttsProvider="google"
          voice="sk-SK-Standard-B"
          transcriptionProvider="google"
          speechModel="long" />
          </ConversationRelay>
        </Connect>
      </Response> 
        `);
  } catch (error) {
    console.log("ERROR -", error.message);
  }
});

// Action callback после завершения ConversationRelay
app.post("/connect-action", (req, res) => {
  const VoiceResponse = require("twilio").twiml.VoiceResponse;

  const { CallSid, SessionStatus, SessionDuration, HandoffData } = req.body;
  console.log(
    `🔚 Сессия завершена CallSid: ${CallSid}, Status: ${SessionStatus}, Duration: ${SessionDuration}s`
  );

  if (HandoffData) {
    console.log(`📋 HandoffData: ${HandoffData}`);
  }

  // Завершаем звонок через SDK
  const response = new VoiceResponse();
  response.say(
    {
      voice: "Polly.Tatyana",
    },
    "До свидания!"
  );
  response.hangup();

  res.type("text/xml");
  res.send(response.toString());
});

// WebSocket сервер для ConversationRelay
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  console.log("🔌 ConversationRelay WebSocket подключен");

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error("❌ Невозможно распарсить сообщение:", e);
      return;
    }

    console.log("📨 Получено сообщение:", msg);

    // Обработка разных типов сообщений от ConversationRelay
    switch (msg.type) {
      case "setup":
        console.log(
          `🚀 Сессия начата: ${msg.sessionId}, CallSid: ${msg.callSid}`
        );

        ws.send(
          JSON.stringify({
            type: "language",
            ttsLanguage: "sk-SK",
            transcriptionLanguage: "sk-SK",
          })
        );

        ws.send(
          JSON.stringify({
            type: "text",
            token:
              "Dobrý deň, volám sa Lenka. Zastupujem oddelenie vymáhania pohľadávok. Radi by sme s vami prediskutovali otázku vašej neuhradenej dlžoby. Tento hovor bude zaznamenávaný za účelom zlepšenia kvality služieb. Prosím, potvrďte, že môžete hovoriť.",
            last: true,
          })
        );

        // Можно отправить дополнительные параметры или настройки
        if (msg.customParameters) {
          console.log("🔧 Кастомные параметры:", msg.customParameters);
        }
        break;

      case "prompt":
        // Клиент что-то сказал - получили готовый текст
        const userText = msg.voicePrompt;
        const language = msg.lang;
        const isComplete = msg.last;

        console.log(`🗣️ Клиент сказал (${language}): "${userText}"`);

        if (isComplete) {
          try {
            // Генерируем ответ через вашу функцию
            const reply = await generateReply(userText);
            console.log(`🤖 Отправляем ответ: "${reply}"`);

            // Отправляем текстовый ответ ConversationRelay
            ws.send(
              JSON.stringify({
                type: "text",
                token: reply,
                last: true,
              })
            );
          } catch (error) {
            console.error("❌ Ошибка генерации ответа:", error);

            // Отправляем сообщение об ошибке
            ws.send(
              JSON.stringify({
                type: "text",
                token: "Извините, произошла ошибка. Попробуйте еще раз.",
                last: true,
              })
            );
          }
        }
        break;

      case "dtmf":
        // Клиент нажал кнопку на телефоне
        console.log(`📱 DTMF: ${msg.digit}`);

        // Можно обработать нажатия (например, 0 для связи с оператором)
        if (msg.digit === "0") {
          ws.send(
            JSON.stringify({
              type: "text",
              token: "Переключаю вас на оператора...",
              last: true,
            })
          );

          // Завершаем сессию с данными для передачи
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                type: "end",
                handoffData: JSON.stringify({
                  reason: "operator_request",
                  timestamp: new Date().toISOString(),
                }),
              })
            );
          }, 2000);
        }
        break;

      case "interrupt":
        // Клиент прервал воспроизведение
        console.log(
          `🛑 Прервано на: "${msg.utteranceUntilInterrupt}" через ${msg.durationUntilInterruptMs}ms`
        );
        break;

      case "error":
        // Ошибка от ConversationRelay
        console.error(`❌ Ошибка ConversationRelay: ${msg.description}`);
        break;

      default:
        console.warn(`⚠️ Неизвестный тип сообщения: ${msg.type}`);
    }
  });

  ws.on("error", (err) => {
    console.error("❌ Ошибка WebSocket ConversationRelay:", err);
  });

  ws.on("close", () => {
    console.log("🔌 ConversationRelay WebSocket отключен");
  });
});

// Создаем HTTP сервер
const server = createServer(app);

// Обработка WebSocket upgrade для ConversationRelay
server.on("upgrade", (req, socket, head) => {
  console.log("🔄 WebSocket upgrade запрос:", req.url);

  if (req.url.startsWith("/conversation")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Server запущен на порту ${PORT}`);
  console.log(`📡 WebSocket endpoint: ${process.env.PUBLIC_WS}/conversation`);
  console.log(`🌐 HTTP endpoint: ${process.env.PUBLIC_HOST}`);
});
