// gpt.js
require("dotenv").config();
const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateReply(text) {
  const systemPrompt = `Ты голосовой агент службы взыскания долгов. Общайся вежливо, но настойчиво. Отвечай по существу, кратко, на русском.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });

    const reply = completion.choices[0].message.content.trim();
    console.log("🤖 Ответ GPT:", reply);
    return reply;
  } catch (error) {
    console.error("Ошибка GPT:", error);
    return "Извините, произошла ошибка. Попробуйте позже.";
  }
}

module.exports = { generateReply };
