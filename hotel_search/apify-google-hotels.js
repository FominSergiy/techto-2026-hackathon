// Google Hotels prices via the Apify "Google Hotels Search Scraper" - https://apify.com/johnvc/google-hotels-search-scraper
// Costs $0.02 per run plus $0.02 per results page.
const settings = require("./settings");
const { runApifyActor, normalizeHotel, countryName, perNight, passesFilters, cheapest, runIfMain } = require("./hotel-utils");

const ACTOR = "johnvc~google-hotels-search-scraper";

function buildInput() {
    const input = {
        search_type: "search",
        // gl=ca only biases the results, so the query itself names city, region and country
        q: `hotels in ${[settings.city, settings.region, settings.countryCode && countryName(settings.countryCode)].filter(Boolean).join(", ")}`,
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

// One property from a results page -> the common hotel shape. Search results have no phone or address
// (only the actor's property-details mode does), so those stay null and come from Google Places.
function normalize(property) {
    const totalPrice = property.total_rate?.extracted_lowest;
    return normalizeHotel({
        name: property.name,
        location: property.gps_coordinates,
        nightlyPrice: property.rate_per_night?.extracted_lowest ?? perNight(totalPrice ?? null),
        totalPrice,
        currency: settings.currency,
        rating: property.overall_rating,
        reviews: property.reviews,
        address: property.address,
        phone: property.phone,
        url: property.link
    });
}

// The actor returns one item per results page, each with a `properties` list (hotels and vacation rentals, see `type`)
const toHotels = pages => pages.flatMap(page => page.properties || []).map(normalize);

async function search() {
    const pages = await runApifyActor(ACTOR, buildInput());
    const hotels = toHotels(pages);
    console.log(`Apify Google Hotels: ${pages.length} pages, ${hotels.length} hotels`);
    return cheapest(hotels.filter(passesFilters));
}

module.exports = { search, buildInput, toHotels, normalize };
runIfMain(module, "Apify Google Hotels", search);
