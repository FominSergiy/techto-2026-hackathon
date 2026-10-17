// Offline test: the report says what every API returned and what the city check did. Replays the real "Humber Bay" run:
// SearchApi gave 17 Toronto hotels, LiteAPI had none, the Apify Google actor answered "free allowance used up", and Google
// Places placed every hotel in "Toronto", so the city check removed them all. fetch is faked, no API is called.
// Run: node hotel_search/test/run-report.js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

Object.assign(process.env, { SEARCH_API_KEY: "k", LITE_API_KEY: "k", APIFY_KEY: "k", GOOGLE_MAPS_API_KEY: "k" });
const settings = require("../settings");
const { search } = require("../index");
const searchapi = require("./fixtures/searchapi-humber-bay.json");

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "run-report-")));   // raw files go under ./output/raw
Object.assign(settings, { region: "Ontario", countryCode: "CA", sources: ["searchapi", "liteapi", "apifygoogle"], enrichPhones: true, strictCity: true, targetCount: 30, maxNightlyPrice: 150, minRating: null, minReviews: null });

const NOTICE = [{ free_tier_notice: true, notice: "free_tier_limit_reached", message: "Free monthly allowance reached for this Actor. This run returned no results because the allowance was already used up." }];

// Every Places lookup finds the hotel right where the source said it is, in Toronto, ON
global.fetch = async (url, options = {}) => {
    const reply = body => ({ ok: true, status: 200, json: async () => body });
    if (url.includes("searchapi.io")) return reply(searchapi);
    if (url.includes("liteapi.travel")) return reply({ data: [], guestLevel: 0, sandbox: true });
    if (url.includes("api.apify.com")) return reply(NOTICE);
    if (url.includes("places.googleapis.com")) {
        const body = JSON.parse(options.body);
        const center = body.locationBias?.circle.center;
        return reply({
            places: center ? [{
                displayName: { text: body.textQuery },
                location: center,
                formattedAddress: "1 Main St, Toronto",
                internationalPhoneNumber: "+1 416 555 0100",
                addressComponents: [
                    { types: ["locality"], longText: "Toronto", shortText: "Toronto" },
                    { types: ["administrative_area_level_1"], longText: "Ontario", shortText: "ON" },
                    { types: ["country"], longText: "Canada", shortText: "CA" }
                ]
            }] : []
        });
    }
    assert.fail(`unexpected call to ${url}`);
};

async function run(city) {
    settings.city = city;
    const realLog = console.log;
    const realError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
        const hotels = await search();
        return { hotels, report: search.lastReport };
    } finally {
        console.log = realLog;
        console.error = realError;
    }
}

(async () => {
    const withinCap = searchapi.properties.filter(p => p.price_per_night?.extracted_price <= 150).length;
    assert.ok(withinCap > 0 && withinCap <= 17);

    // Searching "Humber Bay": everything is dropped by the city check, and the report says exactly why
    const humber = await run("Humber Bay");
    assert.strictEqual(humber.hotels.length, 0);
    const bySource = Object.fromEntries(humber.report.sources.map(source => [source.name, source]));
    assert.deepStrictEqual([bySource.searchapi.ok, bySource.searchapi.fetched, bySource.searchapi.kept], [true, 17, withinCap], "SearchApi returned 17 hotels");
    assert.match(bySource.searchapi.file, /raw[\\/]searchapi[\\/].*humber-bay\.json$/, "its raw response is saved and the path reported");
    assert.deepStrictEqual([bySource.liteapi.ok, bySource.liteapi.fetched, bySource.liteapi.kept], [true, 0, 0], "LiteAPI returned nothing");
    assert.strictEqual(bySource.apifygoogle.ok, false);
    assert.match(bySource.apifygoogle.error, /Free monthly allowance reached/, "the actor's notice is the error, not a silent empty result");
    assert.strictEqual(humber.report.city.mode, "Google Places");
    assert.strictEqual(humber.report.city.searched, "Humber Bay");
    assert.strictEqual(humber.report.city.kept, 0);
    assert.strictEqual(humber.report.city.dropped.length, withinCap, "every hotel that passed the filters was dropped by the city check");
    assert.ok(humber.report.city.dropped.every(hotel => hotel.city === "Toronto, ON"), JSON.stringify(humber.report.city.dropped[0]));

    // The same data searched as "Toronto" comes through, with the Places phone
    const toronto = await run("Toronto");
    assert.strictEqual(toronto.hotels.length, withinCap);
    assert.strictEqual(toronto.report.city.dropped.length, 0);
    assert.ok(toronto.hotels.every(hotel => hotel.phone === "+1 416 555 0100"));

    console.log("run-report: all tests passed");
})();
