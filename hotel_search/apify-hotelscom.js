// Hotels.com prices via the Apify Hotels.com Scraper - https://apify.com/jeremy_frost/hotels-com-scraper
// The actor drives a browser on Apify's servers - check this against the "no browser automation" rule.
const settings = require("./settings");
const { runApifyActor, countryName, passesFilters, cheapest, runIfMain } = require("./hotel-utils");

const ACTOR = "jeremy_frost~hotels-com-scraper";

function buildInput() {
    return {
        // The actor has no country or region input, only one free-text place (and its docs say no special characters),
        // so the region and country go in the text: "Hamilton Ontario Canada", not just "Hamilton" (also in NZ, Bermuda, Ohio...)
        place: [settings.city, settings.region, settings.countryCode && countryName(settings.countryCode)].filter(Boolean).join(" "),
        start_date: settings.checkIn,
        end_date: settings.checkOut,
        min_stars: "1",
        // Ask for extra to cover hotels without prices or above the price cap
        max_depth: settings.targetCount * 2
    };
}

// Output fields are unconfirmed until a real run: see test/fixtures
function toHotels(items) {
    return items.map(item => ({
        name: item.name || item.hotel_name,
        nightlyPrice: item.price ?? null,
        currency: settings.currency,
        rating: null,
        reviews: null,
        address: null,
        url: item.link || null
    }));
}

async function search() {
    const items = await runApifyActor(ACTOR, buildInput());
    const hotels = toHotels(items);
    console.log(`Apify Hotels.com: ${hotels.length} hotels`);
    return cheapest(hotels.filter(passesFilters));
}

module.exports = { search, buildInput, toHotels };
runIfMain(module, "Apify Hotels.com", search);
