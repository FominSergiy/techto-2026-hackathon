// Offline test for Xotelo's /list handling (fetch and the clock are faked, no API is called).
// Run: node hotel_search/test/xotelo-list.js
const assert = require("node:assert");
const { listPage } = require("../xotelo");

const body500 = { error: { status_code: 500, message: "Internal Server Error" }, result: null };
const okBody = { error: null, result: { total_count: 5, list: [] } };

let calls;
let now;
const realNow = Date.now;

// Each answer is { body, takes } where `takes` is how many fake milliseconds the request lasted
function stub(...answers) {
    calls = 0;
    now = 1_000_000;
    Date.now = () => now;
    global.fetch = async () => {
        const { body, takes } = answers[Math.min(calls++, answers.length - 1)];
        now += takes;
        return { ok: true, status: 200, json: async () => body };
    };
}

(async () => {
    try {
        // Observed live for Toronto/Montreal/Hamilton: a 500 after ~10.8s. Retrying burns 11s each time, so fail at once.
        stub({ body: body500, takes: 10_800 });
        await assert.rejects(
            () => listPage(new URLSearchParams({ location_key: "g155032" })),
            error => /Internal Server Error after 11s - Xotelo's server times out listing cities with many hotels/.test(error.message)
        );
        assert.strictEqual(calls, 1, "a slow 500 must not be retried");

        // A quick 500 is a blip: retried with backoff until it works
        stub({ body: body500, takes: 100 }, { body: body500, takes: 100 }, { body: okBody, takes: 100 });
        const page = await listPage(new URLSearchParams({ location_key: "g499250" }));
        assert.strictEqual(page.result.total_count, 5);
        assert.strictEqual(calls, 3);

        // A quick 500 that never clears gives up after the retries, with Xotelo's own message and no "times out" claim
        stub({ body: body500, takes: 100 });
        await assert.rejects(
            () => listPage(new URLSearchParams({ location_key: "g499250" })),
            error => error.message === "data.xotelo.com: Internal Server Error"
        );
        assert.strictEqual(calls, 4, "1 attempt + 3 retries");

        console.log("xotelo-list: all tests passed");
    } finally {
        Date.now = realNow;
    }
})();
