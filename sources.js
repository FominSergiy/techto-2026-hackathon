// The hotel price sources: which module searches each one and which .env keys it needs.
// Used by search.js to run them and by server.js to show them as checkboxes.
try {
    process.loadEnvFile();
} catch {
    // No .env file - rely on the environment
}

const SOURCES = {
    xotelo: { label: "Xotelo", detail: "TripAdvisor rates, free", module: "./xotelo", env: [] },
    searchapi: { label: "SearchApi", detail: "Google Hotels", module: "./searchapi", env: ["SEARCH_API_KEY"] },
    liteapi: { label: "LiteAPI", detail: "bookable rates", module: "./liteapi", env: ["LITE_API_KEY"] },
    hotelbeds: { label: "Hotelbeds", detail: "wholesale rates", module: "./hotelbeds", env: ["HOTELBEDS_API_KEY", "HOTELBEDS_SECRET"] },
    booking: { label: "Booking.com", detail: "via Apify", module: "./apify-booking", env: ["APIFY_TOKEN"] }
};

// Google Places isn't a price source: it adds phones and addresses, and checks each hotel's city
const PLACES = { env: ["GOOGLE_MAPS_API_KEY"] };

const missing = names => names.filter(name => !process.env[name]);

// What the page needs to draw its checkboxes: every source and the env vars it is still missing
function describe() {
    return {
        sources: Object.entries(SOURCES).map(([name, { label, detail, env }]) => ({ name, label, detail, missing: missing(env) })),
        places: { missing: missing(PLACES.env) }
    };
}

module.exports = { SOURCES, describe };
