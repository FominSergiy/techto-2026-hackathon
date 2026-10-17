// Booking.com prices via the Apify Booking Scraper - https://apify.com/voyager/booking-scraper
// Note: the actor drives a browser on Apify's servers - check this against the "no browser automation" rule.
const settings = require("./settings");
const { runApifyActor, perNight, collectPages, runIfMain } = require("./hotel-utils");

const ACTOR = "voyager~booking-scraper";

async function search() {
    const input = {
        search: settings.city,
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

        // Booking.com shows the price for the whole stay when dates are set
        return {
            hotels: items.map(item => ({
                name: item.name,
                nightlyPrice: perNight(item.price),
                totalPrice: item.price ?? null,
                currency: item.currency || settings.currency,
                rating: item.rating != null ? item.rating / 2 : null,
                reviews: item.reviews ?? null,
                address: item.address?.full || null,
                url: item.url || null
            })),
            next: null
        };
    });
}

module.exports = { search };
runIfMain(module, "Apify Booking", search);
