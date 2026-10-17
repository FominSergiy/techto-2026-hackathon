// Merges the Google Maps hotels (phone, address, rating, an expected price when ranked) with the Backboard web-search
// hotels (a found price, sometimes a phone) into one list of rows, cheapest first. Used by the reservation page.
const { cleanName, sameHotel } = require("./places");

const MIN_NAME_OVERLAP = 0.75;   // share of the shorter name's words found in the other (see places.js)

const TOLL_FREE = new Set(["800", "833", "844", "855", "866", "877", "888"]);

// The number's last 10 digits, or "" when it says nothing about which property it is: missing, or a toll-free line
// (chains give their central booking number, e.g. 1-800-454-3213 for every Super 8)
function lastDigits(phone) {
    const digits = String(phone || "").replace(/\D/g, "").slice(-10);
    return TOLL_FREE.has(digits.slice(0, 3)) ? "" : digits;
}

// Two different local phone numbers mean two different hotels, however alike the names ("Holiday Inn" vs "Holiday Inn
// Express"). A missing or toll-free number says nothing, so it doesn't block a match.
const phonesAgree = (a, b) => !lastDigits(a) || !lastDigits(b) || lastDigits(a) === lastDigits(b);

function toRow(maps, found) {
    // A price Backboard found on a page beats the model's estimate from the name; the estimate is only a fallback
    const hasFound = found?.nightlyPrice != null;
    const hasEstimate = maps?.expectedPrice != null;
    return {
        name: maps?.name || found?.name,
        phone: maps?.phone || found?.phone || null,
        address: maps?.address || found?.address || null,
        price: hasFound ? found.nightlyPrice : hasEstimate ? maps.expectedPrice : null,
        // quoted: the rate for the dates, from: a page's lowest rate, estimated: the model's guess from the name
        priceKind: hasFound ? (found.priceType === "quoted" ? "quoted" : "from") : hasEstimate ? "estimated" : null,
        currency: (hasFound ? found.currency : maps?.currency) || "CAD",
        rating: maps?.rating ?? found?.rating ?? null,
        url: maps?.url || maps?.mapsUrl || found?.url || null,
        sources: [maps && "maps", found && "backboard"].filter(Boolean)
    };
}

// Every Maps hotel becomes a row, with the Backboard hotel that is the same place merged in; Backboard hotels that
// Maps did not find follow as rows of their own. Sorted by price, cheapest first, hotels with no price last.
function combine(mapsHotels = [], backboardHotels = []) {
    const free = new Set(backboardHotels);
    const rows = mapsHotels.map(maps => {
        const found = [...free].find(candidate => sameHotel(cleanName(maps.name), cleanName(candidate.name), MIN_NAME_OVERLAP) && phonesAgree(maps.phone, candidate.phone));
        free.delete(found);
        return toRow(maps, found);
    });
    rows.push(...[...free].map(found => toRow(null, found)));

    return rows
        .filter(row => row.name)
        .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || (b.rating ?? 0) - (a.rating ?? 0));
}

module.exports = { combine, phonesAgree };
