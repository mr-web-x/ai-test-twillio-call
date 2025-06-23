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

async function generateReply(text, dialog, borrower) {
  // Сначала проверяем, хочет ли клиент завершить разговор
  const analysisResult = shouldEndConversation(text, dialog);

  const { name, summCredit, days, prosrochka, vernut } = borrower;

  if (analysisResult.shouldEnd) {
    console.log(`🏁 Завершение разговора. Причина: ${analysisResult.reason}`);
    return {
      reply: analysisResult.goodbyeMessage,
      shouldEndCall: true,
    };
  }

  // Проверяем, дает ли клиент пустые обещания
  const aggressiveTactics = shouldUseAggressiveTactics(text, dialog);

  if (aggressiveTactics.useAggressive) {
    console.log(
      `🔥 Используем агрессивную тактику: ${aggressiveTactics.message}`
    );

    // Можем использовать готовый агрессивный ответ или позволить GPT сгенерировать с усиленным промптом
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

  let systemPrompt = `
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
- Ak poznáš meno dlžníka, tak sa k nemu obracaj po mene
- Len 1-2 krátke vety\n
- Hovor stručne a k veci\n
- Sústreď sa LEN na dlh\n
- Neopakuj sa, preštuduj si históriu dialógu a neopakuj sa\n
- NESTRÁCEJ KONTEXT\n
- Používaj meno klienta ak ho poznáš (Skloňuj meno ak vieš)\n
- ODPOVEĎ MUSÍ BYŤ GENEROVANÁ PRESNE V SLOVENČINE\n
- Ak klient opakovane odmieta, skús iný prístup alebo sa opýtaj na jeho situáciu\n
- Ak si sa v histórii dialógu už pozdravil, tak už viac netreba\n

Cieľ: navrhnúť klientovi vrátiť dlh jednou platbou alebo 3 platbami po ${(
    vernut / 3
  ).toFixed(2)} eur\n
DÔLEŽITÉ: AK KLIENT SÚHLASIL S VRÁTENÍM DLHU, TAK POVEDAŤ ĎAKUJEM A ROZLÚČIŤ SA
`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });

    const reply = completion.choices[0].message.content.trim();
    return {
      reply: reply,
      shouldEndCall: false,
    };
  } catch (error) {
    console.error("Ошибка GPT:", error);
    return {
      reply: "Извините, произошла ошибка. Попробуйте позже.",
      shouldEndCall: false,
    };
  }
}

module.exports = { generateReply };
