// Live OTA rates via Xotelo (TripAdvisor data, no API key) - https://xotelo.com/
const settings = require("./settings");
const { getJson, passesFilters, cheapest, runIfMain } = require("./hotel-utils");
const { tripadvisorLocationKey } = require("./locations");

const BASE_URL = "https://data.xotelo.com/api";
const PAGE_SIZE = 100;
const RATE_BATCH_SIZE = 10;
const RETRIES = 2;  // Xotelo returns intermittent 500s

function toHotel(item, nightlyPrice) {
    return {
        name: item.name,
        nightlyPrice,
        totalPrice: nightlyPrice != null ? nightlyPrice * settings.nights : null,
        currency: settings.currency,
        rating: item.review_summary?.rating ?? null,
        reviews: item.review_summary?.count ?? null,
        address: null,  // Xotelo only has coordinates - the street address comes from Google Places
        url: item.url
    };
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
    const { result } = await getJson(`${BASE_URL}/rates?${params}`, {}, RETRIES);
    const rates = result.rates.map(rate => rate.rate).filter(rate => rate != null);
    return rates.length ? Math.min(...rates) : null;
}

async function search() {
    // 1. Pull the hotel list. Its price ranges are typical prices, not live ones.
    const locationKey = await tripadvisorLocationKey();
    const listed = [];
    for (let page = 1; page <= settings.maxPages; page++) {
        const params = new URLSearchParams({
            location_key: locationKey,
            offset: String((page - 1) * PAGE_SIZE),
            limit: String(PAGE_SIZE),
            sort: "best_value"
        });
        const { result } = await getJson(`${BASE_URL}/list?${params}`, {}, RETRIES);
        listed.push(...result.list);
        console.log(`Xotelo list page ${page}: ${listed.length} of ${result.total_count} hotels`);
        if (listed.length >= result.total_count) break;
    }

    // 2. Pre-filter on the typical price, cheapest first
    const candidates = listed
        .filter(item => item.accommodation_type === "Hotel")
        .filter(item => passesFilters(toHotel(item, item.price_ranges?.minimum ?? null)))
        .sort((a, b) => a.price_ranges.minimum - b.price_ranges.minimum);

    // 3. Check live rates in batches until enough hotels match
    const matches = [];
    for (let i = 0; i < candidates.length && matches.length < settings.targetCount; i += RATE_BATCH_SIZE) {
        const batch = candidates.slice(i, i + RATE_BATCH_SIZE);
        const rates = await Promise.all(batch.map(item => lowestRate(item.key).catch(() => null)));

        matches.push(...batch.map((item, index) => toHotel(item, rates[index])).filter(passesFilters));
        console.log(`Xotelo rates checked for ${i + batch.length} hotels, ${matches.length} match filters`);
    }

    return cheapest(matches);
}

module.exports = { search };
runIfMain(module, "Xotelo", search);
