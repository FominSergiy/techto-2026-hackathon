// Offline tests: request building and response parsing, no network. Run: node backboard_search/test.js
const assert = require("node:assert");
const { buildRequest, parseHotels, toHotel, resolve } = require("./backboard");

const settings = resolve({ city: "Aurora", region: "Ontario", countryCode: "CA", checkIn: "2026-11-20", nights: 2, maxNightlyPrice: 200 });
assert.strictEqual(settings.checkOut, "2026-11-22");
assert.strictEqual(settings.nights, 2);

const request = buildRequest(settings);
assert.strictEqual(request.web_search, "Auto");
assert.strictEqual(request.memory, "off");
assert.match(request.content, /Aurora, Ontario, CA/);
assert.match(request.content, /2026-11-20/);
assert.match(request.content, /at or under 200 CAD/);

// Fenced + prose-wrapped output still parses
const fenced = 'Here you go:\n```json\n[{"name":"Hotel A","nightlyPrice":112.4,"phone":"+1 905-555-0100"},{"name":"Hotel B","nightlyPrice":"abc"},{"nightlyPrice":90}]\n```';
const hotels = parseHotels(fenced).map(raw => toHotel(raw, settings)).filter(Boolean);
assert.strictEqual(hotels.length, 1);
assert.deepStrictEqual([hotels[0].name, hotels[0].nightlyPrice, hotels[0].totalPrice, hotels[0].phone], ["Hotel A", 112, 225,"+1 905-555-0100"]);

assert.throws(() => parseHotels("Sorry, no hotels found."), /no JSON array/);
// Free-text mode (the UI's Backboard box): the user's words go through untouched, no assumed nights or currency
const free = resolve({ prompt: "cheapest hotel in Paris tonight in EUR" });
const freeRequest = buildRequest(free);
assert.strictEqual(freeRequest.content, "cheapest hotel in Paris tonight in EUR");
assert.match(freeRequest.system_prompt, /Today is \d{4}-\d{2}-\d{2}/);
const freeHotel = toHotel({ name: "Hotel C", nightlyPrice: 150, currency: "EUR" }, free);
assert.deepStrictEqual([freeHotel.currency, freeHotel.totalPrice], ["EUR", null]);

console.log("backboard_search: all tests passed");
