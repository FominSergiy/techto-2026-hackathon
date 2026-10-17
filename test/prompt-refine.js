// Offline tests for the review step (regex parser only, no API calls). Run: node test/prompt-refine.js
const assert = require("node:assert");
const { refine, argsToSettings, searchPrompt, resolve } = require("../prompt_refine");
const { parsePrompt } = require("../prompt");

(async () => {
    // A rough request becomes a full sentence plus one flag per setting
    const rough = "cheapest hotel in Paris, FR under 200 EUR for 2 adults 2026-11-20 to 2026-11-22";
    const search = await refine(rough, "search", { offline: true });
    const [sentence, flags] = search.prompt.split("\n");
    // The city comes from the request; the region is always Ontario and the country Canada (so "FR" is ignored)
    assert.match(sentence, /^Cheapest hotels in Paris, Ontario, CA, check-in 2026-11-20, check-out 2026-11-22, 2 adults, under 200 EUR/);
    for (const flag of ["--city=Paris", "--region=Ontario", "--country-code=CA", "--check-in=2026-11-20", "--check-out=2026-11-22", "--adults=2", "--currency=EUR", "--max-nightly-price=200"]) {
        assert.ok(flags.includes(flag), `missing ${flag} in: ${flags}`);
    }
    assert.ok(search.assumed.includes("hotels to return: 20 (default)"), "defaults must be listed as assumed");
    assert.ok(!search.assumed.some(note => /^min (rating|reviews)/.test(note)), "rating and review minimums have no default, so they stay off");
    assert.ok(!/minRating|min-rating|min-reviews/.test(flags), `no rating or review flags without a request for them: ${flags}`);
    assert.strictEqual(search.warnings.length, 1);
    assert.match(search.warnings[0], /region is fixed to Ontario, CA, so "FR" from the request was ignored/);
    assert.ok(search.assumed.includes("region: Ontario, CA (fixed)"));
    assert.ok(!search.assumed.some(note => note.startsWith("city")), "a city from the request is not an assumption");

    // The reviewed prompt runs literally: same flags back, no second parse, values with spaces survive quoting
    const literal = await parsePrompt(search.prompt, { literal: true });
    assert.strictEqual(literal.parser, "reviewed prompt");
    assert.deepStrictEqual(literal.args, flags.split(" "));
    const spaced = await parsePrompt('x --city=Sydney --region="New South Wales" --adults=2', { literal: true });
    assert.deepStrictEqual(spaced.args, ["--city=Sydney", "--region=New South Wales", "--adults=2"]);
    assert.deepStrictEqual(argsToSettings(spaced.args), { city: "Sydney", region: "New South Wales", adults: 2 });
    assert.match(searchPrompt({ city: "Sydney", region: "New South Wales", countryCode: "AU", checkIn: "2026-11-20", checkOut: "2026-11-21", adults: 1, currency: "AUD", maxNightlyPrice: null, minRating: null, minReviews: null, targetCount: 10 }), /--region="New South Wales" .*--max-nightly-price=null/);

    // An empty-ish request has no default city (it only comes from the prompt), so it is warned about; dates fall back to next Saturday
    const bare = await refine("hotels", "search", { offline: true });
    assert.match(bare.prompt, /^Cheapest hotels in Ontario, CA, check-in \d{4}-\d{2}-\d{2}, check-out \d{4}-\d{2}-\d{2}, 1 adult,/);
    assert.ok(bare.warnings.some(warning => /names no city/.test(warning)), `expected a no-city warning: ${bare.warnings}`);
    assert.ok(bare.assumed.some(note => /^check-in: .* \(next Saturday\)$/.test(note)));
    assert.ok(!resolve({ city: "Aurora" }).warnings.some(warning => /names no city/.test(warning)), "a city from the request must not warn");

    // A different city with no country is flagged instead of silently getting the default country
    const other = resolve({ city: "Markham", region: "Illinois", countryCode: "US" });
    assert.deepStrictEqual([other.settings.city, other.settings.region, other.settings.countryCode], ["Markham", "Ontario", "CA"]);
    assert.match(other.warnings[0], /"Illinois, US" from the request was ignored/);
    assert.deepStrictEqual(resolve({ city: "Newmarket", region: "ontario", countryCode: "ca" }).warnings, [], "Ontario, CA itself must not warn");

    // Backboard gets the full sentence: inside the city, country name, dates, and a request for phones/address/source page
    const backboard = await refine(rough, "backboard", { offline: true });
    assert.match(backboard.prompt, /cheapest hotels inside the city of Paris, Ontario, Canada, for check-in 2026-11-20 and check-out 2026-11-22, 2 adults\./);
    assert.match(backboard.prompt, /Prices in EUR, under 200 per night\./);
    assert.match(backboard.prompt, /phone number, street address, and the page where you saw the price/);
    assert.doesNotMatch(backboard.prompt, /rated|reviews/, "default rating/review minimums must not go to Backboard");
    assert.ok(!backboard.assumed.some(note => /^min (rating|reviews)/.test(note)), "Backboard must not list unused defaults");
    assert.ok(backboard.assumed.includes("hotels to return: 20 (default)"));
    assert.match(backboard.prompt, /^List the 20 cheapest hotels inside the city of/);

    // Both boxes default to the top 20, and an explicit count in the request still wins
    assert.match(search.prompt, /top 20\n/);
    assert.ok(flags.includes("--target-count=20"), `missing --target-count=20 in: ${flags}`);
    assert.strictEqual(resolve({ targetCount: 5 }).settings.targetCount, 5);
    assert.strictEqual(resolve({ targetCount: null }).settings.targetCount, 20);

    await assert.rejects(() => refine(rough, "nope"), /unknown target/);
    console.log("prompt-refine: all tests passed");
})();
