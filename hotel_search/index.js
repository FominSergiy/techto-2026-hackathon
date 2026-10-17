// Hotel search suite: runs every source in settings.sources in parallel, merges the results
// (one row per hotel, cheapest offer wins), adds phone numbers and addresses from Google Places,
// and returns the hotels. The root search.js calls search() and prints / saves them.
const settings = require("./settings");
const path = require("node:path");
const { normalizeName, matchesCity, withRawCapture } = require("./hotel-utils");
const { enrichWithPlaces } = require("./places");

const { SOURCES } = require("./sources");

// `report.sources` gets one entry per source, for the page: what the API returned (`fetched`, before any filter), how
// many passed the price / rating filters (`kept`), the error if it failed, and the saved raw file.
async function runSource(name, report) {
    const entry = { name, label: SOURCES[name]?.label || name, ok: false, fetched: null, kept: 0, error: null, file: null };
    report.sources.push(entry);

    if (!SOURCES[name]) {
        entry.error = `unknown source (expected one of ${Object.keys(SOURCES).join(", ")})`;
        throw new Error(entry.error);
    }

    const started = Date.now();
    const stats = {};
    try {
        // Raw API responses go to output/raw/<module name>/ (xotelo, apify-google-hotels, ...), one file per run
        const { search } = require(SOURCES[name].module);
        const hotels = await withRawCapture(path.basename(SOURCES[name].module), search, stats);
        console.log(`${name}: ${hotels.length} hotels in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        Object.assign(entry, { ok: true, kept: hotels.length, fetched: stats.fetched ?? null, file: stats.file ?? null });
        return hotels.map(hotel => ({ ...hotel, source: name }));
    } catch (error) {
        Object.assign(entry, { error: error.message, fetched: stats.fetched ?? 0, file: stats.file ?? null });
        throw error;
    }
}

// One row per hotel: the cheapest offer, with every offer kept in `offers`. City stays null
// unless a source or Google Places knows it - it is never guessed from the search city.
function merge(hotels) {
    const groups = new Map();
    for (const hotel of hotels) {
        const key = normalizeName(hotel.name);
        groups.set(key, [...(groups.get(key) || []), hotel]);
    }

    return [...groups.values()]
        .map(offers => {
            offers.sort((a, b) => a.nightlyPrice - b.nightlyPrice);
            return {
                ...offers[0],
                city: offers.find(offer => offer.city)?.city || null,
                offers: offers.map(({ source, nightlyPrice, url }) => ({ source, nightlyPrice, url }))
            };
        })
        .sort((a, b) => a.nightlyPrice - b.nightlyPrice);
}

// Sources return hotels from the surrounding area too (a search for Aurora, ON also gives Markham,
// Newmarket and even Aurora, IL), so keep only hotels verified to be in the search city, region and country.
function filterToCity(hotels, report = {}) {
    const sameName = (a, b) => normalizeName(a) === normalizeName(b);
    const kept = [];
    const elsewhere = [];
    const unverified = [];

    for (const hotel of hotels) {
        if (!hotel.city) {
            unverified.push(hotel);
            continue;
        }

        const inCity = matchesCity(hotel)
            && (!settings.region || !hotel.region || [hotel.region, hotel.regionCode].some(name => sameName(name, settings.region)))
            && (!hotel.country || hotel.country.toLowerCase() === settings.countryCode.toLowerCase());
        (inCity ? kept : elsewhere).push(hotel);
    }

    const where = [settings.city, settings.region].filter(Boolean).join(", ");
    console.log(`City filter (${where}): kept ${kept.length}, dropped ${elsewhere.length} in other places, ${unverified.length} with no verifiable city`);
    elsewhere.forEach(hotel => console.log(`  other place: ${hotel.name} (${[hotel.city, hotel.regionCode].filter(Boolean).join(", ")})`));
    unverified.forEach(hotel => console.log(`  unverified:  ${hotel.name}`));
    report.city = {
        mode: "Google Places",
        unverifiedDropped: true,   // only hotels Places placed in the city are kept
        searched: settings.city,
        kept: kept.length,
        dropped: elsewhere.map(hotel => ({ name: hotel.name, city: [hotel.city, hotel.regionCode].filter(Boolean).join(", ") })),
        unverified: unverified.map(hotel => hotel.name)
    };
    return kept;
}

// The city check Google Places does is skipped when Places is unticked, but a source may still say where a hotel is
// (the Google actor's "Markham, ON, Canada"). Drop hotels a source places in another city, keep the ones it says
// nothing about. Weaker than the Places check, which also verifies the hotels that have no city.
function dropKnownOtherCities(hotels, report = {}) {
    const kept = hotels.filter(hotel => !hotel.city || matchesCity(hotel));
    const dropped = hotels.filter(hotel => !kept.includes(hotel));
    console.log(`Source city check (${settings.city}): dropped ${dropped.length} hotels a source places in other cities, ${kept.filter(hotel => !hotel.city).length} have no city to check`);
    dropped.forEach(hotel => console.log(`  other place: ${hotel.name} (${hotel.city})`));
    report.city = {
        mode: "the sources' own addresses (Google Places is off)",
        unverifiedDropped: false,
        searched: settings.city,
        kept: kept.length,
        dropped: dropped.map(hotel => ({ name: hotel.name, city: hotel.city })),
        unverified: kept.filter(hotel => !hotel.city).map(hotel => hotel.name)
    };
    return kept;
}

async function search() {
    const started = Date.now();
    // What every API returned and what the city check did with it, for the page (also printed by search.js --json)
    const report = { searched: settings.city, sources: [], merged: 0, city: null };
    search.lastReport = report;
    const results = await Promise.allSettled(settings.sources.map(name => runSource(name, report)));

    // One failing source (missing key, API down) shouldn't sink the others
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            console.error(`${settings.sources[index]} failed: ${result.reason.message}`);
        }
    });

    const merged = merge(results.filter(result => result.status === "fulfilled").flatMap(result => result.value));
    report.merged = merged.length;
    let hotels = merged.slice(0, settings.targetCount);

    if (settings.enrichPhones) {
        // Look up extra candidates when filtering by city, since some will turn out to be elsewhere
        const candidates = merged.slice(0, settings.strictCity ? settings.targetCount * 2 : settings.targetCount);
        try {
            hotels = await withRawCapture("places", () => enrichWithPlaces(candidates));
            if (settings.strictCity) {
                hotels = filterToCity(hotels, report).slice(0, settings.targetCount);
            }
        } catch (error) {
            console.error(`Skipping phone numbers and the city check: ${error.message}`);
        }
    } else if (settings.strictCity) {
        console.warn("strictCity needs enrichPhones (Google Places) for the full city check - only hotels a source places in another city are dropped");
        hotels = dropKnownOtherCities(merged, report).slice(0, settings.targetCount);
    }

    console.log(`Search took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return hotels;
}

module.exports = { search, filterToCity, dropKnownOtherCities };
