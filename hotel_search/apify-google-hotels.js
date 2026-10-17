// Google Hotels prices via the Apify "Google Hotels Search Scraper" - https://apify.com/johnvc/google-hotels-search-scraper
// Costs $0.02 per run plus $0.02 per results page.
const settings = require("./settings");
const { runApifyActor, perNight, passesFilters, cheapest, runIfMain } = require("./hotel-utils");

const ACTOR = "johnvc~google-hotels-search-scraper";

function buildInput() {
    const input = {
        search_type: "search",
        q: `hotels in ${[settings.city, settings.region, settings.countryCode].filter(Boolean).join(", ")}`,
        gl: settings.countryCode.toLowerCase(),
        hl: "en",
        currency: settings.currency,
        check_in_date: settings.checkIn,
        check_out_date: settings.checkOut,
        adults: settings.adults,
        max_pages: settings.maxPages
    };
    if (settings.maxNightlyPrice != null) {
        input.max_price = String(settings.maxNightlyPrice);
    }
    return input;
}

// The actor returns one item per results page, each with a `properties` list. It mixes in vacation rentals
// (type "vacation rental") even with vacation_rentals off, and we book hotels by phone, so those are dropped.
function toHotels(pages) {
    return pages.flatMap(page => page.properties || []).filter(property => !property.type || property.type === "hotel").map(property => {
        const totalPrice = property.total_rate?.extracted_lowest ?? null;
        return {
            name: property.name,
            location: property.gps_coordinates || null,
            nightlyPrice: property.rate_per_night?.extracted_lowest ?? perNight(totalPrice),
            totalPrice,
            currency: settings.currency,
            rating: property.overall_rating ?? null,
            reviews: property.reviews ?? null,
            address: property.address || null,
            url: property.link || null
        };
    });
}

async function search() {
    const pages = await runApifyActor(ACTOR, buildInput());
    const hotels = toHotels(pages);
    console.log(`Apify Google Hotels: ${pages.length} pages, ${hotels.length} hotels`);
    return cheapest(hotels.filter(passesFilters));
}

module.exports = { search, buildInput, toHotels };
runIfMain(module, "Apify Google Hotels", search);
