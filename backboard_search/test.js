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
// Models answer prices as text ("$112", "112 CAD", "1,234.50"): these used to be dropped as NaN, leaving 1 result
const { toNumber, dropReason } = require("./backboard");
assert.deepStrictEqual(["$112", "112 CAD", "1,234.50", 99, "from $85/night"].map(toNumber), [112, 112, 1234.5, 99, 85]);
assert.ok(Number.isNaN(toNumber("call for rates")) && Number.isNaN(toNumber(null)));
const texty = toHotel({ name: "Hotel D", nightlyPrice: "$112", priceType: "from", totalPrice: "$224" }, settings);
assert.deepStrictEqual([texty.nightlyPrice, texty.totalPrice, texty.priceType], [112, 224, "from"]);
assert.strictEqual(toHotel({ name: "Hotel E", nightlyPrice: 80 }, settings).priceType, "quoted");

// Citation marks and prose around the array no longer break extraction; an empty array is a valid "found none"
assert.strictEqual(parseHotels('Per Booking.com [1], here:\n[{"name":"A","nightlyPrice":90},{"name":"B","nightlyPrice":"$95"}]\nSources: [1] booking.com [2] expedia.ca').length, 2);
assert.deepStrictEqual(parseHotels("[]"), []);
assert.throws(() => parseHotels('[{"name": "A", nightlyPrice: oops}]'), /not valid JSON/);

// Dropped entries say why, so a short list can be explained
assert.strictEqual(dropReason({ name: "X", nightlyPrice: 100 }), null);
assert.strictEqual(dropReason({ nightlyPrice: 100 }), "no name");
assert.match(dropReason({ name: "X", nightlyPrice: "call for rates" }), /no usable price \("call for rates"\)/);

// The system prompt must not tell the model to leave hotels out when unsure, and must ask for a plain number
assert.doesNotMatch(buildRequest(settings).system_prompt, /If you cannot find a real price, omit the hotel/);
assert.match(buildRequest(settings).system_prompt, /Prefer a "from" rate over leaving a hotel out/);
assert.match(buildRequest(settings).system_prompt, /plain JSON number/);

// Free-text mode (the UI's Backboard box): the user's words go through untouched, no assumed nights or currency
const free = resolve({ prompt: "cheapest hotel in Paris tonight in EUR" });
const freeRequest = buildRequest(free);
assert.strictEqual(freeRequest.content, "cheapest hotel in Paris tonight in EUR");
assert.match(freeRequest.system_prompt, /Today is \d{4}-\d{2}-\d{2}/);
const freeHotel = toHotel({ name: "Hotel C", nightlyPrice: 150, currency: "EUR" }, free);
assert.deepStrictEqual([freeHotel.currency, freeHotel.totalPrice], ["EUR", null]);

// End to end with fetch stubbed: the kind of reply that used to leave 1 hotel now keeps every priced one
const { search } = require("./backboard");
process.env.BACKBOARD_API_KEY = "test-key";
const reply = `Here are the results [1][2]:
[{"name":"Hotel One","nightlyPrice":"$112","priceType":"from"},
 {"name":"Hotel Two","nightlyPrice":"139.00 CAD"},
 {"name":"Hotel Three","nightlyPrice":95,"phone":"+1 514-555-0100"},
 {"name":"Hotel Four","nightlyPrice":"call for rates"}]
Sources: [1] booking.com [2] expedia.ca`;
let sent;
global.fetch = async (url, options) => {
    sent = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ status: "COMPLETED", content: reply, model_provider: "openai", model_name: "gpt-4o", input_tokens: 700, output_tokens: 120, thread_id: "t1" }) };
};
search({ prompt: "cheapest hotels in Montreal" }).then(found => {
    assert.deepStrictEqual(found.map(hotel => [hotel.name, hotel.nightlyPrice]), [["Hotel Three", 95], ["Hotel One", 112], ["Hotel Two", 139]]);
    assert.strictEqual(sent.content, "cheapest hotels in Montreal");
    assert.strictEqual(search.lastRun.returned, 4);
    assert.deepStrictEqual(search.lastRun.dropped, [{ name: "Hotel Four", reason: 'no usable price ("call for rates")' }]);
    assert.match(search.lastRun.reply, /Hotel Three/);
    console.log("backboard_search: all tests passed");
});
