// Search settings shared by every hotel source.
// Override any value from the command line, e.g.:
//   node search.js --city=Paris --country-code=FR --max-nightly-price=200
// Lists are comma-separated (--sources=xotelo,searchapi) and "null" disables a filter (--min-reviews=null).
const defaults = {
    // City X is revealed at competition time
    city: "Aurora",
    countryCode: "CA",
    // Provider location codes - null looks them up from city (see locations.js)
    tripadvisorLocationKey: null,       // Xotelo, e.g. g155019 for Toronto
    hotelbedsDestinationCode: null,     // Hotelbeds, e.g. YTO for Toronto

    // Stay
    checkIn: "2026-11-20",
    checkOut: "2026-11-22",
    adults: 1,
    currency: "CAD",

    // Results
    targetCount: 30,
    maxPages: 5,
    enrichPhones: true,     // look up phone numbers and addresses in Google Places (needs GOOGLE_MAPS_API_KEY)
    outputDir: "output",    // search.js saves CSV + JSON here; null disables

    // Filters (null disables)
    maxNightlyPrice: 400,
    minRating: 4.0,     // out of 5 - 10-point sources (Booking, LiteAPI) are halved before comparing
    minReviews: 50,

    // Sources search.js runs: xotelo, searchapi, liteapi, hotelbeds, booking
    sources: ["xotelo", "searchapi", "liteapi", "hotelbeds"]
};

function parseValue(raw, current) {
    if (raw === "null") return null;
    if (Array.isArray(current)) return raw.split(",");
    if (typeof current === "number") return Number(raw);
    if (typeof current === "boolean") return raw === "true";
    return raw;
}

// --max-nightly-price=200 -> { maxNightlyPrice: 200 }
function parseArgs(argv) {
    const overrides = {};
    for (const arg of argv) {
        const match = arg.match(/^--([\w-]+)=(.*)$/);
        if (!match) continue;

        const key = match[1].replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
        if (!(key in defaults)) {
            console.error(`Unknown setting --${match[1]}`);
            process.exit(1);
        }
        overrides[key] = parseValue(match[2], defaults[key]);
    }
    return overrides;
}

const settings = { ...defaults, ...parseArgs(process.argv.slice(2)) };
settings.nights = (Date.parse(settings.checkOut) - Date.parse(settings.checkIn)) / 86400000;

module.exports = settings;
