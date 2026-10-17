// Search settings shared by every hotel source.
// Override any value from the command line, e.g.:
//   node search.js --city=Paris --country-code=FR --max-nightly-price=200
// Lists are comma-separated (--sources=xotelo,searchapi) and "null" disables a filter (--min-reviews=null).
const defaults = {

    countryCode: "CA",
    region: "Ontario",      // province/state - tells apart cities sharing a name (Aurora, ON vs Aurora, IL); null to skip
    strictCity: true,       // keep only hotels whose Google Places address is in city (needs enrichPhones)

    nights: 1,
    adults: 1,
    currency: "CAD",

    targetCount: 30,
    maxPages: 5,
    enrichPhones: true,     // look up phone numbers and addresses in Google Places (needs GOOGLE_MAPS_API_KEY)
    outputDir: "output",    // search.js saves CSV + JSON here; null disables

    // Filters (null disables)
    maxNightlyPrice: 150,

    // Sources search.js runs: xotelo, searchapi, liteapi, hotelbeds, booking
    sources: ["xotelo", "searchapi", "liteapi", "hotelbeds", "booking", "expedia"]
};

function parseValue(raw, current) {
    if (raw === "null") return null;
    if (Array.isArray(current)) return raw.split(",");
    if (typeof current === "number") return Number(raw);
    if (typeof current === "boolean") return raw === "true";
    return raw;
}

// Flags a source reads from process.argv itself (expedia.js --dump-html=<file>), not settings
const PASSTHROUGH_FLAGS = ["dump-html"];

// Settings with no default because they only come from the prompt (or the command line). The value is an example
// of the type, so parseValue knows whether to keep a string or convert a number.
const PROMPT_ONLY = { city: "", checkIn: "", checkOut: "", minRating: 0, minReviews: 0, tripadvisorLocationKey: "", hotelbedsDestinationCode: "" };
const KNOWN = { ...PROMPT_ONLY, ...defaults };

// --max-nightly-price=200 -> { maxNightlyPrice: 200 }
function parseArgs(argv) {
    const overrides = {};
    for (const arg of argv) {
        const match = arg.match(/^--([\w-]+)=(.*)$/);
        if (!match) continue;

        const key = match[1].replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
        if (PASSTHROUGH_FLAGS.includes(match[1])) continue;
        if (!(key in KNOWN)) {
            console.error(`Unknown setting --${match[1]}`);
            process.exit(1);
        }
        overrides[key] = parseValue(match[2], KNOWN[key]);
    }
    return overrides;
}

const DAY_MS = 86400000;
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

// The Saturday after today (a full week ahead when today is a Saturday)
function nextSaturday() {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const daysAhead = 6 - new Date(today).getUTCDay() || 7;
    return isoDate(today + daysAhead * DAY_MS);
}

const settings = { ...defaults, ...parseArgs(process.argv.slice(2)) };
settings.checkIn = settings.checkIn || nextSaturday();
settings.checkOut = settings.checkOut || isoDate(Date.parse(settings.checkIn) + settings.nights * DAY_MS);
// Derived from the dates so an explicit --check-out always wins over --nights
settings.nights = (Date.parse(settings.checkOut) - Date.parse(settings.checkIn)) / DAY_MS;

module.exports = settings;
