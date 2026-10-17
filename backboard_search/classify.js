// Ranks hotels by expected price with a Backboard model (web search on): the model gets only names, addresses and
// ratings, looks the properties up when it doesn't know them, and answers with a typical nightly price and a class
// (budget / midscale / upscale / luxury) for each. The prices are estimates, not rates for any dates: use them to
// decide whom to ring first, not as a quote. One stateless call to POST /threads/messages, like backboard.js.
//
// Env: BACKBOARD_API_KEY (required), BACKBOARD_PROVIDER (default openai), BACKBOARD_MODEL (default gpt-4o)
const fs = require("node:fs");
const path = require("node:path");
const { parseHotels, toNumber } = require("./backboard");

const BASE_URL = "https://app.backboard.io/api";
const MAX_HOTELS = 20;   // how many hotels one call classifies (more makes the model skip hotels and the call slow)
const TIERS = ["budget", "midscale", "upscale", "luxury"];
const CONFIDENCE = ["high", "medium", "low"];

// The hotels worth asking about when there are more than `max`: those several Maps searches agreed on, then the
// most reviewed (a hotel with many reviews has pages the model can price). Keeps their order otherwise.
function pickCandidates(hotels, max = MAX_HOTELS) {
    return hotels
        .map((hotel, index) => ({ hotel, index }))
        .sort((a, b) => (b.hotel.foundBy?.length ?? 0) - (a.hotel.foundBy?.length ?? 0) || (b.hotel.reviews ?? 0) - (a.hotel.reviews ?? 0) || a.index - b.index)
        .slice(0, max)
        .map(({ hotel }) => hotel);
}

function buildRequest(candidates, { city, region, countryCode = "CA", currency = "CAD", provider, model } = {}) {
    const where = [city, region, countryCode].filter(Boolean).join(", ");
    const list = candidates.map((hotel, id) => ({
        id,
        name: hotel.name,
        address: hotel.address,
        rating: hotel.rating,
        reviews: hotel.reviews,
        googlePriceHint: hotel.priceRange || hotel.priceLevel || null
    }));

    return {
        content: `Hotels found on Google Maps in ${where}. Estimate what each one typically costs per night.\n${JSON.stringify(list)}`,
        system_prompt: [
            `You are a hotel pricing analyst. For every lodging in the list, estimate its typical price for one standard room for 1-2 adults on an ordinary (non-holiday) night in the next month, in ${currency}, taxes excluded.`,
            "Judge from the name (brand and class: Super 8 and Days Inn are budget, Hilton Garden Inn is upscale), the address and area, and the rating and review count. When you don't know a property or are unsure, use web search to find its current rates (Google Hotels, Booking.com, Expedia, the hotel's own site). Search as often as needed.",
            "Reply with ONLY a JSON array, no prose and no code fences, with exactly one element per input hotel, in any order:",
            `{"id": number (the id from the input), "expectedPrice": number (a plain JSON number in ${currency}, never null: make your best estimate), "tier": "budget"|"midscale"|"upscale"|"luxury", "confidence": "high"|"medium"|"low" ("high" only for a rate you saw on a page, "low" for a guess from the name alone), "basis": string (under 15 words: what the estimate rests on, e.g. "Booking.com shows about 120" or "budget chain, small town")}.`,
            "Never leave a hotel out and never invent a page you did not see."
        ].join("\n"),
        llm_provider: provider || process.env.BACKBOARD_PROVIDER || "openai",
        model_name: model || process.env.BACKBOARD_MODEL || "gpt-4o",
        web_search: "Auto",
        memory: "off",
        stream: false,
        send_to_llm: "true"
    };
}

// The model's array -> { byId: Map(id -> estimate), unusable: [reasons] }. An entry needs a known id and a price above 0;
// tier and confidence are kept only when they are one of the allowed words.
function parseRanking(text, candidates) {
    const byId = new Map();
    const unusable = [];
    const lower = candidates.map(hotel => hotel.name?.toLowerCase());

    for (const raw of parseHotels(text)) {
        // Answering with the name instead of the id happens now and then
        const id = Number.isInteger(Number(raw?.id)) && raw?.id != null && raw.id !== "" ? Number(raw.id) : lower.indexOf(String(raw?.name ?? "").toLowerCase());
        const price = toNumber(raw?.expectedPrice);
        if (!candidates[id]) {
            unusable.push(`${raw?.name ?? `id ${raw?.id}`}: not one of the hotels sent`);
        } else if (!Number.isFinite(price) || price <= 0) {
            unusable.push(`${candidates[id].name}: no usable price`);
        } else if (!byId.has(id)) {
            byId.set(id, {
                expectedPrice: Math.round(price),
                priceClass: TIERS.includes(raw.tier) ? raw.tier : null,
                priceConfidence: CONFIDENCE.includes(raw.confidence) ? raw.confidence : null,
                priceBasis: raw.basis ? String(raw.basis).slice(0, 160) : null
            });
        }
    }
    return { byId, unusable };
}

// Every hotel back, the analysed ones first and cheapest expected price first, the rest after in their given order
// with a priceBasis that says why they have no estimate.
function applyRanking(hotels, candidates, byId, noEstimate = "not sent to the model") {
    const estimate = new Map(candidates.map((hotel, id) => [hotel, byId.get(id)]).filter(([, value]) => value));
    const withEstimate = hotels.filter(hotel => estimate.has(hotel)).map(hotel => ({ ...hotel, ...estimate.get(hotel) }));
    withEstimate.sort((a, b) => a.expectedPrice - b.expectedPrice || (b.rating ?? 0) - (a.rating ?? 0));

    const rest = hotels.filter(hotel => !estimate.has(hotel)).map(hotel => ({
        ...hotel,
        expectedPrice: null,
        priceClass: null,
        priceConfidence: null,
        priceBasis: candidates.includes(hotel) ? "the model gave no estimate" : noEstimate
    }));
    return [...withEstimate, ...rest];
}

// Keeps Backboard's reply as received in output/raw/backboard-classify/<timestamp>.json. A failed save is only a warning.
function saveRaw(data) {
    try {
        const dir = path.join("output", "raw", "backboard-classify");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify([data], null, 2));
    } catch (error) {
        console.warn(`Could not save raw Backboard classify response: ${error.message}`);
    }
}

// Classifies up to `max` of the hotels and returns { hotels, run }: all hotels (ranked as applyRanking says) and what
// the call did. Throws when Backboard fails or answers with nothing usable; the caller keeps the unranked hotels.
async function classify(hotels, options = {}) {
    const apiKey = process.env.BACKBOARD_API_KEY;
    if (!apiKey) {
        throw new Error("BACKBOARD_API_KEY is not set");
    }
    const candidates = pickCandidates(hotels, options.max);
    if (!candidates.length) {
        return { hotels, run: { sent: 0, ranked: 0, unusable: [], seconds: 0, model: null, inputTokens: null, outputTokens: null, reply: "" } };
    }

    const request = buildRequest(candidates, options);
    const started = Date.now();
    const response = await fetch(`${BASE_URL}/threads/messages`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options.timeoutMs ?? 180000)
    });
    const data = await response.json().catch(() => ({}));
    saveRaw(data);
    if (!response.ok) {
        throw new Error(`Backboard ${response.status}: ${JSON.stringify(data.detail || data.message || data).slice(0, 300)}`);
    }
    if (data.status && data.status !== "COMPLETED") {
        throw new Error(`Backboard run ${data.status}`);
    }

    const { byId, unusable } = parseRanking(data.content || "", candidates);
    if (!byId.size) {
        throw new Error(`Backboard gave no usable estimate: ${String(data.content || "").slice(0, 200)}`);
    }
    return {
        hotels: applyRanking(hotels, candidates, byId),
        run: {
            sent: candidates.length,
            ranked: byId.size,
            unusable,
            seconds: (Date.now() - started) / 1000,
            model: `${data.model_provider || request.llm_provider}/${data.model_name || request.model_name}`,
            inputTokens: data.input_tokens ?? null,
            outputTokens: data.output_tokens ?? null,
            reply: String(data.content || "").slice(0, 6000)
        }
    };
}

module.exports = { classify, pickCandidates, buildRequest, parseRanking, applyRanking, MAX_HOTELS };
