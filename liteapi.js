// Bookable rates via LiteAPI (Nuitee) - https://docs.liteapi.travel/reference/post_hotels-rates
const settings = require("./settings");
const { requireEnv, getJson, perNight, collectPages, runIfMain } = require("./hotel-utils");

const PAGE_SIZE = 50;

async function search() {
    const [apiKey] = requireEnv("LITE_API_KEY");

    return collectPages("LiteAPI", async cursor => {
        const offset = cursor ?? 0;
        const body = {
            countryCode: settings.countryCode,
            cityName: settings.city,
            checkin: settings.checkIn,
            checkout: settings.checkOut,
            currency: settings.currency,
            guestNationality: settings.countryCode,
            occupancies: [{ adults: settings.adults }],
            maxRatesPerHotel: 1,
            sort: [{ field: "price", direction: "ascending" }],
            limit: PAGE_SIZE,
            offset,
            timeout: 10
        };
        if (settings.minRating != null) {
            body.minRating = settings.minRating * 2;
        }
        if (settings.minReviews != null) {
            body.minReviewsCount = settings.minReviews;
        }

        const data = await getJson("https://api.liteapi.travel/v3.0/hotels/rates", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
            body: JSON.stringify(body)
        });

        // Rates are in data[], hotel details in hotels[] - joined by id. Prices cover the whole stay.
        const details = new Map((data.hotels || []).map(hotel => [hotel.id, hotel]));
        const results = data.data || [];
        return {
            hotels: results.map(result => {
                const hotel = details.get(result.hotelId) || {};
                const total = Math.min(...(result.roomTypes || []).map(room => room.offerRetailRate?.amount ?? Infinity));
                const hasPrice = Number.isFinite(total);

                return {
                    name: hotel.name || null,
                    nightlyPrice: hasPrice ? perNight(total) : null,
                    totalPrice: hasPrice ? total : null,
                    currency: settings.currency,
                    rating: hotel.rating != null ? hotel.rating / 2 : null,
                    reviews: hotel.review_count ?? null,
                    address: hotel.address || null,
                    url: null
                };
            }),
            next: results.length === PAGE_SIZE ? offset + PAGE_SIZE : null
        };
    });
}

module.exports = { search };
runIfMain(module, "LiteAPI", search);
