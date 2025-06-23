// empty-promises-detector.js

/**
 * Определяет, дает ли клиент пустые обещания без конкретики
 * @param {string} clientText - текст клиента
 * @returns {Object} - результат анализа
 */
function detectEmptyPromise(clientText) {
  if (!clientText || typeof clientText !== "string") {
    return { isEmpty: false, type: null };
  }

  const text = clientText.toLowerCase().trim();

  // Паттерны пустых обещаний
  const emptyPromisePatterns = [
    // Обещания связаться
    { pattern: /\b(ozvem\s+sa|zavolám|kontaktujem)\b/, type: "call_back" },
    { pattern: /\b(dám\s+vedieť|informujem)\b/, type: "inform" },

    // Обещания подумать
    { pattern: /\b(premyslím\s+si|pozriem\s+sa)\b/, type: "think_about" },
    { pattern: /\b(zvážim|zhodnotím)\b/, type: "consider" },

    // Общие обещания без конкретики
    {
      pattern: /\b(nájdeme\s+riešenie|vyriešime\s+to)\b/,
      type: "vague_solution",
    },
    { pattern: /\b(pokúsim\s+sa|budem\s+sa\s+snažiť)\b/, type: "try" },

    // Временные отговорки
    {
      pattern: /\b(čo\s+najskôr|hneď\s+ako|až\s+budem)\b/,
      type: "vague_timing",
    },
    { pattern: /\b(časom\s+sa\s+to|situácia\s+sa)\b/, type: "future_hope" },

    // Просьбы о времени
    { pattern: /\b(potrebujem\s+čas|dajte\s+mi\s+čas)\b/, type: "need_time" },
    {
      pattern: /\b(musím\s+si\s+to|potrebujem\s+premyslieť)\b/,
      type: "need_think",
    },
  ];

  for (const { pattern, type } of emptyPromisePatterns) {
    if (pattern.test(text)) {
      return { isEmpty: true, type, originalText: clientText };
    }
  }

  return { isEmpty: false, type: null };
}

/**
 * Подсчитывает количество пустых обещаний в диалоге
 * @param {Array} dialog - история диалога
 * @returns {number} - количество пустых обещаний
 */
function countEmptyPromises(dialog) {
  if (!dialog || !Array.isArray(dialog)) {
    return 0;
  }

  let count = 0;
  for (const message of dialog) {
    if (message.from === "client") {
      const analysis = detectEmptyPromise(message.text);
      if (analysis.isEmpty) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Генерирует агрессивный ответ на пустые обещания
 * @param {string} promiseType - тип пустого обещания
 * @param {number} promiseCount - количество предыдущих обещаний
 * @returns {string} - агрессивный ответ
 */
function generateAggressiveResponse(promiseType, promiseCount) {
  const responses = {
    call_back: [
      "KEDY presne sa ozvete? Dnes večer alebo zajtra ráno?",
      "Už ste sa mali ozvať. Teraz potrebujem ČÍSLA, nie sľuby!",
      "Každá hodina meškania pridáva úroky. KOĽKO dokážete zaplatiť?",
    ],

    inform: [
      "Informujte ma TERAZ. Aký máte mesačný príjem?",
      "Informácie nepotrebujem, potrebujem PLATBU. Koľko EUR?",
      "Stop s informovaním - potrebujem záväzok na sumu!",
    ],

    think_about: [
      "Čas na premýšľanie skončil. Exekútor nepremýšľa!",
      "Súd nebude čakať na vaše rozhodnutie. Koľko TERAZ?",
      "Každý deň premýšľania stojí peniaze. Aspoň čiastočná platba?",
    ],

    vague_solution: [
      "AKÉ riešenie? Potrebujem čísla - koľko EUR dokážete?",
      "Jediné riešenie je PLATBA. Koľko mesačne môžete?",
      "Riešenie je jednoduché - zaplatíť dlh. Kedy a koľko?",
    ],

    vague_timing: [
      "Čo najskôr znamená KEDY? Dnes alebo zajtra?",
      "Hneď ako čo? Potrebujem konkrétny dátum!",
      "Neurčité termíny neakceptujem. KTORÝ deň zaplatíte?",
    ],

    need_time: [
      "Čas na rozmýšľanie ste mali mesiace. Koľko dokážete TERAZ?",
      "Exekúcia nepočká. Aspoň minimálnu sumu môžete?",
      "Každý deň meškania pridáva náklady. Čiastočná platba?",
    ],
  };

  const responseArray = responses[promiseType] || responses.vague_solution;

  // Čím viac obещаний, tým агрессивнее ответ
  const index = Math.min(promiseCount, responseArray.length - 1);
  return responseArray[index];
}

/**
 * Проверяет, нужно ли использовать агрессивную тактику
 * @param {string} clientText - текст клиента
 * @param {Array} dialog - история диалога
 * @returns {Object} - рекомендации для AI
 */
function shouldUseAggressiveTactics(clientText, dialog) {
  const emptyPromise = detectEmptyPromise(clientText);
  const promiseCount = countEmptyPromises(dialog);

  if (emptyPromise.isEmpty) {
    return {
      useAggressive: true,
      reason: "empty_promise",
      promiseType: emptyPromise.type,
      promiseCount: promiseCount,
      suggestedResponse: generateAggressiveResponse(
        emptyPromise.type,
        promiseCount
      ),
      message: `Клиент дает ${promiseCount + 1}-е пустое обещание типа '${
        emptyPromise.type
      }'`,
    };
  }

  // Если много пустых обещаний в истории - тоже быть агрессивным
  if (promiseCount >= 3) {
    return {
      useAggressive: true,
      reason: "too_many_promises",
      promiseCount: promiseCount,
      suggestedResponse:
        "Stop so sľubmi! Potrebujem ČÍSLA. Koľko EUR dokážete zaplatiť?",
      message: `Слишком много пустых обещаний (${promiseCount})`,
    };
  }

  return {
    useAggressive: false,
    reason: "normal_response",
    promiseCount: promiseCount,
  };
}

module.exports = {
  detectEmptyPromise,
  countEmptyPromises,
  generateAggressiveResponse,
  shouldUseAggressiveTactics,
};
