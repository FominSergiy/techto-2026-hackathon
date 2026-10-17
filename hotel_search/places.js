// Adds address, phone number and links to hotels by matching them in Google Places (New).
// None of the price sources return phone numbers, so this is where they come from.
const settings = require("./settings");
const { requireEnv, getJson, normalizeName } = require("./hotel-utils");

const CONCURRENCY = 5;
const MAX_DISTANCE_M = 750;   // a Places match further than this from the source's coordinates is a different hotel
const LOOKUP_RETRIES = 2;     // Places answers 429/5xx now and then; without a retry that hotel silently gets no phone
const FIELD_MASK = [
    "places.displayName",
    "places.formattedAddress",
    "places.addressComponents",
    "places.internationalPhoneNumber",
    "places.location",
    "places.websiteUri",
    "places.googleMapsUri"
].join(",");

// Words that say nothing about which hotel it is
const GENERIC_WORDS = new Set(["hotel", "hotels", "the", "and", "by", "inn", "suites", "resort"]);

function tokens(name) {
    return new Set(normalizeName(name).split(" ").filter(word => word.length > 2 && !GENERIC_WORDS.has(word)));
}

// Share (0 to 1) of the shorter name's words that appear in the other
function overlap(a, b) {
    const [small, large] = [tokens(a), tokens(b)].sort((x, y) => x.size - y.size);
    if (!small.size) return 0;
    return [...small].filter(word => large.has(word)).length / small.size;
}

// True when enough of the words match, so a wrong hotel isn't given someone else's phone number
const sameHotel = (a, b, minOverlap) => overlap(a, b) >= minOverlap;

// Google Hotels sometimes puts the place in the name ("Knights Inn Burlington, ON", "Hotel X (Downtown)")
const cleanName = name => name.replace(/\s*\([^)]*\)\s*$/, "").replace(/,\s*[A-Za-z]{2}$/, "").trim();

function distanceMeters(a, b) {
    const rad = degrees => degrees * Math.PI / 180;
    const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2
        + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

async function searchPlaces(apiKey, query) {
    const data = await getJson("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK
        },
        body: JSON.stringify({ includedType: "lodging", regionCode: settings.countryCode, ...query })
    }, LOOKUP_RETRIES);
    return data.places || [];
}

// Why nothing matched, for the run log: what Places did return and how close the best name was
function describeMiss(name, spot, places) {
    if (!places.length) return "Places returned no lodging";
    const best = places.map(place => ({ place, share: overlap(name, place.displayName?.text) })).sort((a, b) => b.share - a.share)[0];
    const distance = spot && best.place.location ? `, ${(distanceMeters(spot, best.place.location) / 1000).toFixed(1)} km away` : "";
    return `${places.length} results, closest name "${best.place.displayName?.text}" (${Math.round(best.share * 100)}% of the words${distance})`;
}

// Chain hotels share most of their name (every "Holiday Inn Express & Suites ..."), so when the source gave
// coordinates the match must also be at that spot. Without coordinates the name has to match more closely.
// Returns { place } or { miss } (the reason). With coordinates the first search is by name around them; if the right
// place isn't among those few results, a second search by name and city looks further. Same acceptance rules for both.
async function findPlace(apiKey, hotel) {
    const spot = hotel.location;
    const name = cleanName(hotel.name);
    const where = [hotel.city || settings.city, settings.region].filter(Boolean).join(", ");
    const accept = place => sameHotel(name, place.displayName?.text, spot ? 0.5 : 0.75)
        && (!spot || !place.location || distanceMeters(spot, place.location) <= MAX_DISTANCE_M);

    const queries = [];
    if (spot) {
        queries.push({
            textQuery: name,
            locationBias: { circle: { center: { latitude: spot.latitude, longitude: spot.longitude }, radius: MAX_DISTANCE_M } },
            pageSize: 3
        });
    }
    queries.push({ textQuery: [name, where].filter(Boolean).join(", "), pageSize: 10 });

    const seen = [];
    for (const query of queries) {
        const places = await searchPlaces(apiKey, query);
        const place = places.find(accept);
        if (place) return { place };
        seen.push(...places);
    }
    return { miss: describeMiss(name, spot, seen) };
}

const component = (place, type) => place?.addressComponents?.find(part => part.types.includes(type));

// Where the place really is, from its structured address (not from the query we sent)
function locationOf(place) {
    const locality = component(place, "locality")
        || component(place, "postal_town")
        || component(place, "administrative_area_level_3")
        || component(place, "sublocality");

    return {
        city: locality?.longText || null,
        region: component(place, "administrative_area_level_1")?.longText || null,
        regionCode: component(place, "administrative_area_level_1")?.shortText || null,
        country: component(place, "country")?.shortText || null
    };
}

// Runs fn over items with at most `limit` calls in flight
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

// Returns the hotels with address, phone, website and mapsUrl filled in where Places has a match
async function enrichWithPlaces(hotels) {
    const [apiKey] = requireEnv("GOOGLE_MAPS_API_KEY");
    let failures = 0;
    const misses = [];

    const enriched = await mapLimit(hotels, CONCURRENCY, async hotel => {
        try {
            const { place, miss } = await findPlace(apiKey, hotel);
            if (miss) misses.push(`${hotel.name}: ${miss}`);
            const location = locationOf(place);
            return {
                ...hotel,
                city: location.city || hotel.city || null,
                region: location.region,
                regionCode: location.regionCode,
                country: location.country,
                address: place?.formattedAddress || hotel.address,
                phone: place?.internationalPhoneNumber || null,
                website: place?.websiteUri || null,
                mapsUrl: place?.googleMapsUri || null
            };
        } catch (error) {
            if (!failures++) {
                console.error(`Google Places lookup failed: ${error.message}`);
            }
            return { ...hotel, phone: null, website: null, mapsUrl: null };
        }
    });

    console.log(`Google Places: ${enriched.filter(hotel => hotel.phone).length} of ${hotels.length} hotels have a phone number`);
    misses.forEach(line => console.log(`  no Places match: ${line}`));
    return enriched;
}

module.exports = { enrichWithPlaces, cleanName };
