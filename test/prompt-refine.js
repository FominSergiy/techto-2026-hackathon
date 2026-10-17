// Offline tests for the review step (regex parser only, no API calls). Run: node test/prompt-refine.js
const assert = require("node:assert");
const { refine, argsToSettings, searchPrompt, resolve } = require("../prompt_refine");
const { parsePrompt } = require("../prompt");

(async () => {
    // A rough request becomes a full sentence plus one flag per setting
    const rough = "cheapest hotel in Paris, FR under 200 EUR for 2 adults 2026-11-20 to 2026-11-22";
    const search = await refine(rough, "search", { offline: true });
    const [sentence, flags] = search.prompt.split("\n");
    assert.match(sentence, /^Cheapest hotels in Paris, FR, check-in 2026-11-20, check-out 2026-11-22, 2 adults, under 200 EUR/);
    for (const flag of ["--city=Paris", "--country-code=FR", "--check-in=2026-11-20", "--check-out=2026-11-22", "--adults=2", "--currency=EUR", "--max-nightly-price=200", "--region=null"]) {
        assert.ok(flags.includes(flag), `missing ${flag} in: ${flags}`);
    }
    assert.ok(search.assumed.some(note => note.startsWith("min rating")), "defaults must be listed as assumed");
    assert.deepStrictEqual(search.warnings, []);

    // The reviewed prompt runs literally: same flags back, no second parse, values with spaces survive quoting
    const literal = await parsePrompt(search.prompt, { literal: true });
    assert.strictEqual(literal.parser, "reviewed prompt");
    assert.deepStrictEqual(literal.args, flags.split(" "));
    const spaced = await parsePrompt('x --city=Sydney --region="New South Wales" --adults=2', { literal: true });
    assert.deepStrictEqual(spaced.args, ["--city=Sydney", "--region=New South Wales", "--adults=2"]);
    assert.deepStrictEqual(argsToSettings(spaced.args), { city: "Sydney", region: "New South Wales", adults: 2 });
    assert.match(searchPrompt({ city: "Sydney", region: "New South Wales", countryCode: "AU", checkIn: "2026-11-20", checkOut: "2026-11-21", adults: 1, currency: "AUD", maxNightlyPrice: null, minRating: null, minReviews: null, targetCount: 10 }), /--region="New South Wales" .*--max-nightly-price=null/);

    // An empty-ish request falls back to the default city and next Saturday, and says so
    const bare = await refine("hotels", "search", { offline: true });
    assert.match(bare.prompt, /^Cheapest hotels in Aurora, Ontario, CA, check-in \d{4}-\d{2}-\d{2}, check-out \d{4}-\d{2}-\d{2}, 1 adult,/);
    assert.ok(bare.assumed.some(note => /^check-in: .* \(next Saturday\)$/.test(note)));

    // A different city with no country is flagged instead of silently getting the default country
    const noCountry = resolve({ city: "Paris" });
    assert.strictEqual(noCountry.settings.countryCode, undefined);
    assert.match(noCountry.warnings[0], /No country given for Paris/);

    // Backboard gets the full sentence: inside the city, country name, dates, and a request for phones/address/source page
    const backboard = await refine(rough, "backboard", { offline: true });
    assert.match(backboard.prompt, /cheapest hotels inside the city of Paris, France, for check-in 2026-11-20 and check-out 2026-11-22, 2 adults\./);
    assert.match(backboard.prompt, /Prices in EUR, under 200 per night\./);
    assert.match(backboard.prompt, /phone number, street address, and the page where you saw the price/);
    assert.doesNotMatch(backboard.prompt, /rated|reviews/, "default rating/review minimums must not go to Backboard");
    assert.ok(!backboard.assumed.some(note => /^min (rating|reviews)/.test(note)), "Backboard must not list unused defaults");
    assert.ok(backboard.assumed.includes("hotels to return: 10 (Backboard default)"));

    await assert.rejects(() => refine(rough, "nope"), /unknown target/);
    console.log("prompt-refine: all tests passed");
})();
