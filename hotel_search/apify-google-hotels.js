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

// One property -> the common hotel shape. The phone and address are only there when the run returned them (a plain
// search run does not, a manual run with phone numbers did); when missing they stay null and come from Google Places.
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

// Two output shapes are seen: one item per results page with a `properties` list (a plain search run), or one flat
// item per hotel (a manual run that included phone numbers). Both give hotels and vacation rentals (see `type`).
const propertiesOf = item => item.properties || (item.name && item.property_token ? [item] : []);
const toHotels = items => items.flatMap(propertiesOf).map(normalize);

async function search() {
    const items = await runApifyActor(ACTOR, buildInput());
    const hotels = toHotels(items);
    console.log(`Apify Google Hotels: ${items.length} dataset items, ${hotels.length} hotels, ${hotels.filter(hotel => hotel.phone).length} with a phone`);
    return cheapest(hotels.filter(passesFilters));
}

module.exports = { search, buildInput, toHotels, normalize };
runIfMain(module, "Apify Google Hotels", search);
