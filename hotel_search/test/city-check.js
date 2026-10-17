// Offline test: without Google Places, hotels a source places in another city are still dropped (real Toronto data from the
// Google Hotels actor, trimmed; fetch is faked, no API is called). Run: node hotel_search/test/city-check.js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.APIFY_KEY = "test-key";
const settings = require("../settings");
const { search, dropKnownOtherCities } = require("../index");
const fixture = require("./fixtures/apify-google-hotels-toronto.json");
const { toHotels } = require("../apify-google-hotels");

// raw responses are saved under ./output/raw, so run from a scratch folder
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "city-check-")));
Object.assign(settings, { city: "Toronto", region: "Ontario", countryCode: "CA", sources: ["apifygoogle"], enrichPhones: false, strictCity: true, targetCount: 20, maxNightlyPrice: 150 });

global.fetch = async url => {
    assert.match(url, /api\.apify\.com/, "only the actor is called, no Places");
    return { ok: true, status: 200, json: async () => fixture };
};

(async () => {
    // The actor's own addresses give the city for some hotels ("Markham, ON, Canada"), not for street addresses
    const hotels = toHotels(fixture);
    assert.deepStrictEqual(hotels.map(hotel => hotel.city), ["Richmond Hill", "Markham", "Markham", null, null, null, null]);

    const realLog = console.log;
    const logs = [];
    console.log = (...args) => logs.push(args.join(" "));
    let found;
    try {
        found = await search();
    } finally {
        console.log = realLog;
    }

    // The three hotels in Markham / Richmond Hill are gone; the ones with a street address or no address stay
    assert.deepStrictEqual(found.map(hotel => hotel.name).sort(), [
        "Best Western Premier Toronto Airport Carlingview Hotel",
        "Cosy Room Yonge Dundas Square-Fast Wi-Fi and Self Check In - Triple Room",
        "Deluxe Inn",
        "The Clarence Park"
    ]);
    assert.ok(logs.some(line => /dropped 3 hotels a source places in other cities, 4 have no city to check/.test(line)), logs.join("\n"));
    assert.ok(logs.some(line => /other place: Hampton Inn & Suites by Hilton Toronto Markham \(Markham\)/.test(line)));
    // Phones the source returned are kept
    assert.strictEqual(found.find(hotel => hotel.name === "The Clarence Park").phone, "+1 416-591-7387");

    // Same city, different spelling/case, is not dropped
    settings.city = "markham";
    assert.strictEqual(dropKnownOtherCities(hotels).length, 6, "Markham search keeps the 2 Markham + 4 unknown, drops Richmond Hill");

    console.log("city-check: all tests passed");
})();
