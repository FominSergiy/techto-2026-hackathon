// Offline tests for the Google Maps (Places only) search: the fixed queries, merging by place id, the city check and ordering.
// fetch is stubbed, so nothing is called or paid for. Run: node hotel_search/test/places-search.js
const assert = require("node:assert");
process.env.GOOGLE_MAPS_API_KEY = "test-key";
const settings = require("../settings");
Object.assign(settings, { region: "Ontario", countryCode: "CA" });
const { run, queriesFor, inCity, QUERY_TEMPLATES, normalize } = require("../places-search");

const address = (city, regionCode = "ON", region = "Ontario") => [
    { longText: city, shortText: city, types: ["locality"] },
    { longText: region, shortText: regionCode, types: ["administrative_area_level_1"] },
    { longText: "Canada", shortText: "CA", types: ["country"] }
];
const place = (id, name, extra = {}) => ({ id, displayName: { text: name }, formattedAddress: `1 Main St, ${name}`, addressComponents: address("Hamilton"), businessStatus: "OPERATIONAL", ...extra });

const PLACES = {
    a: place("a", "Alpha Inn", { internationalPhoneNumber: "+1 905-555-0100", rating: 4.1, userRatingCount: 200, websiteUri: "https://alpha.test", googleMapsUri: "https://maps.test/a" }),
    b: place("b", "Beta Hotel", { priceRange: { startPrice: { currencyCode: "CAD", units: "120" }, endPrice: { currencyCode: "CAD", units: "180" } }, rating: 3.9 }),
    c: place("c", "Gamma Motel", { priceRange: { startPrice: { currencyCode: "CAD", units: "90" } } }),
    closed: place("closed", "Closed Lodge", { businessStatus: "CLOSED_PERMANENTLY" }),
    elsewhere: place("elsewhere", "Burlington Suites", { addressComponents: address("Burlington") }),
    wrongProvince: place("wrongProvince", "Hamilton Inn NZ", { addressComponents: address("Hamilton", "WKO", "Waikato") })
};

// Which places each fixed search "finds" - Alpha turns up in three of them
const BY_QUERY = {
    "hotels in Hamilton, Ontario": [PLACES.a, PLACES.b, PLACES.elsewhere],
    "inns in Hamilton, Ontario": [PLACES.a, PLACES.closed],
    "motels in Hamilton, Ontario": [PLACES.c, PLACES.wrongProvince],
    "hotels at Hamilton, Ontario": [PLACES.a],
    "cheap hotels in Hamilton, Ontario": [PLACES.b]
};

const calls = [];
const realFetch = global.fetch;
function stubFetch(failQuery) {
    global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push({ url, headers: options.headers, body });
        if (body.textQuery === failQuery) {
            return { ok: false, status: 400, json: async () => ({ error: { message: "bad request" } }) };
        }
        return { ok: true, status: 200, json: async () => ({ places: BY_QUERY[body.textQuery] || [] }) };
    };
}

(async () => {
    // The prompt becomes 5 fixed searches for the city
    assert.strictEqual(QUERY_TEMPLATES.length, 5);
    assert.deepStrictEqual(queriesFor("Hamilton", "Ontario"), Object.keys(BY_QUERY));
    assert.deepStrictEqual(queriesFor("Hamilton", null)[0], "hotels in Hamilton");

    try {
        stubFetch();
        const { hotels, queries, dropped } = await run("Hamilton");

        assert.strictEqual(calls.length, 5, "one Places call per fixed query");
        assert.ok(calls.every(call => call.url === "https://places.googleapis.com/v1/places:searchText" && call.headers["X-Goog-Api-Key"] === "test-key"));
        assert.ok(calls.every(call => call.body.includedType === "lodging" && call.body.regionCode === "CA" && call.body.pageSize === 20));

        // 4 distinct lodging places in the city: Alpha, Beta, Gamma priced/unpriced; closed, Burlington and Waikato dropped
        assert.deepStrictEqual(hotels.map(hotel => hotel.name), ["Gamma Motel", "Beta Hotel", "Alpha Inn"], "priced cheapest first, then the rest by rating");
        assert.deepStrictEqual(dropped.map(entry => entry.name).sort(), ["Burlington Suites", "Closed Lodge", "Hamilton Inn NZ"]);
        assert.ok(dropped.find(entry => entry.name === "Closed Lodge").reason.includes("closed permanently"));

        const alpha = hotels.find(hotel => hotel.name === "Alpha Inn");
        assert.deepStrictEqual(alpha.foundBy, ["hotels in Hamilton, Ontario", "inns in Hamilton, Ontario", "hotels at Hamilton, Ontario"], "one row remembers every search that found it");
        assert.strictEqual(alpha.phone, "+1 905-555-0100");
        assert.strictEqual(alpha.city, "Hamilton");
        assert.strictEqual(alpha.url, "https://alpha.test");
        assert.strictEqual(alpha.mapsUrl, "https://maps.test/a");
        assert.strictEqual(alpha.nightlyPrice, null, "no price range, no price");

        const beta = hotels.find(hotel => hotel.name === "Beta Hotel");
        assert.strictEqual(beta.nightlyPrice, 120, "low end of Google's range");
        assert.strictEqual(beta.priceRange, "CAD 120-180");
        assert.strictEqual(hotels.find(hotel => hotel.name === "Gamma Motel").priceRange, "CAD 90+", "open-ended range");

        // Per-query numbers for the page: found and newly added
        assert.deepStrictEqual(queries.map(query => [query.returned, query.added]), [[3, 3], [2, 1], [2, 2], [1, 0], [1, 0]]);

        // One failed search doesn't sink the others
        calls.length = 0;
        stubFetch("inns in Hamilton, Ontario");
        const partial = await run("Hamilton");
        assert.ok(partial.queries[1].error.includes("bad request"));
        assert.strictEqual(partial.hotels.length, 3, "the other four searches still contribute");

        // Every search failing is an error
        calls.length = 0;
        global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "API key not valid" } }) });
        await assert.rejects(run("Hamilton"), /API key not valid/);
        await assert.rejects(run(""), /No city/);
    } finally {
        global.fetch = realFetch;
    }

    // Google files Sudbury hotels under "Greater Sudbury" (all 36 were dropped in the first live run)
    const sudbury = place("s", "Radisson Hotel Sudbury", { formattedAddress: "85 Ste Anne Rd, Sudbury, ON P3C 5E5, Canada", addressComponents: address("Greater Sudbury") });
    assert.ok(inCity(normalize(sudbury), "Sudbury"), "Greater Sudbury is Sudbury");
    assert.ok(inCity(normalize({ ...sudbury, formattedAddress: "1 Main St, Greater Sudbury, ON" }), "Sudbury"), "the locality alone is enough");
    assert.ok(inCity(normalize({ ...sudbury, addressComponents: address("Lively"), formattedAddress: "1 Main St, Sudbury, ON" }), "Sudbury"), "the formatted address naming the city is enough");
    assert.ok(!inCity(normalize({ ...sudbury, addressComponents: address("Burlington"), formattedAddress: "1 Main St, Burlington, ON" }), "Sudbury"), "another city still drops");
    assert.ok(!inCity(normalize({ ...sudbury, addressComponents: address("Sudbury", "MA", "Massachusetts"), formattedAddress: "1 Main St, Sudbury, MA" }), "Sudbury"), "same name in another region still drops");

    // normalize alone: a bare place still fills every field
    const bare = normalize({ id: "x", displayName: { text: "Bare Inn" } });
    assert.strictEqual(bare.phone, null);
    assert.strictEqual(bare.rating, null);
    assert.deepStrictEqual(bare.foundBy, []);

    console.log("places-search: all tests passed");
})();
