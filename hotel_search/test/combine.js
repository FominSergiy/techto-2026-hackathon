// Offline tests for merging the Google Maps hotels with the Backboard hotels (the reservation page's table).
// Run: node hotel_search/test/combine.js
const assert = require("node:assert");
const { combine, phonesAgree } = require("../combine");

const maps = (name, extra = {}) => ({ name, phone: null, address: `1 Main St (${name})`, rating: 4, currency: "CAD", expectedPrice: null, url: null, mapsUrl: null, ...extra });
const found = (name, nightlyPrice, extra = {}) => ({ name, nightlyPrice, priceType: "from", currency: "CAD", phone: null, address: null, rating: null, url: `https://${name.length}.test`, ...extra });

// Phones: different numbers mean different hotels, a missing one blocks nothing
assert.ok(phonesAgree("+1 (705) 555-0100", "705-555-0100"));
assert.ok(phonesAgree(null, "705-555-0100") && phonesAgree("", ""));
assert.ok(!phonesAgree("+1 705 555 0100", "+1 705 555 0199"));
assert.ok(phonesAgree("+1 705 555 0100", "+1-800-454-3213"), "a toll-free chain line doesn't say which property it is");

// A found price beats an estimate; the Maps phone and address are kept; a Backboard-only hotel becomes its own row
const rows = combine(
    [
        maps("Super 8 by Wyndham Sudbury ON", { phone: "+1 705-555-0100", expectedPrice: 110, rating: 3.8 }),
        maps("Radisson Hotel Sudbury", { phone: "+1 705-555-0200", expectedPrice: 190, url: "https://radisson.test" }),
        maps("Noelville Motel", { phone: "+1 705-555-0300" }),
        maps("Holiday Inn Express Sudbury", { phone: "+1 705-555-0400", expectedPrice: 150 })
    ],
    [
        found("Super 8 Sudbury", 72, { phone: "+1-800-454-3213" }),
        found("Holiday Inn Sudbury", 99, { phone: "+1 705-555-0999" }),
        found("Cozy Corner Inn", 60, { phone: "+1 705-555-0600", address: "9 Side Rd" })
    ]
);

const byName = Object.fromEntries(rows.map(row => [row.name, row]));
assert.strictEqual(rows.length, 6, "4 Maps hotels, the Holiday Inn Backboard has a different phone so stays separate, plus Cozy Corner");

// Same hotel under two names: one row, the page's price, the Maps phone (the Backboard 1-800 number is a booking line)
const super8 = byName["Super 8 by Wyndham Sudbury ON"];
assert.deepStrictEqual([super8.price, super8.priceKind, super8.phone], [72, "from", "+1 705-555-0100"]);
assert.deepStrictEqual(super8.sources, ["maps", "backboard"]);
assert.strictEqual(super8.url, "https://" + "Super 8 Sudbury".length + ".test", "falls back to the Backboard page when Maps has no website");

// No Backboard match: the model's estimate, marked as such
assert.deepStrictEqual([byName["Radisson Hotel Sudbury"].price, byName["Radisson Hotel Sudbury"].priceKind], [190, "estimated"]);
assert.strictEqual(byName["Radisson Hotel Sudbury"].url, "https://radisson.test");

// No price anywhere: kept, with no price
assert.deepStrictEqual([byName["Noelville Motel"].price, byName["Noelville Motel"].priceKind], [null, null]);

// Two different Holiday Inns are not merged (different phones)
assert.strictEqual(byName["Holiday Inn Express Sudbury"].price, 150);
assert.deepStrictEqual([byName["Holiday Inn Sudbury"].price, byName["Holiday Inn Sudbury"].sources], [99, ["backboard"]]);

// Backboard-only hotel brings its own phone and address
assert.deepStrictEqual([byName["Cozy Corner Inn"].phone, byName["Cozy Corner Inn"].address, byName["Cozy Corner Inn"].sources], ["+1 705-555-0600", "9 Side Rd", ["backboard"]]);

// Cheapest first, no price last
assert.deepStrictEqual(rows.map(row => row.price), [60, 72, 99, 150, 190, null]);

// A Backboard hotel is merged into at most one Maps hotel
const twice = combine([maps("Comfort Inn Sudbury"), maps("Comfort Inn Sudbury Downtown")], [found("Comfort Inn Sudbury", 80)]);
assert.strictEqual(twice.filter(row => row.sources.includes("backboard")).length, 1);

// Either side may be empty or missing
assert.deepStrictEqual(combine(undefined, undefined), []);
assert.strictEqual(combine([maps("Only Maps")], undefined)[0].price, null);
assert.deepStrictEqual(combine(undefined, [found("Only Backboard", 70)]).map(row => [row.name, row.price]), [["Only Backboard", 70]]);

// A quoted price is labelled quoted
assert.strictEqual(combine([], [found("Quoted Inn", 88, { priceType: "quoted" })])[0].priceKind, "quoted");

console.log("combine: all tests passed");
