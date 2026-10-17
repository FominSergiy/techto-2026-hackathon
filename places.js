// Adds address, phone number and links to hotels by matching them in Google Places (New).
// None of the price sources return phone numbers, so this is where they come from.
const settings = require("./settings");
const { requireEnv, getJson, normalizeName } = require("./hotel-utils");

const CONCURRENCY = 5;
const FIELD_MASK = [
    "places.displayName",
    "places.formattedAddress",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.googleMapsUri"
].join(",");

// Words that say nothing about which hotel it is
const GENERIC_WORDS = new Set(["hotel", "hotels", "the", "and", "by", "inn", "suites", "resort"]);

function tokens(name) {
    return new Set(normalizeName(name).split(" ").filter(word => word.length > 2 && !GENERIC_WORDS.has(word)));
}

// True when at least half of the shorter name's words appear in the other, so a wrong
// hotel isn't given someone else's phone number
function sameHotel(a, b) {
    const [small, large] = [tokens(a), tokens(b)].sort((x, y) => x.size - y.size);
    if (!small.size) return false;
    return [...small].filter(word => large.has(word)).length / small.size >= 0.5;
}

async function findPlace(apiKey, hotel) {
    const data = await getJson("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK
        },
        body: JSON.stringify({
            textQuery: `${hotel.name} ${hotel.city}`,
            includedType: "lodging",
            regionCode: settings.countryCode,
            pageSize: 3
        })
    });
    return (data.places || []).find(place => sameHotel(hotel.name, place.displayName?.text));
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

    const enriched = await mapLimit(hotels, CONCURRENCY, async hotel => {
        try {
            const place = await findPlace(apiKey, hotel);
            return {
                ...hotel,
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
    return enriched;
}

module.exports = { enrichWithPlaces };
