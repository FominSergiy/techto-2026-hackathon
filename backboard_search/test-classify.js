// Offline tests for ranking hotels by expected price with Backboard: which hotels are sent, the request, parsing the
// model's answer and the final order. fetch is stubbed, nothing is called. Run: node backboard_search/test-classify.js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
// classify saves Backboard's raw reply under ./output/raw, so run from a scratch folder
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "classify-")));
const { classify, pickCandidates, buildRequest, parseRanking, applyRanking, MAX_HOTELS } = require("./classify");

const hotel = (name, extra = {}) => ({ name, address: `1 Main St, ${name}`, rating: 4, reviews: 100, currency: "CAD", foundBy: ["hotels in X"], priceRange: null, priceLevel: null, ...extra });

// Which hotels are sent: at most 20, those several searches agreed on first, then the most reviewed
const many = Array.from({ length: 25 }, (_, index) => hotel(`Hotel ${index}`, { reviews: index, foundBy: index === 24 ? ["a", "b", "c"] : ["a"] }));
const picked = pickCandidates(many);
assert.strictEqual(MAX_HOTELS, 20);
assert.strictEqual(picked.length, 20);
assert.strictEqual(picked[0].name, "Hotel 24", "found by 3 searches comes first");
assert.strictEqual(picked[1].name, "Hotel 23", "then the most reviewed");
assert.ok(!picked.some(h => h.name === "Hotel 0"), "the least reviewed are left out");
assert.strictEqual(pickCandidates(many.slice(0, 3)).length, 3);

// The request: web search on, ids and Google's price hint go over, never the phone or the website
const candidates = [hotel("Super 8 Sudbury", { priceRange: "CAD 90+", phone: "+1 705 555 0100", url: "https://secret.test" }), hotel("Radisson Sudbury", { rating: 4.3 })];
const request = buildRequest(candidates, { city: "Sudbury", region: "Ontario" });
assert.strictEqual(request.web_search, "Auto");
assert.strictEqual(request.memory, "off");
assert.match(request.content, /Sudbury, Ontario, CA/);
const sent = JSON.parse(request.content.split("\n")[1]);
assert.deepStrictEqual(sent.map(h => h.id), [0, 1]);
assert.strictEqual(sent[0].googlePriceHint, "CAD 90+");
assert.ok(!request.content.includes("555 0100") && !request.content.includes("secret.test"));
assert.match(request.system_prompt, /use web search/);
assert.match(request.system_prompt, /one element per input hotel/);

// Parsing: fences, text prices, the name instead of an id, unknown ids, no price, bad words, duplicates
const reply = 'Here:\n```json\n[{"id":1,"expectedPrice":"$185","tier":"upscale","confidence":"high","basis":"Booking.com shows 185"},' +
    '{"name":"super 8 sudbury","expectedPrice":95,"tier":"cheap","confidence":"sure","basis":"budget chain"},' +
    '{"id":7,"expectedPrice":100},{"id":0,"expectedPrice":"call us"},{"id":1,"expectedPrice":999}]\n```';
const { byId, unusable } = parseRanking(reply, candidates);
assert.deepStrictEqual(byId.get(1), { expectedPrice: 185, priceClass: "upscale", priceConfidence: "high", priceBasis: "Booking.com shows 185" }, "a duplicate id doesn't overwrite the first");
assert.deepStrictEqual(byId.get(0), { expectedPrice: 95, priceClass: null, priceConfidence: null, priceBasis: "budget chain" }, "found by name; words outside the allowed set become null");
assert.strictEqual(unusable.length, 2);
assert.ok(unusable.some(reason => /not one of the hotels sent/.test(reason)) && unusable.some(reason => /no usable price/.test(reason)));
assert.throws(() => parseRanking("I could not find any of these.", candidates), /no JSON array/);

// Order: estimated cheapest first (ties: better rated), then the hotels without an estimate, with the reason
const hotels = [hotel("Radisson Sudbury", { rating: 4.3 }), hotel("Not sent"), hotel("Super 8 Sudbury"), hotel("Asked, no answer")];
const ranked = applyRanking(hotels, [hotels[0], hotels[2], hotels[3]], new Map([[0, { expectedPrice: 185, priceClass: "upscale", priceConfidence: "high", priceBasis: "x" }], [1, { expectedPrice: 95, priceClass: "budget", priceConfidence: "low", priceBasis: "y" }]]));
assert.deepStrictEqual(ranked.map(h => h.name), ["Super 8 Sudbury", "Radisson Sudbury", "Not sent", "Asked, no answer"]);
assert.deepStrictEqual(ranked.map(h => h.expectedPrice), [95, 185, null, null]);
assert.strictEqual(ranked[2].priceBasis, "not sent to the model");
assert.strictEqual(ranked[3].priceBasis, "the model gave no estimate");
assert.strictEqual(ranked[0].address, hotels[2].address, "the other fields are kept");

(async () => {
    process.env.BACKBOARD_API_KEY = "test-key";
    const realFetch = global.fetch;
    const calls = [];
    const answer = body => async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        return { ok: true, status: 200, json: async () => body };
    };

    try {
        // 25 hotels in, 20 sent; the model prices 19 of them (the most reviewed one gets 300, the rest are 100 + id)
        const list = many.map(h => ({ ...h }));
        global.fetch = answer({
            status: "COMPLETED", model_provider: "openai", model_name: "gpt-4o", input_tokens: 900, output_tokens: 300,
            content: JSON.stringify(pickCandidates(list).slice(0, 19).map((h, id) => ({ id, expectedPrice: id === 0 ? 300 : 100 + id, tier: "budget", confidence: "medium", basis: "estimate" })))
        });
        const result = await classify(list, { city: "Sudbury", region: "Ontario" });

        assert.strictEqual(calls.length, 1, "one call for everything");
        assert.strictEqual(calls[0].url, "https://app.backboard.io/api/threads/messages");
        assert.strictEqual(calls[0].options.headers["X-API-Key"], "test-key");
        assert.strictEqual(JSON.parse(calls[0].body.content.split("\n")[1]).length, 20, "the filtered list is capped at 20");

        assert.strictEqual(result.hotels.length, 25, "every hotel comes back");
        assert.deepStrictEqual(result.run, { ...result.run, sent: 20, ranked: 19, unusable: [], model: "openai/gpt-4o", inputTokens: 900, outputTokens: 300 });
        const prices = result.hotels.map(h => h.expectedPrice);
        assert.deepStrictEqual(prices.slice(0, 19), [...prices.slice(0, 19)].sort((a, b) => a - b), "cheapest first");
        assert.strictEqual(prices[18], 300, "the 300 estimate is last of the estimated");
        assert.deepStrictEqual(prices.slice(19), [null, null, null, null, null, null], "the unestimated ones follow: 1 sent but not answered, 5 not sent");
        assert.strictEqual(result.hotels.filter(h => h.priceBasis === "not sent to the model").length, 5);

        // Nothing to rank: no call
        calls.length = 0;
        assert.deepStrictEqual((await classify([])).hotels, []);
        assert.strictEqual(calls.length, 0);

        // Backboard errors and unusable answers throw, so the server can show the unranked list
        global.fetch = async () => ({ ok: false, status: 402, json: async () => ({ detail: "out of credits" }) });
        await assert.rejects(classify(list), /Backboard 402.*out of credits/);
        global.fetch = answer({ status: "FAILED", content: "" });
        await assert.rejects(classify(list), /run FAILED/);
        global.fetch = answer({ status: "COMPLETED", content: "Sorry, I can't." });
        await assert.rejects(classify(list), /no JSON array/);
        global.fetch = answer({ status: "COMPLETED", content: '[{"id":0,"expectedPrice":"unknown"}]' });
        await assert.rejects(classify(list), /no usable estimate/);
        delete process.env.BACKBOARD_API_KEY;
        await assert.rejects(classify(list), /BACKBOARD_API_KEY is not set/);
    } finally {
        global.fetch = realFetch;
    }

    console.log("classify: all tests passed");
})();
