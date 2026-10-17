// Offline test: prompt-only settings (no default) are still accepted as command-line flags, with the right types.
// Run: node hotel_search/test/settings-args.js
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SETTINGS = path.join(__dirname, "..", "settings.js");

// With -e, process.argv has no script slot (settings.js reads argv.slice(2)), so a placeholder takes its place
function load(...flags) {
    return spawnSync(process.execPath, ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(SETTINGS)})))`, "--", "script", ...flags], { encoding: "utf8" });
}

const ok = load("--city=Aurora", "--check-in=2026-10-24", "--min-rating=4", "--min-reviews=null", "--max-nightly-price=150", "--tripadvisor-location-key=g499250");
assert.strictEqual(ok.status, 0, ok.stderr);
const settings = JSON.parse(ok.stdout);
assert.strictEqual(settings.city, "Aurora");
assert.strictEqual(settings.checkIn, "2026-10-24");
assert.strictEqual(settings.checkOut, "2026-10-25", "derived from check-in + nights");
assert.strictEqual(settings.minRating, 4, "a number, not the string");
assert.strictEqual(settings.minReviews, null, "null disables a filter");
assert.strictEqual(settings.maxNightlyPrice, 150);
assert.strictEqual(settings.tripadvisorLocationKey, "g499250");

// With no flags the prompt-only settings are simply unset
const bare = JSON.parse(load().stdout);
assert.strictEqual(bare.city, undefined);
assert.match(bare.checkIn, /^\d{4}-\d{2}-\d{2}$/, "defaults to next Saturday");

// A typo is still rejected
const bad = load("--cty=Aurora");
assert.strictEqual(bad.status, 1);
assert.match(bad.stderr, /Unknown setting --cty/);

console.log("settings-args: all tests passed");
