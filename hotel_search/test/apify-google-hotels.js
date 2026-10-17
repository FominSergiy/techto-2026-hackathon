// Offline test for the Apify Google Hotels source, against a trimmed copy of a real actor response (no API is called).
// Run: node hotel_search/test/apify-google-hotels.js
const assert = require("node:assert");
const fixture = require("./fixtures/apify-google-hotels.json");
const settings = require("../settings");
const { buildInput, toHotels } = require("../apify-google-hotels");

Object.assign(settings, { city: "Aurora", region: "Ontario", countryCode: "CA", checkIn: "2026-10-24", checkOut: "2026-10-25", nights: 1, adults: 1, currency: "CAD", maxNightlyPrice: 300, maxPages: 2 });

const input = buildInput();
assert.strictEqual(input.q, "hotels in Aurora, Ontario, Canada", "country spelled out: a bare CA can read as California");
assert.strictEqual(input.gl, "ca");

// Hotels.com has one free-text place input, so region and country go in it
const hotelscom = require("../apify-hotelscom").buildInput();
assert.strictEqual(hotelscom.place, "Aurora Ontario Canada");
assert.strictEqual(hotelscom.start_date, "2026-10-24");
assert.strictEqual(hotelscom.end_date, "2026-10-25");
assert.strictEqual(input.check_in_date, "2026-10-24");
assert.strictEqual(input.max_price, "300");
assert.strictEqual(input.max_pages, 2);

// Hotels and vacation rentals are both kept, with their price, rating and link
const hotels = toHotels(fixture);
assert.strictEqual(hotels.length, 6);
assert.ok(hotels.some(hotel => hotel.name.startsWith("Cozy basement apartment")), "vacation rentals are not dropped");
assert.ok(hotels.every(hotel => hotel.nightlyPrice > 0 && hotel.name));
const microtel = hotels.find(hotel => hotel.name.startsWith("Microtel"));
assert.strictEqual(microtel.nightlyPrice, 235);
assert.strictEqual(microtel.rating, 4.3);
assert.strictEqual(microtel.reviews, 509);
assert.match(microtel.url, /wyndhamhotels\.com/);
assert.ok(microtel.location.latitude);

console.log("apify-google-hotels: all tests passed");
