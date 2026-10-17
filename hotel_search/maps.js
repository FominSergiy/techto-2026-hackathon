// Load API keys from .env (real environment variables take precedence)
try {
    process.loadEnvFile();
} catch {
    // No .env file - rely on the environment
}

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
    console.error("Missing GOOGLE_MAPS_API_KEY - copy .env.example to .env and set it.");
    process.exit(1);
}

function formatMoney(money) {
    const amount = Number(money.units || 0) + (money.nanos || 0) / 1e9;
    return `${amount} ${money.currencyCode}`;
}

// priceRange may have no endPrice (open-ended, e.g. "$100+")
function formatPriceRange(priceRange) {
    if (!priceRange?.startPrice) {
        return "N/A";
    }

    const start = formatMoney(priceRange.startPrice);
    return priceRange.endPrice
        ? `${start} - ${formatMoney(priceRange.endPrice)}`
        : `${start}+`;
}

async function searchHotels(query) {
    const response = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": API_KEY,
                "X-Goog-FieldMask": [
                    "places.id",
                    "places.displayName",
                    "places.formattedAddress",
                    "places.nationalPhoneNumber",
                    "places.websiteUri",
                    "places.priceLevel",
                    "places.priceRange",
                    "places.rating",
                    "nextPageToken"
                ].join(",")
            },
            body: JSON.stringify({
                textQuery: query,
                pageSize: 20
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        console.error("API Error:", data);
        return;
    }

    const hotels = (data.places || []).map(hotel => ({
        name: hotel.displayName?.text,
        address: hotel.formattedAddress,
        phone: hotel.nationalPhoneNumber || "N/A",
        priceLevel: hotel.priceLevel || "N/A",
        priceRange: formatPriceRange(hotel.priceRange),
        rating: hotel.rating || "N/A",
        website: hotel.websiteUri || "N/A"
    }));

    console.table(hotels);

    console.log(`Found ${hotels.length} hotels`);
    if (data.nextPageToken) {
        console.log("More results available (pagination).");
    }
}

// Search queries
const { city } = require("./settings");

const QUERIES = [
    `hotels in ${city}`,
    `budget hotels near ${city}`,
    `luxury hotels in downtown ${city}`
];

async function main() {
    for (const query of QUERIES) {
        console.log(`\nSearching: ${query}`);

        try {
            await searchHotels(query);
        } catch (error) {
            console.error("Error:", error.message);
        }
    }
}

main();
