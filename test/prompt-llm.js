// Offline tests for which parser rewrites the prompt. fetch is stubbed, so no API is called.
// Run: node test/prompt-llm.js
const assert = require("node:assert");
const { parsePrompt } = require("../prompt");
const { refine } = require("../prompt_refine");

const ROUGH = "find the cheapest option in monteral, 1 person, check in today 17th october, check out tomorrow 18th october";
const SETTINGS = { city: "Montreal", adults: 1, checkIn: "2026-10-17", checkOut: "2026-10-18" };

const calls = [];
// Each queued answer is { ok, body } for the next fetch call
function stub(...answers) {
    calls.length = 0;
    global.fetch = async (url, options) => {
        calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        const { ok = true, body } = answers.shift();
        return { ok, status: ok ? 200 : 500, json: async () => body };
    };
}

const anthropicReply = { content: [{ text: JSON.stringify(SETTINGS) }], usage: { input_tokens: 90, output_tokens: 30 } };
const backboardReply = { status: "COMPLETED", content: `\`\`\`json\n${JSON.stringify(SETTINGS)}\n\`\`\``, input_tokens: 80, output_tokens: 25 };

function keys({ anthropic, backboard }) {
    for (const [name, value] of [["ANTHROPIC_API_KEY", anthropic], ["BACKBOARD_API_KEY", backboard]]) {
        if (value) process.env[name] = value;
        else delete process.env[name];
    }
    delete process.env.BACKBOARD_PARSER_MODEL;
    delete process.env.BACKBOARD_PARSER_PROVIDER;
}

(async () => {
    // Backboard only: the cheap model parses it, a typo and relative dates come out right
    keys({ backboard: "bb-key" });
    stub({ body: backboardReply });
    const viaBackboard = await parsePrompt(ROUGH);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "https://app.backboard.io/api/threads/messages");
    assert.strictEqual(calls[0].headers["X-API-Key"], "bb-key");
    assert.deepStrictEqual([calls[0].body.llm_provider, calls[0].body.model_name, calls[0].body.web_search, calls[0].body.memory], ["openai", "gpt-4o-mini", "off", "off"]);
    assert.strictEqual(calls[0].body.content, ROUGH);
    assert.match(calls[0].body.system_prompt, /Fix obvious typos/);
    // "the cheapest option" must not be read as a count of 1 (that gave a top-1 list)
    assert.match(calls[0].body.system_prompt, /'the cheapest hotel\/option' is NOT a count of 1: omit the key/);
    assert.strictEqual(viaBackboard.parser, "backboard/gpt-4o-mini");
    assert.deepStrictEqual(viaBackboard.usage, { input_tokens: 80, output_tokens: 25 });
    assert.ok(viaBackboard.args.includes("--city=Montreal") && viaBackboard.args.includes("--check-out=2026-10-18"));
    assert.strictEqual(viaBackboard.fallbackReason, null);

    // The model is overridable
    process.env.BACKBOARD_PARSER_MODEL = "gpt-4.1-nano";
    stub({ body: backboardReply });
    assert.strictEqual((await parsePrompt(ROUGH)).parser, "backboard/gpt-4.1-nano");

    // Both keys: Claude Haiku goes first and Backboard is never called
    keys({ anthropic: "an-key", backboard: "bb-key" });
    stub({ body: anthropicReply });
    const viaClaude = await parsePrompt(ROUGH);
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /api\.anthropic\.com/);
    assert.strictEqual(viaClaude.parser, "claude-haiku-5-5");

    // Claude failing falls through to Backboard instead of straight to regex
    stub({ ok: false, body: { error: { message: "overloaded" } } }, { body: backboardReply });
    const fellThrough = await parsePrompt(ROUGH);
    assert.deepStrictEqual(calls.map(call => new URL(call.url).hostname), ["api.anthropic.com", "app.backboard.io"]);
    assert.strictEqual(fellThrough.parser, "backboard/gpt-4o-mini");

    // Every LLM failing ends on regex and says why
    stub({ ok: false, body: { error: { message: "overloaded" } } }, { status: "FAILED", body: { status: "FAILED" } });
    const allFailed = await parsePrompt(ROUGH);
    assert.strictEqual(allFailed.parser, "regex");
    assert.match(allFailed.fallbackReason, /Claude failed: overloaded; Backboard failed/);

    // No keys at all: regex, with a reason the review panel shows as a warning
    keys({});
    stub();
    const noKeys = await refine(ROUGH, "search");
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(noKeys.parser, "regex");
    assert.match(noKeys.warnings[0], /regex fallback \(no ANTHROPIC_API_KEY or BACKBOARD_API_KEY is set\).*check the city and dates/);

    // Offline (DEMO) never calls an API even with keys, and does not nag about the fallback
    keys({ anthropic: "an-key", backboard: "bb-key" });
    stub();
    const offline = await refine(ROUGH, "search", { offline: true });
    assert.strictEqual(calls.length, 0);
    assert.deepStrictEqual(offline.warnings.filter(warning => /fallback/.test(warning)), []);

    // With an LLM the whole thing comes out right, through to the prompt the user reviews
    keys({ backboard: "bb-key" });
    stub({ body: backboardReply });
    const reviewed = await refine(ROUGH, "search");
    assert.match(reviewed.prompt, /^Cheapest hotels in Montreal, Ontario, CA, check-in 2026-10-17, check-out 2026-10-18, 1 adult,/);
    assert.strictEqual(reviewed.parser, "backboard/gpt-4o-mini");
    assert.deepStrictEqual(reviewed.warnings, []);
    assert.match(reviewed.prompt, /top 20\n/, "no count in the reply means the top 20, not 1");

    // A model that answers "no limit" (null) for a request with no price must not switch the default cap off
    const nullPrice = body => ({ status: "COMPLETED", content: JSON.stringify({ ...SETTINGS, maxNightlyPrice: null, ...body }), input_tokens: 80, output_tokens: 25 });
    keys({ backboard: "bb-key" });
    stub({ body: nullPrice() });
    const capped = await refine(ROUGH, "search");
    assert.match(capped.prompt, /under 150 CAD/, "the default cap applies");
    assert.ok(capped.prompt.includes("--max-nightly-price=150"), capped.prompt);
    assert.ok(capped.assumed.some(note => /^max price per night: 150/.test(note)));

    // ...but asking for no limit still turns it off, and an explicit price wins
    stub({ body: nullPrice() });
    const unlimited = await refine(`${ROUGH}, no price limit`, "search");
    assert.ok(unlimited.prompt.includes("--max-nightly-price=null"), unlimited.prompt);
    stub({ body: nullPrice({ maxNightlyPrice: 90 }) });
    assert.ok((await refine(`${ROUGH}, under 90`, "search")).prompt.includes("--max-nightly-price=90"));

    // Without the review step the region stays Ontario, CA: a region or country the model guessed is dropped...
    const { pinRegion } = require("../prompt");
    keys({ backboard: "bb-key" });
    stub({ body: { status: "COMPLETED", content: JSON.stringify({ city: "Paris", region: null, countryCode: "FR", adults: 2 }), input_tokens: 5, output_tokens: 5 } });
    const guessed = await parsePrompt("hotels in Paris for 2");
    assert.ok(guessed.args.includes("--region=null") && guessed.args.includes("--country-code=FR"), "the model's guess is in the parsed args");
    assert.deepStrictEqual(pinRegion(guessed.args, "hotels in Paris for 2"), ["--city=Paris", "--adults=2"]);
    // ...unless the prompt itself carries the flag
    assert.deepStrictEqual(pinRegion(["--city=Paris", "--region=Quebec", "--country-code=CA"], "hotels in Paris --region=Quebec"), ["--city=Paris", "--region=Quebec"]);

    // A prompt with no city is refused instead of searching the whole province
    const { hasCity } = require("../prompt");
    assert.strictEqual(hasCity(["--city=Hamilton", "--adults=1"]), true);
    for (const none of [[], ["--adults=1"], ["--city=null"], ["--city="], ["--city=undefined"]]) {
        assert.strictEqual(hasCity(none), false, JSON.stringify(none));
    }
    assert.strictEqual(hasCity((await parsePrompt("hotels", { offline: true })).args), false, "the regex parser found no city in 'hotels'");

    console.log("prompt-llm: all tests passed");
})();
