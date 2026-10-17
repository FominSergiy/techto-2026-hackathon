// Turns the free-text prompt into search.js CLI arguments (settings overrides), e.g.
//   "cheapest hotel in Paris, FR, Nov 20 to Nov 22 2026 for 2 adults under 200 EUR"
//   -> ["--city=Paris", "--country-code=FR", "--check-in=2026-11-20", ...]
// Uses Claude Haiku when ANTHROPIC_API_KEY is set, else Backboard's cheap model (BACKBOARD_API_KEY), else a
// small regex parser that misses typos and relative dates. Raw --flags always work.
try {
    process.loadEnvFile();
} catch {
    // No .env file - rely on the environment
}

const defaults = require("./hotel_search/settings");

const MODEL = "claude-haiku-5-5";
const SETTING_KEYS = {
    city: "string",
    region: "province/state name that tells apart cities sharing a name, e.g. Ontario for Aurora, CA; null if unsure",
    countryCode: "ISO 3166 alpha-2 code of the city's country, e.g. CA",
    checkIn: "YYYY-MM-DD",
    checkOut: "YYYY-MM-DD",
    nights: "number of nights (used when checkOut is not given)",
    adults: "number",
    currency: "ISO 4217 code, e.g. CAD",
    maxNightlyPrice: "number or null for no limit",
    minRating: "number out of 5, or null",
    minReviews: "number, or null",
    targetCount: "number of hotels to return, ONLY when the user gives an explicit count such as 'top 5' or '10 hotels'. 'the cheapest hotel/option' is NOT a count of 1: omit the key",
    sources: "array from: xotelo, searchapi, liteapi, hotelbeds, booking"
};

const toFlag = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

function toArgs(settings) {
    return Object.entries(settings)
        .filter(([key]) => key in SETTING_KEYS)
        .map(([key, value]) => `--${toFlag(key)}=${Array.isArray(value) ? value.join(",") : value}`);
}

// Backboard's cheap model, used when there is no Anthropic key (same BACKBOARD_API_KEY as the search source)
const BACKBOARD_URL = "https://app.backboard.io/api";
const backboardModel = () => ({
    provider: process.env.BACKBOARD_PARSER_PROVIDER || "openai",
    name: process.env.BACKBOARD_PARSER_MODEL || "gpt-4o-mini"
});

// Fixes typos ("monteral"), resolves relative dates ("tomorrow", "this Friday") against today, drops filler words
const systemPrompt = () => `Extract hotel search settings from the user's request. Fix obvious typos in place names, resolve relative dates such as "today", "tomorrow" or "Friday" against today's date, and turn "1 person" into adults. Reply with only a JSON object using any of these keys (omit what the user did not say): ${JSON.stringify(SETTING_KEYS)}. Today is ${new Date().toISOString().slice(0, 10)}.`;

const extractJson = text => {
    const json = text?.match(/\{[\s\S]*\}/)?.[0];
    if (!json) throw new Error(`no JSON in the reply: ${String(text).slice(0, 120)}`);
    return JSON.parse(json);
};

async function parseWithClaude(prompt) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 400,
            system: systemPrompt(),
            messages: [{ role: "user", content: prompt }]
        })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || response.status);

    return { settings: extractJson(data.content[0].text), usage: data.usage };
}

async function parseWithBackboard(prompt) {
    const model = backboardModel();
    const response = await fetch(`${BACKBOARD_URL}/threads/messages`, {
        method: "POST",
        headers: { "X-API-Key": process.env.BACKBOARD_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
            content: prompt,
            system_prompt: systemPrompt(),
            llm_provider: model.provider,
            model_name: model.name,
            web_search: "off",
            memory: "off",
            stream: false,
            send_to_llm: "true"
        })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(JSON.stringify(data.detail || data.message || response.status).slice(0, 200));
    if (data.status && data.status !== "COMPLETED") throw new Error(`run ${data.status}`);

    return { settings: extractJson(data.content), usage: { input_tokens: data.input_tokens ?? 0, output_tokens: data.output_tokens ?? 0 } };
}

// Tried in order; the first one whose key is set and that answers wins, regex is the last resort
const LLM_PARSERS = [
    { name: "Claude", envKey: "ANTHROPIC_API_KEY", parse: parseWithClaude, label: () => MODEL },
    { name: "Backboard", envKey: "BACKBOARD_API_KEY", parse: parseWithBackboard, label: () => `backboard/${backboardModel().name}` }
];

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

// --key=value or --key="value with spaces"
const FLAG_PATTERN = /--[\w-]+=(?:"[^"]*"|\S*)/g;

// Returns { args, settings, usage, parser } - args are ready to pass to search.js.
// offline: regex parser only, no API call (DEMO mode). literal: the prompt is a reviewed one (prompt_refine.js)
// that already carries every setting as a --flag, so use the flags as they are and don't parse the text again.
async function parsePrompt(prompt, { offline = false, literal = false } = {}) {
    // Explicit --key=value tokens are passed through as-is and win over anything parsed
    const flags = (prompt.match(FLAG_PATTERN) || []).map(flag => flag.replace(/="([^"]*)"$/, "=$1"));
    const text = prompt.replace(FLAG_PATTERN, " ");
    if (literal && flags.length) {
        return { args: flags, parser: "reviewed prompt", usage: null };
    }

    let parsed;
    let parser = "regex";
    let usage = null;
    const reasons = [];
    for (const llm of offline ? [] : LLM_PARSERS) {
        if (!process.env[llm.envKey]) continue;
        try {
            ({ settings: parsed, usage } = await llm.parse(text));
            parser = llm.label();
            break;
        } catch (error) {
            reasons.push(`${llm.name} failed: ${error.message}`);
            console.error(`${llm.name} prompt parsing failed (${error.message})`);
        }
    }
    if (!parsed && !offline && !reasons.length) {
        reasons.push("no ANTHROPIC_API_KEY or BACKBOARD_API_KEY is set");
    }
    parsed ||= parseWithRegex(text);

    // settings.js's default region belongs to its default city - another city must not inherit it
    // (a search for Paris would otherwise look for "Paris, Ontario" and the city check would drop every hotel)
    if (parsed.city && !("region" in parsed) && parsed.city.toLowerCase() !== defaults.city.toLowerCase()) {
        parsed.region = null;
    }

    const flagKeys = new Set(flags.map(flag => flag.slice(2).split("=")[0]));
    const args = [...toArgs(parsed).filter(arg => !flagKeys.has(arg.slice(2).split("=")[0])), ...flags];
    // Why the regex fallback was used (null when an LLM parsed it, or in offline/DEMO mode)
    return { args, parser, usage, fallbackReason: parser === "regex" && reasons.length ? reasons.join("; ") : null };
}

module.exports = { parsePrompt };
