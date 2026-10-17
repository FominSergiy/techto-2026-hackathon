// Step 1 of the two-step prompt flow: rewrites a rough request into the full, explicit prompt that will
// actually run, so the UI can show it and wait for a "Run" click. Nothing is searched here.
//   target "search"    -> sentence + --flags for the price APIs (prompt.js reads the flags as-is, no second parse)
//   target "backboard" -> the full sentence the web-search model gets: city/region/country, dates, guests,
//                         currency, and a request for phone numbers, addresses and the page behind each price
// The place (city, region, country) is fixed, never read from the request. Everything else the request leaves
// out is filled from hotel_search/settings.js and listed in `assumed`.
const { parsePrompt } = require("./prompt");
const defaults = require("./hotel_search/settings");

const DAY_MS = 86400000;
const isoDate = ms => new Date(ms).toISOString().slice(0, 10);
const toFlag = key => key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
const NUMBERS = new Set(["adults", "nights", "maxNightlyPrice", "minRating", "minReviews", "targetCount"]);

// The settings that end up as --flags in the search prompt. Sources and Places come from the checkboxes.
const FLAG_KEYS = ["city", "region", "countryCode", "checkIn", "checkOut", "adults", "currency", "maxNightlyPrice", "minRating", "minReviews", "targetCount"];
const BACKBOARD_COUNT = 10;
const REGION = "Ontario";

// ["--check-in=2026-11-20", "--min-rating=null"] -> { checkIn: "2026-11-20", minRating: null }
function argsToSettings(args) {
    const settings = {};
    for (const arg of args) {
        const match = arg.match(/^--([\w-]+)=(.*)$/);
        if (!match) continue;
        const key = match[1].replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
        const raw = match[2].replace(/^"(.*)"$/, "$1");
        settings[key] = raw === "null" ? null : NUMBERS.has(key) ? Number(raw) : raw;
    }
    return settings;
}

const countryName = code => {
    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase());
    } catch {
        return code;
    }
};

const show = value => (value === null ? "no limit" : value);

// Fills what the request left out. `explicit` remembers what the user actually said.
function resolve(parsed) {
    const assumed = [];
    const warnings = [];
    const settings = { ...parsed };
    const fill = (key, label) => {
        if (settings[key] !== undefined) return;
        settings[key] = defaults[key];
        assumed.push(`${label}: ${show(defaults[key])} (default)`);
    };

    // The place is never taken from the request: the city is whatever hotel_search/settings.js says
    // (City X, set when it is revealed) and the region is always Ontario. Say so if the request named another place.
    const differs = (said, fixed) => said != null && String(said).toLowerCase() !== String(fixed).toLowerCase();
    const ignored = [
        differs(parsed.city, defaults.city) && parsed.city,
        differs(parsed.region, REGION) && parsed.region,
        differs(parsed.countryCode, defaults.countryCode) && parsed.countryCode
    ].filter(Boolean);
    if (ignored.length) {
        warnings.push(`The place is fixed to ${defaults.city}, ${REGION}, ${defaults.countryCode}, so "${ignored.join(", ")}" from the request was ignored. The city comes from hotel_search/settings.js.`);
    }
    settings.city = defaults.city;
    settings.region = REGION;
    settings.countryCode = defaults.countryCode;
    assumed.push(`place: ${defaults.city}, ${REGION}, ${defaults.countryCode} (fixed)`);

    if (!settings.checkIn) {
        settings.checkIn = defaults.checkIn;
        assumed.push(`check-in: ${defaults.checkIn} (next Saturday)`);
    }
    if (!settings.checkOut) {
        const nights = settings.nights || 1;
        settings.checkOut = isoDate(Date.parse(settings.checkIn) + nights * DAY_MS);
        assumed.push(`check-out: ${settings.checkOut} (${nights} night${nights === 1 ? "" : "s"})`);
    }
    delete settings.nights;

    fill("adults", "adults");
    fill("currency", "currency");
    fill("maxNightlyPrice", "max price per night");
    fill("minRating", "min rating");
    fill("minReviews", "min reviews");
    fill("targetCount", "hotels to return");
    return { settings, assumed, warnings };
}

function searchPrompt(settings) {
    const where = [settings.city, settings.region, settings.countryCode].filter(Boolean).join(", ");
    const parts = [
        `Cheapest hotels in ${where}`,
        `check-in ${settings.checkIn}`,
        `check-out ${settings.checkOut}`,
        `${settings.adults} adult${settings.adults === 1 ? "" : "s"}`,
        settings.maxNightlyPrice != null ? `under ${settings.maxNightlyPrice} ${settings.currency}` : `prices in ${settings.currency}`
    ];
    if (settings.minRating != null) parts.push(`rating ${settings.minRating}+`);
    if (settings.minReviews != null) parts.push(`at least ${settings.minReviews} reviews`);
    parts.push(`top ${settings.targetCount}`);

    const quote = value => (/\s/.test(value) ? `"${value}"` : value);
    const flags = FLAG_KEYS
        .filter(key => settings[key] !== undefined)
        .map(key => `--${toFlag(key)}=${settings[key] === null ? "null" : quote(String(settings[key]))}`);
    return `${parts.join(", ")}\n${flags.join(" ")}`;
}

// `said` is what the request itself specified: rating and review minimums only go to Backboard when
// asked for, since the defaults would empty the list for a small city
function backboardPrompt(settings, said) {
    const place = [settings.city, settings.region, settings.countryCode && countryName(settings.countryCode)].filter(Boolean).join(", ");
    const count = said.targetCount || BACKBOARD_COUNT;
    const price = settings.maxNightlyPrice != null ? `, under ${settings.maxNightlyPrice} per night` : "";
    const rating = [
        said.minRating != null && `rated ${said.minRating}+`,
        said.minReviews != null && `with at least ${said.minReviews} reviews`
    ].filter(Boolean).join(" ");

    return [
        `List the ${count} cheapest hotels inside the city of ${place}, for check-in ${settings.checkIn} and check-out ${settings.checkOut}, ${settings.adults} adult${settings.adults === 1 ? "" : "s"}.`,
        `Prices in ${settings.currency}${price}.${rating ? ` Only hotels ${rating}.` : ""}`,
        "Include each hotel's phone number, street address, and the page where you saw the price.",
        "Only hotels with a real quoted price."
    ].join(" ");
}

// Returns { prompt, target, assumed, warnings, parser, usage }. `offline` forces the regex parser (DEMO mode).
async function refine(prompt, target = "search", { offline = false } = {}) {
    if (!["search", "backboard"].includes(target)) {
        throw new Error(`unknown target "${target}"`);
    }

    const { args, parser, usage } = await parsePrompt(prompt, { offline });
    const said = argsToSettings(args);
    const { settings, assumed, warnings } = resolve(said);

    // Backboard ignores the rating/review minimums and asks for fewer hotels, so don't list those as assumptions
    const notes = target === "search"
        ? assumed
        : [...assumed.filter(note => !/^(min rating|min reviews|hotels to return)/.test(note)), ...(said.targetCount ? [] : [`hotels to return: ${BACKBOARD_COUNT} (Backboard default)`])];
    return {
        prompt: target === "search" ? searchPrompt(settings) : backboardPrompt(settings, said),
        target,
        assumed: notes,
        warnings,
        parser,
        usage
    };
}

module.exports = { refine, argsToSettings, resolve, searchPrompt, backboardPrompt };
