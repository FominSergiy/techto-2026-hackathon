// Booking.com prices via the Apify Booking Scraper - https://apify.com/voyager/booking-scraper
// Note: the actor drives a browser on Apify's servers - check this against the "no browser automation" rule.
const settings = require("./settings");
const { runApifyActor, normalizeHotel, countryName, perNight, collectPages, runIfMain } = require("./hotel-utils");

const ACTOR = "voyager~booking-scraper";

// One Booking.com result -> the common hotel shape. Booking.com shows the price for the whole stay when dates are set.
function normalize(item) {
    return normalizeHotel({
        name: item.name,
        nightlyPrice: perNight(item.price),
        totalPrice: item.price,
        currency: item.currency || settings.currency,
        rating: item.rating != null ? item.rating / 2 : null,   // out of 10 -> out of 5
        reviews: item.reviews,
        address: item.address?.full,
        url: item.url
    });
}

async function search() {
    const input = {
        // Region and country in the text, so "Hamilton" is not the one in New Zealand or Ohio
        search: [settings.city, settings.region, settings.countryCode && countryName(settings.countryCode)].filter(Boolean).join(", "),
        checkIn: settings.checkIn,
        checkOut: settings.checkOut,
        adults: settings.adults,
        rooms: 1,
        currency: settings.currency,
        language: "en-gb",
        sortBy: "price",
        // The actor pages through Booking.com itself; ask for extra to cover hotels without prices
        maxItems: settings.targetCount * 2
    };
    if (settings.maxNightlyPrice != null) {
        input.minMaxPrice = `0-${settings.maxNightlyPrice}`;
    }
    if (settings.minRating != null) {
        input.minScore = String(settings.minRating * 2);
    }

    return collectPages("Apify Booking", async () => {
        const items = await runApifyActor(ACTOR, input);
        return { hotels: items.map(normalize), next: null };
    });
}

module.exports = { search, normalize };
runIfMain(module, "Apify Booking", search);
