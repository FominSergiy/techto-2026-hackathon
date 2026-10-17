// Hotel price source backed by Backboard (https://docs.backboard.io): one stateless call to
// POST /threads/messages with web search on, asking the model to return the cheapest hotels as JSON.
// Prices come from web pages the model reads, so treat them as hints and re-quote on the phone.
//
//   BACKBOARD_API_KEY=... node backboard_search/backboard.js --city=Aurora --region=Ontario --country-code=CA
//   node backboard_search/backboard.js --city=Paris --dry-run     # print the request, no API call
//
// Env: BACKBOARD_API_KEY (required), BACKBOARD_PROVIDER (default openai), BACKBOARD_MODEL (default gpt-4o)
try {
    process.loadEnvFile();
} catch {
    // No .env file - rely on the environment
}

const BASE_URL = "https://app.backboard.io/api";
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

function nextSaturday() {
    const now = new Date();
    const days = (6 - now.getUTCDay() + 7) % 7 || 7;
    return isoDate(now.getTime() + days * DAY_MS);
}

function defaults() {
    return {
        city: "Aurora",
        region: "Ontario",
        countryCode: "CA",
        checkIn: null,
        checkOut: null,
        nights: 1,
        adults: 2,
        currency: "CAD",
        maxNightlyPrice: null,
        count: 10,
        provider: process.env.BACKBOARD_PROVIDER || "openai",
        model: process.env.BACKBOARD_MODEL || "gpt-4o",
        timeoutMs: 120000
    };
}

// Fills in the dates the same way hotel_search/settings.js does: next Saturday, checkOut = checkIn + nights
function resolve(options = {}) {
    const settings = { ...defaults(), ...options };
    settings.checkIn = settings.checkIn || nextSaturday();
    settings.checkOut = settings.checkOut || isoDate(Date.parse(settings.checkIn) + settings.nights * DAY_MS);
    settings.nights = (Date.parse(settings.checkOut) - Date.parse(settings.checkIn)) / DAY_MS;
    return settings;
}

function buildRequest(settings) {
    const where = [settings.city, settings.region, settings.countryCode].filter(Boolean).join(", ");
    const limit = settings.maxNightlyPrice != null ? ` Only include hotels at or under ${settings.maxNightlyPrice} ${settings.currency} per night.` : "";

    // `prompt` is the UI's free-text mode: the user's own words define city, dates, guests and currency
    const content = settings.prompt
        || `Find the ${settings.count} cheapest hotels located in ${where} for check-in ${settings.checkIn}, check-out ${settings.checkOut} (${settings.nights} night${settings.nights === 1 ? "" : "s"}), ${settings.adults} adults.${limit}`;
    const context = settings.prompt
        ? `Today is ${isoDate(Date.now())}. The request names the city, dates and guests; if it gives no dates use the next Saturday for one night.`
        : "";

    return {
        content,
        system_prompt: [
            "You are a hotel price researcher. Use web search to find current room rates and phone numbers.",
            context,
            "Reply with ONLY a JSON array, no prose and no code fences. Each element:",
            `{"name": string, "address": string|null, "phone": string|null (international format), "nightlyPrice": number (per night, taxes excluded unless only the taxed price is shown), "totalPrice": number|null, "currency": string (ISO code of the prices; ${settings.currency} unless the request asks for another), "rating": number|null (out of 5), "url": string|null (page where you saw the price)}.`,
            "Sort by nightlyPrice ascending. Only hotels inside the named city. If you cannot find a real price, omit the hotel. Never invent prices or phone numbers; use null when unknown."
        ].filter(Boolean).join("\n"),
        llm_provider: settings.provider,
        model_name: settings.model,
        web_search: "Auto",
        memory: "off",
        stream: false,
        send_to_llm: "true"
    };
}

// The model sometimes wraps the array in prose or a ```json fence, so cut out the outermost [...]
function parseHotels(text) {
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
        throw new Error(`Backboard returned no JSON array: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text.slice(start, end + 1));
}

function toHotel(raw, settings) {
    const nightlyPrice = Number(raw.nightlyPrice);
    if (!raw.name || !Number.isFinite(nightlyPrice) || nightlyPrice <= 0) {
        return null;
    }
    return {
        name: String(raw.name).trim(),
        city: settings.city,
        nightlyPrice: Math.round(nightlyPrice),
        // Free-text mode has no known night count, so only trust a total the model actually found
        totalPrice: raw.totalPrice != null && Number.isFinite(Number(raw.totalPrice))
            ? Math.round(Number(raw.totalPrice))
            : settings.prompt ? null : Math.round(nightlyPrice * settings.nights),
        currency: raw.currency || settings.currency,
        rating: raw.rating ?? null,
        reviews: null,
        address: raw.address || null,
        phone: raw.phone || null,
        url: raw.url || null
    };
}

// Returns hotels in the shape the other sources use ({ name, nightlyPrice, totalPrice, currency, ... }),
// cheapest first. Also sets `search.lastRun` with timing and token usage for the learnings log.
async function search(options = {}) {
    const apiKey = process.env.BACKBOARD_API_KEY;
    if (!apiKey) {
        throw new Error("BACKBOARD_API_KEY is not set");
    }

    const settings = resolve(options);
    const started = Date.now();
    const response = await fetch(`${BASE_URL}/threads/messages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(buildRequest(settings)),
        signal: AbortSignal.timeout(settings.timeoutMs)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Backboard ${response.status}: ${JSON.stringify(data.detail || data.message || data).slice(0, 300)}`);
    }
    if (data.status && data.status !== "COMPLETED") {
        throw new Error(`Backboard run ${data.status}`);
    }

    search.lastRun = {
        seconds: (Date.now() - started) / 1000,
        model: `${data.model_provider || settings.provider}/${data.model_name || settings.model}`,
        inputTokens: data.input_tokens ?? null,
        outputTokens: data.output_tokens ?? null,
        threadId: data.thread_id
    };

    return parseHotels(data.content || "")
        .map(raw => toHotel(raw, settings))
        .filter(Boolean)
        .sort((a, b) => a.nightlyPrice - b.nightlyPrice)
        .slice(0, settings.count);
}

// --flag=value args, camelCased: --check-in=2026-11-20 -> checkIn
function parseArgs(argv) {
    const options = {};
    for (const arg of argv) {
        const match = arg.match(/^--([\w-]+)(?:=(.*))?$/);
        if (!match) continue;
        const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const value = match[2] ?? "true";
        options[key] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    }
    return options;
}

async function main() {
    const { dryRun, ...options } = parseArgs(process.argv.slice(2));
    if (dryRun) {
        console.log(JSON.stringify(buildRequest(resolve(options)), null, 2));
        return;
    }

    const hotels = await search(options);
    console.table(hotels.map(({ name, nightlyPrice, totalPrice, currency, phone, rating }) => ({ name, nightlyPrice, totalPrice, currency, phone, rating })));
    const run = search.lastRun;
    console.log(`Backboard: ${hotels.length} hotels in ${run.seconds.toFixed(1)}s, ${run.model}, tokens in/out ${run.inputTokens}/${run.outputTokens}`);
}

module.exports = { search, buildRequest, parseHotels, toHotel, resolve };

if (require.main === module) {
    main().catch(error => {
        console.error(`Backboard failed: ${error.message}`);
        process.exit(1);
    });
}
