// Google Hotels prices via SearchApi - https://www.searchapi.io/docs/google-hotels-api
const settings = require("./settings");
const { requireEnv, getJson, normalizeHotel, collectPages, runIfMain } = require("./hotel-utils");

// SearchApi's rating filter only accepts 3.5+, 4.0+ or 4.5+
function ratingParam(minRating) {
    if (minRating >= 4.5) return "9";
    if (minRating >= 4.0) return "8";
    if (minRating >= 3.5) return "7";
    return null;
}

// One Google Hotels property from SearchApi -> the common hotel shape
function normalize(property) {
    return normalizeHotel({
        name: property.name,
        city: property.city,
        location: property.gps_coordinates,
        nightlyPrice: property.price_per_night?.extracted_price,
        totalPrice: property.total_price?.extracted_price,
        currency: settings.currency,
        rating: property.rating,
        reviews: property.reviews,
        address: [property.city, property.country].filter(Boolean).join(", "),
        url: property.link
    });
}

async function search() {
    const [apiKey] = requireEnv("SEARCH_API_KEY");

    return collectPages("SearchApi", async pageToken => {
        const params = new URLSearchParams({
            engine: "google_hotels",
            q: `hotels in ${[settings.city, settings.region, settings.countryCode].filter(Boolean).join(", ")}`,
            check_in_date: settings.checkIn,
            check_out_date: settings.checkOut,
            adults: String(settings.adults),
            currency: settings.currency,
            gl: settings.countryCode.toLowerCase(),
            hl: "en",
            // "lowest_price" re-ranks the whole surrounding region by price and buries the city's own hotels
            sort_by: "relevance",
            api_key: apiKey
        });
        if (settings.maxNightlyPrice != null) {
            params.set("price_max", String(settings.maxNightlyPrice));
        }
        const rating = ratingParam(settings.minRating);
        if (rating) {
            params.set("rating", rating);
        }
        if (pageToken) {
            params.set("next_page_token", pageToken);
        }

        const data = await getJson(`https://www.searchapi.io/api/v1/search?${params}`);
        return {
            hotels: (data.properties || []).map(normalize),
            next: data.pagination?.next_page_token ?? null
        };
    });
}

module.exports = { search, normalize };
runIfMain(module, "SearchApi", search);
