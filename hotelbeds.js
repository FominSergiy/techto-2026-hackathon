// Wholesale rates via Hotelbeds APItude (evaluation keys: 50 requests/day on the test host)
// https://developer.hotelbeds.com/documentation/hotels/booking-api/
const settings = require("./settings");
const { requireEnv, getJson, hotelbedsHeaders, perNight, collectPages, runIfMain } = require("./hotel-utils");
const { hotelbedsDestinationCode } = require("./locations");

async function search() {
    const [apiKey, secret] = requireEnv("HOTELBEDS_API_KEY", "HOTELBEDS_SECRET");

    const body = {
        stay: { checkIn: settings.checkIn, checkOut: settings.checkOut },
        occupancies: [{ rooms: 1, adults: settings.adults, children: 0 }],
        destination: { code: await hotelbedsDestinationCode() },
        filter: { maxHotels: 250 }
    };
    if (settings.minRating != null || settings.minReviews != null) {
        body.reviews = [{
            type: "TRIPADVISOR",
            minRate: settings.minRating ?? 0,
            minReviewCount: settings.minReviews ?? 0
        }];
    }

    // Availability isn't paginated - one call returns up to maxHotels
    return collectPages("Hotelbeds", async () => {
        const data = await getJson("https://api.test.hotelbeds.com/hotel-api/1.0/hotels", {
            method: "POST",
            headers: hotelbedsHeaders(apiKey, secret),
            body: JSON.stringify(body)
        });

        // minRate is the cheapest price for the whole stay
        return {
            hotels: (data.hotels?.hotels || []).map(hotel => {
                const review = (hotel.reviews || []).find(r => r.type === "TRIPADVISOR");
                const total = hotel.minRate != null ? Number(hotel.minRate) : null;

                return {
                    name: hotel.name,
                    nightlyPrice: perNight(total),
                    totalPrice: total,
                    currency: hotel.currency,
                    rating: review?.rate ?? null,
                    reviews: review?.reviewCount ?? null,
                    address: [hotel.zoneName, hotel.destinationName].filter(Boolean).join(", ") || null,
                    url: null
                };
            }),
            next: null
        };
    });
}

module.exports = { search };
runIfMain(module, "Hotelbeds", search);
