// Costs were read from each provider's pricing page on 2026-10-17 - re-check before relying on them.
// The hotel price sources: which module searches each one and which .env keys it needs.
// `defaultOn: false` makes the UI start with a box unticked (none currently do). Used by search.js to run them and by server.js to show them as checkboxes.
try {
    process.loadEnvFile();
} catch {
    // No .env file - rely on the environment
}

const SOURCES = {
    xotelo: { label: "Xotelo", detail: "TripAdvisor rates", module: "./xotelo", env: [],
        cost: { kind: "free", label: "Free", note: "No key needed. Xotelo does not publish rate limits or terms." } },
    searchapi: { label: "SearchApi", detail: "Google Hotels", module: "./searchapi", env: ["SEARCH_API_KEY"],
        cost: { kind: "tier", label: "100 free requests", note: "No card needed for the free requests (expiry not stated). Then $40/month for 10,000 searches." } },
    liteapi: { label: "LiteAPI", detail: "bookable rates", module: "./liteapi", env: ["LITE_API_KEY"],
        cost: { kind: "free", label: "Free", note: "Hotel rates search is free under a reasonable look-to-book policy; only the price-index and places endpoints are charged. Your key is a sandbox key." } },
    hotelbeds: { label: "Hotelbeds", detail: "wholesale rates", module: "./hotelbeds", env: ["HOTELBEDS_API_KEY", "HOTELBEDS_SECRET"],
        cost: { kind: "tier", label: "Test keys: 50/day", note: "Evaluation keys allow 50 requests per day. Hotelbeds' page does not say whether this is free or what production access costs." } },
    booking: { label: "Booking.com", detail: "via Apify", module: "./apify-booking", env: ["APIFY_TOKEN"],
        cost: { kind: "tier", label: "$5 free credit/month", note: "Apify free plan: $5 of usage a month, no card. This scraper's own per-result price was not checked." } },
    // Drives a real browser against Expedia's site. Slow, and Expedia's bot check needs a human in a visible
    // window (HEADLESS=false); headless it reports an error and the other sources still run.
    expedia: { label: "Expedia", detail: "opens a browser window (set HEADLESS=false)", module: "./expedia", env: [],
        cost: { kind: "free", label: "Free", note: "No API: it drives a browser, so there is no per-request charge." } }
};

// Google Places isn't a price source: it adds phones and addresses, and checks each hotel's city
const PLACES = {
    env: ["GOOGLE_MAPS_API_KEY"],
    cost: { kind: "tier", label: "1,000 free/month", note: "Then about $35 per 1,000 lookups (Places Text Search Enterprise SKU; the exact SKU for these fields is unconfirmed). One search can make up to 60 lookups (twice the target count)." }
};

const missing = names => names.filter(name => !process.env[name]);

// What the page needs to draw its checkboxes: every source and the env vars it is still missing
function describe() {
    return {
        sources: Object.entries(SOURCES).map(([name, { label, detail, env, cost, defaultOn = true }]) => ({ name, label, detail, cost, defaultOn, missing: missing(env) })),
        places: { missing: missing(PLACES.env), cost: PLACES.cost }
    };
}

module.exports = { SOURCES, describe };
