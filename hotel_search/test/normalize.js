// Offline contract test: every source's own normalizer turns its raw item into the one common hotel shape.
// The Google sample is a real actor response (fixtures/); the others are minimal items with the fields each mapper reads.
// Run: node hotel_search/test/normalize.js
const assert = require("node:assert");
const settings = require("../settings");
const { HOTEL_FIELDS, normalizeHotel } = require("../hotel-utils");

Object.assign(settings, { city: "Aurora", region: "Ontario", countryCode: "CA", checkIn: "2026-10-24", checkOut: "2026-10-26", nights: 2, adults: 1, currency: "CAD" });

const xotelo = require("../xotelo");
const searchapi = require("../searchapi");
const liteapi = require("../liteapi");
const hotelbeds = require("../hotelbeds");
const booking = require("../apify-booking");
const google = require("../apify-google-hotels");
const hotelscom = require("../apify-hotelscom");
const expedia = require("../expedia");
const backboard = require("../../backboard_search/backboard");
const googleFixture = require("./fixtures/apify-google-hotels.json");

const samples = {
    xotelo: xotelo.normalize({ name: "Alpha Inn", review_summary: { rating: 4.2, count: 310 }, geo: { latitude: 44.0, longitude: -79.4 }, url: "https://x.test/a" }, 150),
    searchapi: searchapi.normalize({ name: "Beta Lodge", city: "Aurora", gps_coordinates: { latitude: 44.0, longitude: -79.4 }, price_per_night: { extracted_price: 140 }, total_price: { extracted_price: 280 }, rating: 4.4, reviews: 88, link: "https://x.test/b" }),
    liteapi: liteapi.normalize({ hotelId: "h1", roomTypes: [{ offerRetailRate: { amount: 300 } }, { offerRetailRate: { amount: 260 } }] }, { id: "h1", name: "Gamma Hotel", city: "Aurora", latitude: 44.0, longitude: -79.4, rating: 8.6, review_count: 120, address: "1 Main St" }),
    hotelbeds: hotelbeds.normalize({ name: "Delta Suites", latitude: "44.0", longitude: "-79.4", minRate: "250.50", currency: "CAD", reviews: [{ type: "TRIPADVISOR", rate: 4, reviewCount: 55 }], zoneName: "Aurora", destinationName: "Toronto" }),
    "apify-booking": booking.normalize({ name: "Epsilon Inn", price: 240, currency: "CAD", rating: 8.2, reviews: 410, address: { full: "2 Side Rd, Aurora" }, url: "https://x.test/e" }),
    "apify-google-hotels": google.toHotels(googleFixture).find(hotel => hotel.name.startsWith("Microtel")),
    "apify-hotelscom": hotelscom.normalize({ name: "Zeta Hotel", price: 130, link: "https://x.test/z" }),
    expedia: expedia.normalize({ name: "Eta Hotel", href: "https://x.test/eta?x=1", text: "Eta Hotel\n$120 per night\n8.4/10 (230 reviews)", hints: [] }),
    backboard: backboard.toHotel({ name: "Theta Motel", nightlyPrice: "$99", phone: "+1 905 555 0100", rating: 4.1, url: "https://x.test/t" }, { city: "Aurora", currency: "CAD", nights: 2, count: 20 })
};

const isNumberOrNull = value => value === null || (typeof value === "number" && Number.isFinite(value));

for (const [source, hotel] of Object.entries(samples)) {
    assert.ok(hotel, `${source}: no hotel produced`);
    // Every common field is present (extras like backboard's priceType are allowed), none is undefined
    for (const field of HOTEL_FIELDS) {
        assert.ok(field in hotel, `${source}: missing ${field}`);
        assert.notStrictEqual(hotel[field], undefined, `${source}: ${field} is undefined (should be null)`);
    }
    assert.ok(hotel.name && typeof hotel.name === "string", `${source}: name`);
    for (const field of ["nightlyPrice", "totalPrice", "rating", "reviews"]) {
        assert.ok(isNumberOrNull(hotel[field]), `${source}: ${field} must be a number or null, got ${JSON.stringify(hotel[field])}`);
    }
    for (const field of ["city", "address", "phone", "url"]) {
        assert.ok(hotel[field] === null || typeof hotel[field] === "string", `${source}: ${field} must be a string or null`);
    }
    assert.ok(typeof hotel.currency === "string" && hotel.currency, `${source}: currency`);
    assert.ok(hotel.location === null || (typeof hotel.location.latitude === "number" && typeof hotel.location.longitude === "number"), `${source}: location`);
    assert.ok(hotel.rating === null || (hotel.rating >= 0 && hotel.rating <= 5), `${source}: rating must be out of 5, got ${hotel.rating}`);
}

// Spot checks that each mapper converts units the way its API needs
assert.strictEqual(samples.liteapi.nightlyPrice, 130, "LiteAPI: cheapest room 260 over 2 nights");
assert.strictEqual(samples.liteapi.rating, 4.3, "LiteAPI: rating out of 10 halved");
assert.strictEqual(samples.hotelbeds.totalPrice, 250.5, "Hotelbeds: string price becomes a number");
assert.deepStrictEqual(samples.hotelbeds.location, { latitude: 44, longitude: -79.4 });
assert.strictEqual(samples["apify-booking"].rating, 4.1, "Booking: out of 10 halved");
assert.strictEqual(samples["apify-google-hotels"].nightlyPrice, 235);
assert.strictEqual(samples.backboard.phone, "+1 905 555 0100", "Backboard is the one source that already knows a phone");

// normalizeHotel itself: fills gaps with null, coerces numbers, defaults the currency, drops half a location
const bare = normalizeHotel({ name: "  Only A Name  ", nightlyPrice: "89.5", rating: "", reviews: "n/a", location: { latitude: 44 } });
assert.deepStrictEqual(bare, { name: "Only A Name", city: null, address: null, phone: null, nightlyPrice: 89.5, totalPrice: null, currency: "CAD", rating: null, reviews: null, url: null, location: null });
assert.strictEqual(normalizeHotel({}).name, null);

console.log("normalize: all tests passed");
