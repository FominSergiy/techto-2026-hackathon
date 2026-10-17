// Offline test for Xotelo's /search location lookup (fetch is faked, no API is called).
// Run: node hotel_search/test/xotelo-search.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

process.env.RAPIDAPI_KEY = "test-key";
const settings = require("../settings");
const { locationKey } = require("../xotelo");

const CACHE_FILE = path.join(__dirname, "..", "..", ".cache", "locations.json");
const before = fs.existsSync(CACHE_FILE) ? fs.readFileSync(CACHE_FILE) : null;

const list = [
    { name: "Aurora", location_key: "g1", place_name: "Aurora, Illinois, United States" },
    { name: "Aurora", location_key: "g2", place_name: "Aurora, Ontario, Canada" },
    { name: "Aurora Inn", location_key: "g3", place_name: "Aurora, Ontario, Canada" }
];

(async () => {
    try {
        Object.assign(settings, { city: "Aurora", region: "Ontario", countryCode: "CA", tripadvisorLocationKey: null });
        let url, options;
        global.fetch = async (...args) => {
            [url, options] = args;
            return { ok: true, status: 200, json: async () => ({ error: null, result: { list } }) };
        };

        // Picks the Ontario Aurora out of same-named places, sends the RapidAPI headers, and asks /search for a geo place
        assert.strictEqual(await locationKey(), "g2");
        assert.match(url, /\/api\/search\?query=Aurora\+Ontario&location_type=geo$/);
        assert.strictEqual(options.headers["X-RapidAPI-Key"], "test-key");

        // A region nothing matches is an error, not a wrong city
        settings.region = "Colorado";
        await assert.rejects(() => locationKey(), /found no place named "Aurora" in Colorado/);

        // An explicit key in settings skips /search
        settings.tripadvisorLocationKey = "g155019";
        global.fetch = async () => assert.fail("must not call the API");
        assert.strictEqual(await locationKey(), "g155019");

        console.log("xotelo-search: all tests passed");
    } finally {
        if (before) fs.writeFileSync(CACHE_FILE, before); else fs.rmSync(CACHE_FILE, { force: true });
    }
})();
