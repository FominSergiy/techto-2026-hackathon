// Google Maps only: finds lodging in a city with a few fixed Places (New) text searches, no price API involved.
// Same lookups as typing "hotels in Hamilton" into Google Maps. Gives name, address, phone, website, rating and,
// for the few places that have one, Google's rough price range (a hint, not a rate for any dates).
// Each search is one Places Text Search call (Enterprise SKU because of the phone and price fields), so a run costs QUERY_TEMPLATES.length calls.
const settings = require("./settings");
const { requireEnv, getJson, normalizeHotel, matchesCity, runIfMain } = require("./hotel-utils");
const { locationOf } = require("./places");

// {place} becomes "Hamilton", or "Hamilton, Ontario" when the request named a province
const QUERY_TEMPLATES = ["hotels in {place}", "inns in {place}", "motels in {place}", "hotels at {place}", "cheap hotels in {place}"];
const PAGE_SIZE = 20;   // Places' maximum per page; only the first page of each search is read
const RETRIES = 2;
const FIELD_MASK = [
    "places.id",
    "places.displayName",
    "places.formattedAddress",
    "places.addressComponents",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.googleMapsUri",
    "places.location",
    "places.rating",
    "places.userRatingCount",
    "places.priceLevel",
    "places.priceRange",
    "places.businessStatus"
].join(",");

const queriesFor = (city, region) => QUERY_TEMPLATES.map(template => template.replace("{place}", [city, region].filter(Boolean).join(", ")));

const money = value => (value?.units != null || value?.nanos ? Number(value.units || 0) + (value.nanos || 0) / 1e9 : null);

// "CAD 100-150", "CAD 100+" or null
function priceRangeText(range) {
    const start = money(range?.startPrice);
    if (start == null) return null;
    const end = money(range.endPrice);
    return `${range.startPrice.currencyCode} ${start}${end != null ? `-${end}` : "+"}`;
}

// One Places result -> the common hotel shape, plus what only this source knows
function normalize(place, foundBy = []) {
    const where = locationOf(place);
    return {
        ...normalizeHotel({
            name: place.displayName?.text,
            city: where.city,
            address: place.formattedAddress,
            phone: place.internationalPhoneNumber,
            nightlyPrice: money(place.priceRange?.startPrice),   // the low end of Google's range: a hint only
            currency: place.priceRange?.startPrice?.currencyCode,
            rating: place.rating,
            reviews: place.userRatingCount,
            url: place.websiteUri || place.googleMapsUri,
            location: place.location
        }),
        region: where.region,
        regionCode: where.regionCode,
        country: where.country,
        priceRange: priceRangeText(place.priceRange),
        priceLevel: place.priceLevel || null,
        mapsUrl: place.googleMapsUri || null,
        foundBy
    };
}

async function textSearch(apiKey, textQuery) {
    const data = await getJson("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
        body: JSON.stringify({ textQuery, includedType: "lodging", regionCode: settings.countryCode, pageSize: PAGE_SIZE })
    }, RETRIES);
    return data.places || [];
}

// True when the place is in the searched city (see matchesCity: "Greater Sudbury" counts as Sudbury) and in the searched
// country, in any province: this search covers all of Canada, so a same-named city elsewhere in Canada is not told apart
// (put the province in the request, "Hamilton, Ontario", and it goes into the Maps queries). A place Google gave no
// city or country for is kept.
function inCity(hotel, city) {
    return (!hotel.city || matchesCity(hotel, city))
        && (!hotel.country || hotel.country.toLowerCase() === settings.countryCode.toLowerCase());
}

// Runs every query, merges by Places id (a hotel found by three searches is one row that remembers all three),
// drops closed places and places outside the city. Returns { hotels, queries, dropped }.
// `region` (a province, only when the request named one) goes into the query text to tell same-named cities apart; it is not a filter.
async function run(city = settings.city, region = null) {
    if (!city) {
        throw new Error("No city given");
    }
    const [apiKey] = requireEnv("GOOGLE_MAPS_API_KEY");
    const queries = queriesFor(city, region);
    const outcomes = await Promise.allSettled(queries.map(query => textSearch(apiKey, query)));

    if (outcomes.every(outcome => outcome.status === "rejected")) {
        throw outcomes[0].reason;
    }

    const byId = new Map();
    const summary = outcomes.map((outcome, index) => {
        if (outcome.status === "rejected") {
            return { query: queries[index], returned: 0, added: 0, error: outcome.reason.message };
        }
        let added = 0;
        for (const place of outcome.value) {
            const existing = byId.get(place.id);
            if (existing) {
                existing.foundBy.push(queries[index]);
            } else {
                byId.set(place.id, { place, foundBy: [queries[index]] });
                added++;
            }
        }
        return { query: queries[index], returned: outcome.value.length, added };
    });

    const hotels = [];
    const dropped = [];
    for (const { place, foundBy } of byId.values()) {
        const hotel = normalize(place, foundBy);
        if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
            dropped.push({ name: hotel.name, reason: `${place.businessStatus.toLowerCase().replace(/_/g, " ")}` });
        } else if (!inCity(hotel, city)) {
            dropped.push({ name: hotel.name, reason: `in ${[hotel.city, hotel.regionCode].filter(Boolean).join(", ")}` });
        } else {
            hotels.push(hotel);
        }
    }

    // A priced hotel first (cheapest first), then the rest by rating
    hotels.sort((a, b) => (a.nightlyPrice ?? Infinity) - (b.nightlyPrice ?? Infinity) || (b.rating ?? 0) - (a.rating ?? 0));
    console.log(`Google Maps: ${hotels.length} hotels from ${queries.length} searches (${hotels.filter(hotel => hotel.phone).length} with a phone), ${dropped.length} dropped`);
    return { hotels, queries: summary, dropped };
}

const search = async city => (await run(city)).hotels;

module.exports = { run, search, normalize, queriesFor, inCity, QUERY_TEMPLATES };
runIfMain(module, "Google Maps", () => search());
