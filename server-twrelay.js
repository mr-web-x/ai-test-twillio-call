const express = require("express");
const { WebSocketServer } = require("ws");
const { createServer } = require("http");
const bodyParser = require("body-parser");
const { generateReply, generateReplyWithStreaming } = require("./gpt");
require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static("public"));

const borrower = {
  name: "Dmitry Novak",
  summCredit: 500,
  days: 30,
  prosrochka: 12,
  vernut: 512,
};

const pendingCalls = new Map();
const activeCalls = new Map();
const callTimeouts = new Map();
const silenceTimeouts = new Map(); // 🎯 Таймауты для детекции молчания

const CALL_TIMEOUT = 10 * 60 * 1000; // 10 минут
const SILENCE_TIMEOUT = 5 * 1000; // 5 секунды молчания
const MAX_SILENCE_PROMPTS = 2; // Максимум 3 переспроса

const startMessage =
  "Dobrý deň, volám sa Lenka. Zastupujem oddelenie vymáhania pohľadávok. Prosím, potvrďte, že môžete hovoriť.";

// 🎯 ФРАЗЫ ДЛЯ ПЕРЕСПРОСА ПРИ МОЛЧАНИИ
const silencePrompts = [
  "Počujem vás? Môžete odpovedať?", // Первый переспрос
  "Dmitry, ste tam? Prosím, odpovedzte.", // Второй переспрос
  "Zdá sa, že sa spojenie prerušilo. Ak ma počujete, prosím povedzte niečo.", // Третий переспрос
];

app.post("/call", async (req, res) => {
  const { to } = req.body;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_NUMBER;

  const client = require("twilio")(accountSid, authToken);

  try {
    const call = await client.calls.create({
      url: `${process.env.PUBLIC_HOST}/api/webhooks/twiml`,
      to,
      from,
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
  try {
    const callSid = req.body.CallSid;

    const to = pendingCalls.get(callSid);

    const callData = {
      to,
      dialog: [{ from: "ai", text: startMessage }],
      silenceCount: 0, // 🎯 Счетчик переспросов при молчании
    };

    activeCalls.set(callSid, callData);
    pendingCalls.delete(callSid);
    console.log(`📝 Создан новый диалог для ${callSid}`);

    res.send(`<?xml version="1.0" encoding="UTF-8"?>
              <Response>
                  <Connect>
                      <ConversationRelay debug="True" url="${process.env.PUBLIC_WS}/conversation" transcriptionLanguage="sk-SK" transcriptionProvider="Deepgram" ttsProvider="google" voice="sk-SK-Wavenet-B" welcomeGreeting="${startMessage}">
                      </ConversationRelay>
                  </Connect>
              </Response>`);
  } catch (error) {
    console.log("ERROR -", error.message);
  }
});

app.post("/connect-action", (req, res) => {
  const VoiceResponse = require("twilio").twiml.VoiceResponse;

  const { CallSid, SessionStatus, SessionDuration, HandoffData } = req.body;
  console.log(
    `🔚 Сессия завершена CallSid: ${CallSid}, Status: ${SessionStatus}, Duration: ${SessionDuration}s`
  );

  if (HandoffData) {
    console.log(`📋 HandoffData: ${HandoffData}`);
  }

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

// 🎯 ФУНКЦИЯ ОЧИСТКИ ЗАВИСШЕГО ЗВОНКА
function cleanupCall(callSid, reason = "timeout") {
  console.log(`🧹 Очистка звонка ${callSid}. Причина: ${reason}`);

  if (activeCalls.has(callSid)) {
    activeCalls.delete(callSid);
    console.log(`🗑️ Звонок ${callSid} удален из активных`);
  }

  if (callTimeouts.has(callSid)) {
    const timeoutId = callTimeouts.get(callSid);
    clearTimeout(timeoutId);
    callTimeouts.delete(callSid);
    console.log(`⏰ Таймаут для ${callSid} очищен`);
  }

  // 🎯 ОЧИЩАЕМ ТАЙМАУТ МОЛЧАНИЯ
  if (silenceTimeouts.has(callSid)) {
    const silenceTimeoutId = silenceTimeouts.get(callSid);
    clearTimeout(silenceTimeoutId);
    silenceTimeouts.delete(callSid);
    console.log(`🤫 Таймаут молчания для ${callSid} очищен`);
  }

  if (pendingCalls.has(callSid)) {
    pendingCalls.delete(callSid);
  }
}

// 🎯 ФУНКЦИЯ УСТАНОВКИ ТАЙМЕРА МОЛЧАНИЯ
function setSilenceTimer(callSid, ws, timeoutTime = SILENCE_TIMEOUT) {
  // Очищаем предыдущий таймер молчания если есть
  if (silenceTimeouts.has(callSid)) {
    clearTimeout(silenceTimeouts.get(callSid));
  }

  const silenceTimeoutId = setTimeout(() => {
    console.log(`🤫 Обнаружено молчание клиента для ${callSid}`);

    const callData = activeCalls.get(callSid);
    if (!callData) {
      console.log(`❌ CallData не найден для ${callSid}, пропускаем`);
      return;
    }

    // Увеличиваем счетчик молчания
    callData.silenceCount++;

    console.log(`🔄 Переспрос #${callData.silenceCount} для ${callSid}`);

    if (callData.silenceCount <= MAX_SILENCE_PROMPTS) {
      // Берем фразу переспроса
      const promptIndex = Math.min(
        callData.silenceCount - 1,
        silencePrompts.length - 1
      );
      const silencePrompt = silencePrompts[promptIndex];

      // Добавляем в диалог
      callData.dialog.push({ from: "ai", text: silencePrompt });

      console.log(`🤖 Переспрашиваем: "${silencePrompt}"`);

      // Отправляем переспрос
      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "text",
            token: silencePrompt,
            last: true,
          })
        );

        // 🎯 УСТАНАВЛИВАЕМ НОВЫЙ ТАЙМЕР МОЛЧАНИЯ
        setSilenceTimer(callSid, ws);
      }
    } else {
      // Превышен лимит переспросов - завершаем звонок
      console.log(
        `❌ Превышен лимит переспросов для ${callSid} - завершаем звонок`
      );

      const goodbyeMessage =
        "Zdá sa, že sa spojenie prerušilo. Ďakujem za váš čas. Dovidenia!";
      callData.dialog.push({ from: "ai", text: goodbyeMessage });

      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "text",
            token: goodbyeMessage,
            last: true,
          })
        );

        // Завершаем через 3 секунды
        setTimeout(() => {
          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: "end",
                handoffData: JSON.stringify({
                  reason: "client_silence_timeout",
                  timestamp: new Date().toISOString(),
                  silenceCount: callData.silenceCount,
                  finalDialog: callData.dialog,
                }),
              })
            );
          }
        }, 3000);
      }

      // Очищаем данные
      cleanupCall(callSid, "silence_timeout");
    }
  }, timeoutTime);

  // Сохраняем ID таймера молчания
  silenceTimeouts.set(callSid, silenceTimeoutId);
  console.log(
    `🤫 Установлен таймер молчания ${timeoutTime / 1000}сек для ${callSid}`
  );
}

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws, req) => {
  console.log("🔌 ConversationRelay WebSocket подключен");

  let currentCallSid = null;
  let conversationEnded = false;

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
      // console.log("[MESSAGE] -", msg);
    } catch (e) {
      console.error("❌ Невозможно распарсить сообщение:", e);
      return;
    }

    switch (msg.type) {
      case "setup":
        console.log(
          `🚀 Сессия начата: ${msg.sessionId}, CallSid: ${msg.callSid}`
        );

        currentCallSid = msg.callSid;

        // 🎯 УСТАНАВЛИВАЕМ ОСНОВНОЙ ТАЙМАУТ
        const timeoutId = setTimeout(() => {
          console.log(
            `⏰ Таймаут истек для звонка ${currentCallSid} - принудительно завершаем`
          );

          if (ws.readyState === ws.OPEN) {
            console.log(
              `🔌 Принудительно закрываем WebSocket для ${currentCallSid}`
            );
            ws.close(1000, "Call timeout exceeded");
          }

          cleanupCall(currentCallSid, "timeout_exceeded");
        }, CALL_TIMEOUT);

        callTimeouts.set(currentCallSid, timeoutId);
        console.log(
          `⏰ Установлен таймаут ${
            CALL_TIMEOUT / 1000 / 60
          } минут для звонка ${currentCallSid}`
        );

        ws.send(
          JSON.stringify({
            type: "language",
            ttsLanguage: "sk-SK",
            transcriptionLanguage: "sk-SK",
          })
        );

        setSilenceTimer(currentCallSid, ws, 18);

        break;

      case "prompt":
        if (conversationEnded) {
          console.log(
            "⚠️ Разговор уже завершен, игнорируем новое сообщение от клиента"
          );
          return;
        }

        const userText = msg.voicePrompt;
        const language = msg.lang;
        const isComplete = msg.last;

        const currentCallData = activeCalls.get(currentCallSid);

        if (!currentCallData) {
          console.error(`❌ CallData не найден для ${currentCallSid}`);
          return;
        }

        // 🎯 КЛИЕНТ ОТВЕТИЛ - СБРАСЫВАЕМ СЧЕТЧИК МОЛЧАНИЯ
        if (silenceTimeouts.has(currentCallSid)) {
          clearTimeout(silenceTimeouts.get(currentCallSid));
          silenceTimeouts.delete(currentCallSid);
          console.log(
            `🗣️ Клиент ответил, сбрасываем таймер молчания для ${currentCallSid}`
          );
        }

        // Сбрасываем счетчик молчания при любом ответе клиента
        currentCallData.silenceCount = 0;

        currentCallData.dialog.push({ from: "client", text: userText });

        console.log(
          `[${new Date().toISOString()}] 🗣️ Клиент сказал (${language}): "${userText}"`
        );

        if (isComplete) {
          try {
            // 🚀 ИСПОЛЬЗУЕМ STREAMING ВЕРСИЮ ВМЕСТО ОБЫЧНОЙ
            console.log("🎬 Переключаемся на streaming генерацию...");

            const result = await generateReplyWithStreaming(
              userText,
              currentCallData.dialog,
              borrower,
              ws // Передаем WebSocket для отправки чанков
            );

            const reply = result.reply;
            const shouldEndCall = result.shouldEndCall;

            // Добавляем полный ответ в диалог
            currentCallData.dialog.push({ from: "ai", text: reply });

            console.log(
              `[${new Date().toISOString()}] 🤖 АИ сказал (streaming): "${reply}"`
            );

            if (!shouldEndCall) {
              console.log(
                "🤫 Устанавливаем таймер молчания после streaming ответа"
              );
              setSilenceTimer(currentCallSid, ws);
            }

            if (shouldEndCall) {
              console.log("🏁 Инициируем завершение разговора...");

              conversationEnded = true;
              cleanupCall(currentCallSid, "normal_completion");

              setTimeout(() => {
                if (ws.readyState === ws.OPEN) {
                  ws.send(
                    JSON.stringify({
                      type: "end",
                      handoffData: JSON.stringify({
                        reason: "conversation_completed",
                        timestamp: new Date().toISOString(),
                        finalDialog: currentCallData.dialog,
                      }),
                    })
                  );
                }
              }, 3000);
            }

            // 🎯 ВРЕМЕННО НЕ УСТАНАВЛИВАЕМ ТАЙМЕР МОЛЧАНИЯ
            // setSilenceTimer(currentCallSid, ws);
          } catch (error) {
            console.error("❌ Ошибка генерации ответа:", error);

            // В случае ошибки streaming отправляем обычным способом
            const errorMessage =
              "Извините, произошла ошибка. Попробуйте еще раз.";

            ws.send(
              JSON.stringify({
                type: "text",
                token: errorMessage,
                last: true,
              })
            );

            // НЕ устанавливаем таймер молчания после ошибки
          }
        }
        break;

      case "dtmf":
        if (conversationEnded) {
          console.log("⚠️ Разговор завершен, игнорируем DTMF");
          return;
        }

        console.log(`📱 DTMF: ${msg.digit}`);

        if (msg.digit === "0") {
          conversationEnded = true;
          cleanupCall(currentCallSid, "dtmf_transfer");

          ws.send(
            JSON.stringify({
              type: "text",
              token: "Переключаю вас на оператора...",
              last: true,
            })
          );

          setTimeout(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "end",
                  handoffData: JSON.stringify({
                    reason: "operator_request",
                    timestamp: new Date().toISOString(),
                  }),
                })
              );
            }
          }, 2000);
        }
        break;

      case "interrupt":
        console.log(
          `🛑 Прервано на: "${msg.utteranceUntilInterrupt}" через ${msg.durationUntilInterruptMs}ms`
        );
        break;

      case "error":
        console.error(`❌ Ошибка ConversationRelay: ${msg.description}`);
        break;

      default:
        console.warn(`⚠️ Неизвестный тип сообщения: ${msg.type}`);
    }
  });

  ws.on("error", (err) => {
    console.error("❌ Ошибка WebSocket ConversationRelay:", err);

    if (currentCallSid) {
      cleanupCall(currentCallSid, "websocket_error");
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `🔌 ConversationRelay WebSocket закрыт. Код: ${code}, Причина: ${reason}`
    );

    const callData = activeCalls.get(currentCallSid);

    if (callData && !conversationEnded) {
      console.log(
        "Финальный диалог:",
        JSON.stringify(callData.dialog, null, 2)
      );
    }

    if (currentCallSid) {
      cleanupCall(currentCallSid, "websocket_closed");
    }
  });
});

// 🎯 СТАТИСТИКА КАЖДУЮ МИНУТУ
setInterval(() => {
  const now = Date.now();
  const activeCallsCount = activeCalls.size;
  const timeoutsCount = callTimeouts.size;
  const silenceTimeoutsCount = silenceTimeouts.size;

  console.log(
    `📊 Статистика: Звонки: ${activeCallsCount}, Таймауты: ${timeoutsCount}, Молчание: ${silenceTimeoutsCount}`
  );

  if (activeCallsCount !== timeoutsCount) {
    console.warn(
      `⚠️ Обнаружено расхождение в таймаутах: ${activeCallsCount} vs ${timeoutsCount}`
    );
  }
}, 60000);

const server = createServer(app);

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

process.on("SIGINT", () => {
  console.log("\n🛑 Получен SIGINT. Очищаем таймауты...");

  for (const [callSid, timeoutId] of callTimeouts) {
    clearTimeout(timeoutId);
  }

  for (const [callSid, silenceTimeoutId] of silenceTimeouts) {
    clearTimeout(silenceTimeoutId);
  }

  callTimeouts.clear();
  silenceTimeouts.clear();
  activeCalls.clear();
  pendingCalls.clear();

  console.log("✅ Очистка завершена. Остановка сервера...");
  process.exit(0);
});
