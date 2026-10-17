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

// One row per hotel: the cheapest offer, with every offer kept in `offers`
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
                city: offers.find(offer => offer.city)?.city || settings.city,
                offers: offers.map(({ source, nightlyPrice, url }) => ({ source, nightlyPrice, url }))
            };
        })
        .sort((a, b) => a.nightlyPrice - b.nightlyPrice)
        .slice(0, settings.targetCount);
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

    let hotels = merge(results.filter(result => result.status === "fulfilled").flatMap(result => result.value));

    if (settings.enrichPhones) {
        try {
            hotels = await enrichWithPlaces(hotels);
        } catch (error) {
            console.error(`Skipping phone numbers: ${error.message}`);
        }
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
