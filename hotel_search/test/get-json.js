// Offline test for getJson's retry backoff (fetch is stubbed, no API is called). Run: node hotel_search/test/get-json.js
const assert = require("node:assert");
const { getJson } = require("../hotel-utils");

let calls;
function stub(...statuses) {
    calls = 0;
    global.fetch = async () => {
        const status = statuses[Math.min(calls++, statuses.length - 1)];
        // Xotelo style: HTTP 200 with the real status in the body
        if (status === "body500") {
            return { ok: true, status: 200, json: async () => ({ error: { status_code: 500, message: "Internal Server Error" }, result: null }) };
        }
        return {
            ok: status < 400,
            status,
            json: async () => (status < 400 ? { result: "ok" } : status === 500 ? { error: "Internal Server Error" } : { message: "bad request" })
        };
    };
}

async function timed(promise) {
    const started = Date.now();
    const outcome = await promise.then(value => ({ value }), error => ({ error }));
    return { ...outcome, ms: Date.now() - started };
}

(async () => {
    // Two 500s then success: retried, and it waited 0.5s + 1s before the third attempt instead of hammering
    stub(500, 500, 200);
    const recovered = await timed(getJson("https://data.xotelo.com/api/list", {}, 4));
    assert.deepStrictEqual(recovered.value, { result: "ok" });
    assert.strictEqual(calls, 3);
    assert.ok(recovered.ms >= 1400, `expected backoff of ~1.5s, took ${recovered.ms}ms`);

    // Xotelo reports its 500 inside an HTTP 200 body: that must back off too (it used to retry instantly)
    stub("body500", "body500", 200);
    const bodyError = await timed(getJson("https://data.xotelo.com/api/rates", {}, 4));
    assert.deepStrictEqual(bodyError.value, { result: "ok" });
    assert.strictEqual(calls, 3);
    assert.ok(bodyError.ms >= 1400, `expected backoff of ~1.5s for a body-level 500, took ${bodyError.ms}ms`);

    // A permanent 500 uses every attempt and keeps the message the UI shows
    stub(500);
    const dead = await timed(getJson("https://data.xotelo.com/api/list", {}, 1));
    assert.strictEqual(calls, 2);
    assert.match(dead.error.message, /^data\.xotelo\.com: Internal Server Error$/);

    // A client error (bad request, bad key) retries straight away, no waiting
    stub(400);
    const bad = await timed(getJson("https://example.test/x", {}, 2));
    assert.strictEqual(calls, 3);
    assert.ok(bad.ms < 300, `4xx should not back off, took ${bad.ms}ms`);

    // No retries by default: one attempt, no waiting
    stub(500);
    const once = await timed(getJson("https://example.test/x"));
    assert.strictEqual(calls, 1);
    assert.ok(once.ms < 300 && once.error);

    console.log("get-json: all tests passed");
})();
