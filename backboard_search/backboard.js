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

const fs = require("node:fs");
const path = require("node:path");

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
        count: 20,
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
            "Search as many times as you need (Google Hotels, Booking.com, Expedia, the hotels' own sites) to list the requested number of hotels. Do not stop after the first result.",
            context,
            "Reply with ONLY a JSON array, no prose and no code fences. Each element:",
            `{"name": string, "address": string|null, "phone": string|null (international format), "nightlyPrice": number|null (a plain JSON number, no currency symbol; per night, taxes excluded unless only the taxed price is shown; null if no price is shown anywhere), "priceType": "quoted"|"from"|"none" ("quoted" only if you saw the rate for these exact dates, "from" for the lowest nightly rate a page shows, "none" when you found no price), "totalPrice": number|null, "currency": string (ISO code of the prices; ${settings.currency} unless the request asks for another), "rating": number|null (out of 5), "url": string|null (page where you saw the price)}.`,
            "Sort by nightlyPrice ascending, hotels without a price last. Only hotels inside the named city. List every hotel you find, even without a price: never leave a hotel out because its price is unconfirmed (use a \"from\" rate if that is all you can see, or null with priceType \"none\"). Never invent prices or phone numbers; use null when unknown."
        ].filter(Boolean).join("\n"),
        llm_provider: settings.provider,
        model_name: settings.model,
        web_search: "Auto",
        memory: "off",
        stream: false,
        send_to_llm: "true"
    };
}

// The model sometimes wraps the array in prose, a ```json fence or citation marks like [1], so cut from the
// first "[{" to the last "}]"
function parseHotels(text) {
    const array = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (array) {
        try {
            return JSON.parse(array[0]);
        } catch (error) {
            throw new Error(`Backboard reply was not valid JSON (${error.message}): ${text.slice(0, 200)}`);
        }
    }
    if (/\[\s*\]/.test(text)) {
        return [];
    }
    throw new Error(`Backboard returned no JSON array: ${text.slice(0, 200)}`);
}

// Models answer "$112", "112 CAD" or "1,234.50" as well as 112
function toNumber(value) {
    if (typeof value === "number") return value;
    const match = String(value ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
    return match ? Number(match[0]) : NaN;
}

// Why a returned entry cannot be shown, or null when it can. A missing price is not a reason: hotels the
// model could not price are kept (nightlyPrice null, priceType "none") so the caller can ring them anyway.
function dropReason(raw) {
    return raw?.name ? null : "no name";
}

function toHotel(raw, settings) {
    if (dropReason(raw)) {
        return null;
    }
    const nightlyPrice = toNumber(raw.nightlyPrice);
    const priced = Number.isFinite(nightlyPrice) && nightlyPrice > 0;
    const total = toNumber(raw.totalPrice);
    return {
        name: String(raw.name).trim(),
        city: settings.city,
        location: null,   // the model gives no coordinates (keeps the same fields as the hotel_search sources)
        nightlyPrice: priced ? Math.round(nightlyPrice) : null,
        // "quoted" = the rate for these dates, "from" = the lowest nightly rate a page showed, "none" = no price found
        priceType: !priced ? "none" : raw.priceType === "from" ? "from" : "quoted",
        // Free-text mode has no known night count, so only trust a total the model actually found
        totalPrice: Number.isFinite(total) && total > 0
            ? Math.round(total)
            : priced && !settings.prompt ? Math.round(nightlyPrice * settings.nights) : null,
        currency: raw.currency || settings.currency,
        rating: raw.rating ?? null,
        reviews: null,
        address: raw.address || null,
        phone: raw.phone || null,
        url: raw.url || null
    };
}

// Keeps Backboard's reply exactly as received in output/raw/backboard/<timestamp>[-<city>].json, an array with one
// entry like the hotel_search sources' files (this folder doesn't import hotel_search). A failed save is only a warning.
function saveRaw(data, settings) {
    try {
        const dir = path.join("output", "raw", "backboard");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const city = settings.prompt ? "" : `-${String(settings.city).toLowerCase().replace(/\W+/g, "-")}`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${stamp}${city}.json`), JSON.stringify([data], null, 2));
    } catch (error) {
        console.warn(`Could not save raw Backboard response: ${error.message}`);
    }
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
    saveRaw(data, settings);
    if (!response.ok) {
        throw new Error(`Backboard ${response.status}: ${JSON.stringify(data.detail || data.message || data).slice(0, 300)}`);
    }
    if (data.status && data.status !== "COMPLETED") {
        throw new Error(`Backboard run ${data.status}`);
    }

    const returned = parseHotels(data.content || "");
    const hotels = returned
        .map(raw => toHotel(raw, settings))
        .filter(Boolean)
        // Priced hotels cheapest first, then the ones with no price (in the order the model gave them)
        .sort((a, b) => (a.nightlyPrice ?? Infinity) - (b.nightlyPrice ?? Infinity) || 0)
        .slice(0, settings.count);

    // `returned` / `dropped` / `reply` say why a run gave few hotels: the model found few, or entries were unusable
    search.lastRun = {
        seconds: (Date.now() - started) / 1000,
        model: `${data.model_provider || settings.provider}/${data.model_name || settings.model}`,
        inputTokens: data.input_tokens ?? null,
        outputTokens: data.output_tokens ?? null,
        threadId: data.thread_id,
        returned: returned.length,
        dropped: returned.map(raw => ({ name: raw?.name ?? null, reason: dropReason(raw) })).filter(entry => entry.reason),
        reply: String(data.content || "").slice(0, 6000)
    };
    return hotels;
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
    console.log(`Backboard: ${hotels.length} hotels (model returned ${run.returned}, dropped ${run.dropped.length}) in ${run.seconds.toFixed(1)}s, ${run.model}, tokens in/out ${run.inputTokens}/${run.outputTokens}`);
    run.dropped.forEach(entry => console.log(`  dropped: ${entry.name ?? "?"} - ${entry.reason}`));
}

module.exports = { search, buildRequest, parseHotels, toHotel, toNumber, dropReason, resolve };

if (require.main === module) {
    main().catch(error => {
        console.error(`Backboard failed: ${error.message}`);
        process.exit(1);
    });
}
