// Live OTA rates via Xotelo (TripAdvisor data) - https://xotelo.com/
// The whole flow lives here, through Xotelo's RapidAPI listing (/search is only offered there; needs RAPID_API_KEY):
//   /search finds the city's location key, /list pages through its hotels, /rates gives each hotel's live price.
const settings = require("./settings");
const { sleep, getJson, requireEnv, normalizeName, sameCity, normalizeHotel, addFetched, passesFilters, cheapest, runIfMain } = require("./hotel-utils");
const { cached } = require("./locations");

// RapidAPI hosts are "<api-slug>.p.rapidapi.com"; this one is a guess from the listing's slug, override it if the
// "Endpoints" tab on RapidAPI shows another X-RapidAPI-Host
const HOST = process.env.RAPIDAPI_XOTELO_HOST || "xotelo-hotel-prices.p.rapidapi.com";
const BASE_URL = `https://${HOST}/api`;
const PAGE_SIZE = 100;
const RATE_BATCH_SIZE = 10;
// Xotelo returns intermittent quick 500s (getJson backs off between attempts). The list call decides whether the
// whole source works, so it gets more attempts than the per-hotel rate lookups, which just count as "no rate" on failure.
const LIST_RETRIES = 3;
const RATE_RETRIES = 2;
// Tested live: for a city with many hotels (Toronto, Montreal, Hamilton) /list answers HTTP 200 with a 500 in the
// body after ~10.8s every time, whatever the limit or sort, while Aurora (5 hotels) answers in under a second.
// A failure that took this long is Xotelo's own timeout, so retrying only burns another 11s per attempt.
const SLOW_FAILURE_MS = 8000;

function headers() {
    const [key] = requireEnv("RAPID_API_KEY");
    return { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST };
}

// TripAdvisor city id (e.g. g499250) for settings.city, looked up once with /search and then cached
function locationKey() {
    if (settings.tripadvisorLocationKey) {
        return settings.tripadvisorLocationKey;
    }

    return cached("tripadvisorLocationKey", async () => {
        // Several cities share a name (Aurora, ON vs Aurora, IL), so the place must name our city and region
        const region = settings.region ? normalizeName(settings.region) : "";

        // "Toronto Ontario" and "Etobicoke Ontario" both got HTTP 400 "No results found" live, so after the city +
        // region query the bare city name is tried too (the region is then checked on the result, as above)
        const queries = [...new Set([[settings.city, settings.region].filter(Boolean).join(" "), settings.city])];
        let failure;
        for (const query of queries) {
            let list;
            try {
                // "No results" is a 400, not a blip, so no retries
                const params = new URLSearchParams({ query, location_type: "geo" });
                list = (await getJson(`${BASE_URL}/search?${params}`, { headers: headers() })).result?.list;
            } catch (error) {
                failure = error;
                continue;
            }
            const named = (list || []).filter(item => item.location_key && sameCity(item.name, settings.city));
            const match = named.find(item => normalizeName(item.place_name || "").includes(region)) || (region ? null : named[0]);
            if (match) return match.location_key;
        }
        throw new Error(`Xotelo /search found no place named "${settings.city}"${region ? ` in ${settings.region}` : ""}${failure ? ` (${failure.message})` : ""} - pass --tripadvisor-location-key`);
    });
}

// One /list item plus its live nightly rate (from /rates) -> the common hotel shape
function normalize(item, nightlyPrice) {
    return normalizeHotel({
        name: item.name,
        nightlyPrice,
        totalPrice: nightlyPrice != null ? nightlyPrice * settings.nights : null,
        currency: settings.currency,
        rating: item.review_summary?.rating,
        reviews: item.review_summary?.count,
        address: null,  // Xotelo only has coordinates - the street address comes from Google Places
        location: item.geo,
        url: item.url
    });
}

// Cheapest live nightly rate across OTAs, or null when nothing is available
async function lowestRate(hotelKey) {
    const params = new URLSearchParams({
        hotel_key: hotelKey,
        chk_in: settings.checkIn,
        chk_out: settings.checkOut,
        adults: String(settings.adults),
        currency: settings.currency
    });
    const { result } = await getJson(`${BASE_URL}/rates?${params}`, { headers: headers() }, RATE_RETRIES);
    const rates = result.rates.map(rate => rate.rate).filter(rate => rate != null);
    return rates.length ? Math.min(...rates) : null;
}

// One /list page. Quick failures are retried with backoff (a blip); a slow failure is Xotelo's timeout on a big
// city, so it fails at once with an explanation instead of hanging for a minute.
async function listPage(params) {
    for (let attempt = 0; ; attempt++) {
        const started = Date.now();
        try {
            return await getJson(`${BASE_URL}/list?${params}`, { headers: headers() });
        } catch (error) {
            const seconds = (Date.now() - started) / 1000;
            if (seconds * 1000 >= SLOW_FAILURE_MS) {
                throw new Error(`${error.message} after ${seconds.toFixed(0)}s - Xotelo's server times out listing cities with many hotels (Toronto, Montreal and Hamilton all do, Aurora works), so Xotelo cannot be used for this city`);
            }
            if (attempt >= LIST_RETRIES) throw error;
            await sleep(500 * 2 ** attempt);
        }
    }
}

async function search() {
    // 1. /search the city, then /list its hotels. The list's price ranges are typical prices, not live ones.
    const key = await locationKey();
    const listed = [];
    for (let page = 1; page <= settings.maxPages; page++) {
        const params = new URLSearchParams({
            location_key: key,
            offset: String((page - 1) * PAGE_SIZE),
            limit: String(PAGE_SIZE),
            sort: "best_value"
        });
        let result;
        try {
            ({ result } = await listPage(params));
        } catch (error) {
            // A later page failing must not throw away the pages already listed
            if (!listed.length) throw error;
            console.warn(`Xotelo list page ${page} failed (${error.message}), continuing with the ${listed.length} hotels already listed`);
            break;
        }
        listed.push(...result.list);
        addFetched(result.list.length);
        console.log(`Xotelo list page ${page}: ${listed.length} of ${result.total_count} hotels`);
        if (listed.length >= result.total_count) break;
    }

    // 2. Pre-filter on the typical price, cheapest first. Listings without a price range
    // (private rooms, rentals) drop out here; TripAdvisor types real hotels inconsistently
    // ("Hotel", "Limited Service Property", ...), so the type isn't used.
    const candidates = listed
        .filter(item => passesFilters(normalize(item, item.price_ranges?.minimum ?? null)))
        .sort((a, b) => a.price_ranges.minimum - b.price_ranges.minimum);

    // 3. Check live rates in batches until enough hotels match
    const matches = [];
    for (let i = 0; i < candidates.length && matches.length < settings.targetCount; i += RATE_BATCH_SIZE) {
        const batch = candidates.slice(i, i + RATE_BATCH_SIZE);
        const rates = await Promise.all(batch.map(item => lowestRate(item.key).catch(error => {
            console.warn(`Xotelo rate lookup failed for ${item.name}: ${error.message}`);
            return null;
        })));

        matches.push(...batch.map((item, index) => normalize(item, rates[index])).filter(passesFilters));
        const noRates = rates.filter(rate => rate == null).length;
        console.log(`Xotelo rates checked for ${i + batch.length} hotels (${noRates} with no live rates), ${matches.length} match filters`);
    }

    return cheapest(matches);
}

module.exports = { search, listPage, locationKey, normalize };
runIfMain(module, "Xotelo", search);
