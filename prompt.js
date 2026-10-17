// Turns the free-text prompt into search.js CLI arguments (settings overrides), e.g.
//   "cheapest hotel in Paris, FR, Nov 20 to Nov 22 2026 for 2 adults under 200 EUR"
//   -> ["--city=Paris", "--country-code=FR", "--check-in=2026-11-20", ...]
// Uses Claude when ANTHROPIC_API_KEY is set, otherwise a small regex parser. Raw --flags always work.
try {
    process.loadEnvFile();
} catch {
    // No .env file - rely on the environment
}

const MODEL = "claude-haiku-5-5";
const SETTING_KEYS = {
    city: "string",
    countryCode: "ISO 3166 alpha-2 code of the city's country, e.g. CA",
    checkIn: "YYYY-MM-DD",
    checkOut: "YYYY-MM-DD",
    adults: "number",
    currency: "ISO 4217 code, e.g. CAD",
    maxNightlyPrice: "number or null for no limit",
    minRating: "number out of 5, or null",
    minReviews: "number, or null",
    targetCount: "number of hotels to return",
    sources: "array from: xotelo, searchapi, liteapi, hotelbeds, booking"
};

const toFlag = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

function toArgs(settings) {
    return Object.entries(settings)
        .filter(([key]) => key in SETTING_KEYS)
        .map(([key, value]) => `--${toFlag(key)}=${Array.isArray(value) ? value.join(",") : value}`);
}

async function parseWithClaude(prompt) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 400,
            system: `Extract hotel search settings from the user's request. Reply with only a JSON object using any of these keys (omit what the user did not say): ${JSON.stringify(SETTING_KEYS)}. Today is ${new Date().toISOString().slice(0, 10)}.`,
            messages: [{ role: "user", content: prompt }]
        })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || response.status);

    const json = data.content[0].text.match(/\{[\s\S]*\}/)?.[0];
    return { settings: JSON.parse(json), usage: data.usage };
}

function parseWithRegex(prompt) {
    const settings = {};
    const city = prompt.match(/\b(?:in|near|for|at)\s+((?:[A-Z][\p{L}.'-]*\s?)+?)(?:,\s*([A-Z]{2})\b)?(?=$|[\s,.]+(?:[a-z]|\d|from\b)|[,.]|\s+[A-Z][a-z]{2}\s+\d)/u);
    if (city) {
        settings.city = city[1].trim();
        if (city[2]) settings.countryCode = city[2];
    }

    const dates = prompt.match(/\d{4}-\d{2}-\d{2}/g);
    if (dates?.[0]) settings.checkIn = dates[0];
    if (dates?.[1]) settings.checkOut = dates[1];

    const adults = prompt.match(/(\d+)\s*(?:adults?|guests?|people|persons?)/i);
    if (adults) settings.adults = Number(adults[1]);

    const price = prompt.match(/(?:under|below|max(?:imum)?|less than|<)\s*\$?(\d+)/i);
    if (price) settings.maxNightlyPrice = Number(price[1]);

    const currency = prompt.match(/\b(CAD|USD|EUR|GBP|AUD)\b/);
    if (currency) settings.currency = currency[1];

    return settings;
}

// Returns { args, settings, usage, parser } - args are ready to pass to search-json.js
async function parsePrompt(prompt) {
    // Explicit --key=value tokens are passed through as-is and win over anything parsed
    const flags = prompt.match(/--[\w-]+=\S*/g) || [];
    const text = prompt.replace(/--[\w-]+=\S*/g, " ");

    let parsed;
    let parser = "regex";
    let usage = null;
    if (process.env.ANTHROPIC_API_KEY) {
        try {
            ({ settings: parsed, usage } = await parseWithClaude(text));
            parser = MODEL;
        } catch (error) {
            console.error(`Claude prompt parsing failed (${error.message}), using regex`);
        }
    }
    parsed ||= parseWithRegex(text);

    const flagKeys = new Set(flags.map(flag => flag.slice(2).split("=")[0]));
    const args = [...toArgs(parsed).filter(arg => !flagKeys.has(arg.slice(2).split("=")[0])), ...flags];
    return { args, parser, usage };
}

module.exports = { parsePrompt };
