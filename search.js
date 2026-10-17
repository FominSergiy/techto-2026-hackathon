// Hotel search suite: runs every source in settings.sources in parallel, merges the results
// (one row per hotel, cheapest offer wins), adds phone numbers and addresses from Google Places,
// then prints one table and saves CSV + JSON. For example:
//   node search.js --city=Paris --country-code=FR --sources=xotelo,searchapi
const settings = require("./settings");
const { normalizeName } = require("./hotel-utils");
const { enrichWithPlaces } = require("./places");
const { printReport, writeReport } = require("./report");

const SOURCES = {
    xotelo: "./xotelo",
    searchapi: "./searchapi",
    liteapi: "./liteapi",
    hotelbeds: "./hotelbeds",
    booking: "./apify-booking"
};

async function runSource(name) {
    if (!SOURCES[name]) {
        throw new Error(`unknown source (expected one of ${Object.keys(SOURCES).join(", ")})`);
    }

    const started = Date.now();
    const hotels = await require(SOURCES[name]).search();
    console.log(`${name}: ${hotels.length} hotels in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return hotels.map(hotel => ({ ...hotel, source: name }));
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
function filterToCity(hotels) {
    const sameName = (a, b) => normalizeName(a) === normalizeName(b);
    const kept = [];
    const elsewhere = [];
    const unverified = [];

    for (const hotel of hotels) {
        if (!hotel.city) {
            unverified.push(hotel);
            continue;
        }

        const inCity = sameName(hotel.city, settings.city)
            && (!settings.region || !hotel.region || [hotel.region, hotel.regionCode].some(name => sameName(name, settings.region)))
            && (!hotel.country || hotel.country.toLowerCase() === settings.countryCode.toLowerCase());
        (inCity ? kept : elsewhere).push(hotel);
    }

    const where = [settings.city, settings.region].filter(Boolean).join(", ");
    console.log(`City filter (${where}): kept ${kept.length}, dropped ${elsewhere.length} in other places, ${unverified.length} with no verifiable city`);
    elsewhere.forEach(hotel => console.log(`  other place: ${hotel.name} (${[hotel.city, hotel.regionCode].filter(Boolean).join(", ")})`));
    unverified.forEach(hotel => console.log(`  unverified:  ${hotel.name}`));
    return kept;
}

async function search() {
    const started = Date.now();
    const results = await Promise.allSettled(settings.sources.map(runSource));

    // One failing source (missing key, API down) shouldn't sink the others
    results.forEach((result, index) => {
        if (result.status === "rejected") {
            console.error(`${settings.sources[index]} failed: ${result.reason.message}`);
        }
    });

    const merged = merge(results.filter(result => result.status === "fulfilled").flatMap(result => result.value));
    let hotels = merged.slice(0, settings.targetCount);

    if (settings.enrichPhones) {
        // Look up extra candidates when filtering by city, since some will turn out to be elsewhere
        const candidates = merged.slice(0, settings.strictCity ? settings.targetCount * 2 : settings.targetCount);
        try {
            hotels = await enrichWithPlaces(candidates);
            if (settings.strictCity) {
                hotels = filterToCity(hotels).slice(0, settings.targetCount);
            }
        } catch (error) {
            console.error(`Skipping phone numbers and the city check: ${error.message}`);
        }
    } else if (settings.strictCity) {
        console.warn("strictCity needs enrichPhones - results may include nearby cities");
    }

    console.log(`Search took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return hotels;
}

module.exports = { search };

if (require.main === module) {
    search()
        .then(hotels => {
            printReport(hotels);
            writeReport(hotels);
        })
        .catch(error => {
            console.error("Error:", error.message);
            process.exit(1);
        });
}
