// Offline test: raw JSON responses are saved per source with a timestamp (fetch is faked, no API is called).
// Run: node hotel_search/test/raw-capture.js
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const settings = require("../settings");
const { getJson, withRawCapture } = require("../hotel-utils");

// The files go under ./output/raw, so run from a scratch folder instead of the repo's output/
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "raw-capture-test-")));
Object.assign(settings, { city: "Aurora", outputDir: "output" });

const bodies = {
    "https://a.test/one": { json: { hotels: [1, 2] } },
    "https://a.test/two": { json: { hotels: [3] } },
    "https://b.test/only": { json: { rows: ["x"] } },
    "https://b.test/html": { notJson: true },
    "https://b.test/fail": { status: 500, json: { error: { message: "boom" } } }
};
global.fetch = async url => {
    const answer = bodies[url];
    return {
        ok: (answer.status ?? 200) < 400,
        status: answer.status ?? 200,
        json: async () => {
            if (answer.notJson) throw new SyntaxError("Unexpected token <");
            return answer.json;
        }
    };
};

const files = folder => fs.readdirSync(path.join("output", "raw", folder));
const read = (folder, file) => JSON.parse(fs.readFileSync(path.join("output", "raw", folder, file), "utf8"));

(async () => {
    // Two sources at once each get their own folder and only their own responses
    await Promise.all([
        withRawCapture("source-a", async () => {
            await getJson("https://a.test/one");
            await new Promise(resolve => setTimeout(resolve, 20));
            await getJson("https://a.test/two");
        }),
        withRawCapture("source-b", async () => {
            await getJson("https://b.test/only");
            await getJson("https://b.test/html").catch(() => {});   // not JSON: nothing to save
            await getJson("https://b.test/fail").catch(() => {});   // an error body is kept as received
        })
    ]);

    assert.strictEqual(files("source-a").length, 1);
    assert.match(files("source-a")[0], /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-aurora\.json$/, "timestamp and city in the filename");
    assert.deepStrictEqual(read("source-a", files("source-a")[0]), [{ hotels: [1, 2] }, { hotels: [3] }], "pure responses, in order");
    assert.deepStrictEqual(read("source-b", files("source-b")[0]), [{ rows: ["x"] }, { error: { message: "boom" } }]);

    // A failing source still saves what it received before it threw
    await assert.rejects(() => withRawCapture("source-c", async () => {
        await getJson("https://a.test/one");
        throw new Error("source broke");
    }), /source broke/);
    assert.deepStrictEqual(read("source-c", files("source-c")[0]), [{ hotels: [1, 2] }]);

    // getJson outside a capture saves nothing, and so does a capture with no responses
    await getJson("https://a.test/one");
    await withRawCapture("source-empty", async () => {});
    assert.ok(!fs.existsSync(path.join("output", "raw", "source-empty")));

    // outputDir null turns saving off
    settings.outputDir = null;
    await withRawCapture("source-off", () => getJson("https://a.test/one"));
    assert.ok(!fs.existsSync(path.join("output", "raw", "source-off")));

    console.log("raw-capture: all tests passed");
})();
