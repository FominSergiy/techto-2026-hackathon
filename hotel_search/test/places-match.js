// Offline test for the Google Places match (fetch is faked, no API is called).
// Run: node hotel_search/test/places-match.js
const assert = require("node:assert");

process.env.GOOGLE_MAPS_API_KEY = "test-key";
const settings = require("../settings");
const { enrichWithPlaces, cleanName } = require("../places");

Object.assign(settings, { city: "Burlington", region: "Ontario", countryCode: "CA" });

const place = (name, lat, lng, phone) => ({
    displayName: { text: name },
    location: { latitude: lat, longitude: lng },
    formattedAddress: `1 Main St, ${name}`,
    internationalPhoneNumber: phone,
    addressComponents: [
        { types: ["locality"], longText: "Burlington", shortText: "Burlington" },
        { types: ["administrative_area_level_1"], longText: "Ontario", shortText: "ON" },
        { types: ["country"], longText: "Canada", shortText: "CA" }
    ]
});

// 0.001 degrees of latitude is about 111 m
const HERE = { latitude: 43.35, longitude: -79.8 };
const at = metersNorth => ({ lat: HERE.latitude + metersNorth / 111000, lng: HERE.longitude });

let calls;
let failFirst;
// answers[textQuery] is a list of results, one per call to that query; "5xx" answers HTTP 500 once
function stub(answers) {
    calls = [];
    global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        const queue = answers[body.textQuery] || [[]];
        const answer = queue[Math.min(calls.filter(call => call.textQuery === body.textQuery).length - 1, queue.length - 1)];
        if (answer === "5xx") return { ok: false, status: 500, json: async () => ({ error: { message: "backend error" } }) };
        return { ok: true, status: 200, json: async () => ({ places: answer }) };
    };
}

(async () => {
    // Names Google Hotels decorates with the place still match, and the query uses the clean name
    assert.strictEqual(cleanName("Knights Inn Burlington, ON"), "Knights Inn Burlington");
    assert.strictEqual(cleanName("Hotel X (Downtown)"), "Hotel X");
    assert.strictEqual(cleanName("Holiday Inn Express & Suites Aurora"), "Holiday Inn Express & Suites Aurora");

    const logs = [];
    const realLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
        // 1. The first search (by name around the spot) misses; the second (name + city) finds it 80 m away
        const here = at(0);
        const near = at(80);
        stub({
            "Knights Inn Burlington": [[place("Knights Inn Hamilton", at(9000).lat, at(9000).lng, "+1 905 000 0000")]],
            "Knights Inn Burlington, Burlington, Ontario": [[place("Knights Inn Burlington", near.lat, near.lng, "+1 905 555 0101")]]
        });
        const [found] = await enrichWithPlaces([{ name: "Knights Inn Burlington, ON", location: { latitude: here.lat, longitude: here.lng } }]);
        assert.strictEqual(found.phone, "+1 905 555 0101");
        assert.strictEqual(found.city, "Burlington");
        assert.strictEqual(calls.length, 2, "the fallback search runs only after the first one misses");
        assert.ok(calls[0].locationBias && !calls[1].locationBias, "first search is biased to the coordinates, second is not");

        // 2. A same-named hotel 5 km away is NOT accepted (someone else's phone number), and the log says why
        const far = at(5000);
        stub({
            "Super 8 Burlington": [[place("Super 8 Burlington", far.lat, far.lng, "+1 905 999 9999")]],
            "Super 8 Burlington, Burlington, Ontario": [[place("Super 8 Burlington", far.lat, far.lng, "+1 905 999 9999")]]
        });
        logs.length = 0;
        const [wrong] = await enrichWithPlaces([{ name: "Super 8 Burlington", location: { latitude: here.lat, longitude: here.lng } }]);
        assert.strictEqual(wrong.phone, null);
        const miss = logs.find(line => line.includes("no Places match: Super 8 Burlington"));
        assert.match(miss, /closest name "Super 8 Burlington" \(100% of the words, 5\.0 km away\)/);

        // 3. No results at all is reported as such
        stub({});
        logs.length = 0;
        await enrichWithPlaces([{ name: "Ghost Motel", location: { latitude: here.lat, longitude: here.lng } }]);
        assert.ok(logs.some(line => /no Places match: Ghost Motel: Places returned no lodging/.test(line)));

        // 4. A hotel without coordinates still needs a close name match, searched by name + city
        stub({ "Comfort Inn, Burlington, Ontario": [[place("Comfort Inn Burlington", near.lat, near.lng, "+1 905 555 0202")]] });
        const [noSpot] = await enrichWithPlaces([{ name: "Comfort Inn" }]);
        assert.strictEqual(noSpot.phone, "+1 905 555 0202");

        // 5. A 500 from Places is retried instead of silently leaving the hotel without a phone
        stub({ "Days Inn Burlington": ["5xx", [place("Days Inn Burlington", near.lat, near.lng, "+1 905 555 0303")]] });
        const [retried] = await enrichWithPlaces([{ name: "Days Inn Burlington", location: { latitude: here.lat, longitude: here.lng } }]);
        assert.strictEqual(retried.phone, "+1 905 555 0303");
    } finally {
        console.log = realLog;
    }

    console.log("places-match: all tests passed");
})();
