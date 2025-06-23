// gpt.js
require("dotenv").config();
const { OpenAI } = require("openai");
const { shouldEndConversation } = require("./utils/conversation-analyzer.js");
const {
  shouldUseAggressiveTactics,
} = require("./utils/empty-promises-detector.js");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Оригинальная функция остается без изменений для обратной совместимости
async function generateReply(text, dialog, borrower) {
  const aggressiveTactics = shouldUseAggressiveTactics(text, dialog);
  if (aggressiveTactics.useAggressive) {
    console.log(
      `🔥 Используем агрессивную тактику: ${aggressiveTactics.message}`
    );

    if (
      aggressiveTactics.suggestedResponse &&
      aggressiveTactics.promiseCount >= 2
    ) {
      return {
        reply: aggressiveTactics.suggestedResponse,
        shouldEndCall: false,
      };
    }
  }

  let systemPrompt = generateSystemPrompt(borrower, dialog, text);

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });

    const reply = completion.choices[0].message.content.trim();
    const analysisResult = shouldEndConversation(reply, dialog);

    const result = {
      reply: reply,
      shouldEndCall: false,
    };

    if (analysisResult.shouldEnd) {
      console.log(`🏁 Завершение разговора. Причина: ${analysisResult}`);
      result.shouldEndCall = true;
    }

    return result;
  } catch (error) {
    console.error("Ошибка GPT:", error);
    return {
      reply: "Prepáčte, došlo k chybe. Zavolám späť.",
      shouldEndCall: true,
    };
  }
}

// НОВАЯ ФУНКЦИЯ С ПОДДЕРЖКОЙ STREAMING
async function generateReplyWithStreaming(text, dialog, borrower, ws) {
  // Проверяем агрессивную тактику
  const aggressiveTactics = shouldUseAggressiveTactics(text, dialog);

  if (aggressiveTactics.useAggressive) {
    console.log(
      `🔥 Используем агрессивную тактику: ${aggressiveTactics.message}`
    );

    if (
      aggressiveTactics.suggestedResponse &&
      aggressiveTactics.promiseCount >= 2
    ) {
      // Для готового ответа отправляем сразу без streaming
      console.log(
        `📤 Отправляем готовый ответ: "${aggressiveTactics.suggestedResponse}"`
      );

      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "text",
            token: aggressiveTactics.suggestedResponse,
            last: true,
          })
        );
      }

      return {
        reply: aggressiveTactics.suggestedResponse,
        shouldEndCall: false,
      };
    }
  }

  let systemPrompt = generateSystemPrompt(borrower, dialog, text);

  try {
    console.log("🚀 Начинаем streaming генерацию ответа...");

    // Создаем streaming запрос к OpenAI
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      stream: true, // Включаем streaming
    });

    let fullReply = "";
    let currentChunk = "";
    let chunkCounter = 0;

    // Обрабатываем streaming токены
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";

      if (content) {
        fullReply += content;
        currentChunk += content;

        // Проверяем, нужно ли отправить чанк
        if (shouldSendChunk(currentChunk)) {
          chunkCounter++;
          console.log(
            `📤 Отправляем чанк #${chunkCounter}: "${currentChunk.trim()}"`
          );

          if (ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: "text",
                token: currentChunk.trim(),
                last: false, // Не последний чанк
              })
            );
          }

          currentChunk = ""; // Очищаем буфер
        }
      }
    }

    // Отправляем оставшийся текст как финальный чанк
    if (currentChunk.trim().length > 0) {
      chunkCounter++;
      console.log(
        `📤 Отправляем финальный чанк #${chunkCounter}: "${currentChunk.trim()}"`
      );

      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "text",
            token: currentChunk.trim(),
            last: true, // Последний чанк
          })
        );
      }
    } else {
      // Если нет оставшегося текста, отправляем пустой финальный чанк
      console.log(`📤 Отправляем пустой финальный чанк`);

      if (ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "text",
            token: "",
            last: true,
          })
        );
      }
    }

    console.log(`✅ Streaming завершен. Полный ответ: "${fullReply}"`);
    console.log(`📊 Всего отправлено чанков: ${chunkCounter}`);

    // Анализируем полный ответ для определения завершения разговора
    const analysisResult = shouldEndConversation(fullReply, dialog);

    const result = {
      reply: fullReply,
      shouldEndCall: false,
    };

    if (analysisResult.shouldEnd) {
      console.log(`🏁 Завершение разговора. Причина: ${analysisResult}`);
      result.shouldEndCall = true;
    }

    return result;
  } catch (error) {
    console.error("❌ Ошибка GPT streaming:", error);

    const errorMessage = "Извините, произошла ошибка. Попробуйте позже.";

    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "text",
          token: errorMessage,
          last: true,
        })
      );
    }

    return {
      reply: errorMessage,
      shouldEndCall: false,
    };
  }
}

// Функция для определения, когда отправлять чанк
function shouldSendChunk(chunk) {
  const trimmedChunk = chunk.trim();

  if (trimmedChunk.length === 0) return false;

  // Вариант 1: Отправляем при завершении предложения
  const sentenceEnders = [".", "!", "?"];
  for (const ender of sentenceEnders) {
    if (trimmedChunk.endsWith(ender)) {
      return true;
    }
  }

  // Вариант 2: Отправляем при естественных паузах, если чанк достаточно длинный
  if (trimmedChunk.length >= 20) {
    const pauseMarkers = [",", ";", ":"];
    for (const marker of pauseMarkers) {
      if (trimmedChunk.endsWith(marker)) {
        return true;
      }
    }
  }

  // Вариант 3: Отправляем каждые 3-4 слова
  const words = trimmedChunk.split(/\s+/);
  if (words.length >= 4) {
    // Проверяем, что последний токен в chunk это пробел (слово завершено)
    if (
      chunk.endsWith(" ") ||
      trimmedChunk.endsWith(".") ||
      trimmedChunk.endsWith(",") ||
      trimmedChunk.endsWith("!") ||
      trimmedChunk.endsWith("?")
    ) {
      return true;
    }
  }

  // Защита от слишком длинных чанков
  if (trimmedChunk.length >= 60) {
    return true;
  }

  return false;
}

function generateSystemPrompt(borrower, dialog, text) {
  const { name, summCredit, days, prosrochka, vernut } = borrower;
  return `
Ty si hlasový agent služby vymáhania dlhov. Komunikuj zdvorilo, ale naliehavo. Odpovedaj vecne, stručne, v slovenčine. \n
TVOJA ÚLOHA: \n
- Meno: Lenka  \n
- Pozícia: Špecialista na vymáhanie \n
- Cieľ: Zdvorilo, ale naliehavo sa dohodnúť na splatení dlhu \n
- Štýl: Profesionálny, trpezlivý, ale rozhodný \n
INFORMÁCIE O DLHU\n
- Meno dlžníka: ${name}\n
- Vzal si úver na sumu: ${summCredit} eur na ${days} dní\n
- Má vrátiť: ${vernut} eur\n
- Uplynulo času od vzatia úveru: ${prosrochka + days} dní\n
- Čas omeškania: ${prosrochka} dní\n
- PRÍSNE PRAVIDLÁ:\n
MÔŽEŠ:\n
- Diskutovať len o otázkach splatenia dlhu\n
- Navrhovať možnosti splátkového kalendára/čiastočnej platby\n
- Vysvetľovať následky neplatenia (pokojne)  \n
- Žiadať potvrdenie totožnosti\n
- Zisťovať finančné možnosti\n
NEMÔŽEŠ:\n
- Diskutovať o iných témach (počasie, šport, politika)\n
- Byť hrubá, vyhrážať sa fyzickým násilím\n
- Prezrádzať informácie o iných klientoch  \n
- Poskytovať právne poradenstvo\n
- Sľubovať zľavy bez oprávnenia\n
- Používať vulgárne výrazy\n
DÔLEŽITÉ: Ak klient opakovane odmieta alebo hovorí, že nechce hovoriť/nemá čas, buď citlivý a nezopakuj rovnakú frázu!\n
Tu je celá história dialógu pre jasné pochopenie: \n
${dialog.map((el) => `[${el.from}]: ${el.text}`).join("\n")} \n
Posledná odpoveď klienta: \n
${text} \n
POKYNY PRE ODPOVEĎ:\n
- Len 1-2 krátke vety\n
- Hovor stručne a k veci\n
- Sústreď sa LEN na dlh\n
- Neopakuj sa, preštuduj si históriu dialógu a neopakuj sa\n
- NESTRÁCEJ KONTEXT\n
- Používaj meno klienta ak ho poznáš (Skloňuj meno ak vieš)\n
- ODPOVEĎ MUSÍ BYŤ GENEROVANÁ PRESNE V SLOVENČINE\n
- Ak klient opakovane odmieta, skús iný prístup alebo sa opýtaj na jeho situáciu\n
- Ak si sa v histórii dialógu už pozdravil, tak už viac netreba\n

DÔLEŽITÉ PRE OZVU^KU:\n
- Všetky čísla (sumy, dátumy, percentá) zapisuj SLOVAMI, nie číslicami\n
- Namiesto "512 eur" píš "päťsto dvanásť eur"\n
- Namiesto "170,67 eur" píš "sto sedemdesiat eur a šesťdesiatsedem centov"\n
- Namiesto "30 dní" píš "tridsať dní"\n
- Dátumy tiež slovami: namiesto "23.6.2025" píš "dvadsaťtri júna dvetisíc dvadsaťpäť"\n
- Namiesto "12 mesiacov" píš "dvanásť mesiacov"\n
- Percentá slovami: namiesto "5%" píš "päť percent"\n

Cieľ: navrhnúť klientovi vrátiť dlh jednou platbou alebo 3 platbami po ${(
    vernut / 3
  ).toFixed(2)} eur\n
DÔLEŽITÉ: AK KLIENT SÚHLASIL S VRÁTENÍM DLHU, TAK POVEDAŤ ĎAKUJEM A ROZLÚČIŤ SA\n
FRÁZY PRE UKONČENIE ROZHOVORU:\n
PRI ÚSPEŠNEJ DOHODE:\n
- "Ďakujem za spoluprácu, [meno]. Očakávame prvú splátku čo najskôr. Prajem pekný deň!"\n
- "Výborne, dohodli sme sa. Ďakujem za pochopenie. Dovidenia!"\n
- "Teším sa na vašu prvú splátku. Ďakujem a dovidenia!"\n

PRI ODMIETNUTÍ KLIENTA:\n
- "Rozumiem vašej situácii. Ak sa niečo zmení, kontaktujte nás. Dovidenia!"\n
- "Ďakujem za váš čas. Ak budete potrebovať pomoc, sme tu. Prajem pekný deň!"\n

AK SA KLIENT UŽ LÚČI:\n
- "Dovidenia!"\n
- "Ďakujem, dovidenia!"\n
- "Pekný deň!"\n

PRAVIDLO: Po použití ukončovacej frázy UŽ NEODPOVEDAJ, aj keď klient ešte niečo povie!
`;
}

module.exports = {
  generateReply,
  generateReplyWithStreaming,
};
