// Prints merged hotels as a table and saves them as CSV and JSON.
const fs = require("node:fs");
const path = require("node:path");
const settings = require("./settings");

const TABLE_URL_WIDTH = 60;

// One flat record per hotel - the single output format used by the table, CSV and JSON
function toRecord(hotel) {
    return {
        name: hotel.name,
        city: hotel.city,
        address: hotel.address || null,
        phone: hotel.phone || null,
        nightlyPrice: hotel.nightlyPrice,
        totalPrice: hotel.totalPrice,
        currency: hotel.currency,
        source: hotel.source,
        url: hotel.url || hotel.mapsUrl || hotel.website || null,
        website: hotel.website || null,
        rating: hotel.rating,
        reviews: hotel.reviews,
        otherOffers: (hotel.offers || []).slice(1).map(offer => `${offer.source}: ${offer.nightlyPrice}`).join("; ")
    };
}

function truncate(text, width) {
    return text && text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

function printReport(hotels) {
    console.table(hotels.map(toRecord).map(record => ({
        name: record.name,
        city: record.city,
        address: record.address,
        phone: record.phone,
        price: `${record.nightlyPrice} ${record.currency}/night`,
        source: record.source,
        url: truncate(record.url, TABLE_URL_WIDTH)
    })));
    console.log(`Found ${hotels.length} hotels in ${settings.city}, ${settings.checkIn} to ${settings.checkOut}`);
}

function csvCell(value) {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Writes <outputDir>/hotels-<city>-<checkIn>.csv and .json, returns the paths
function writeReport(hotels) {
    if (!settings.outputDir) return [];
    if (!hotels.length) {
        // An empty or failed run must not overwrite the last good results
        console.log("No hotels found - not overwriting saved results");
        return [];
    }

    const records = hotels.map(toRecord);
    const base = path.join(settings.outputDir, `hotels-${settings.city.toLowerCase().replace(/\W+/g, "-")}-${settings.checkIn}`);
    fs.mkdirSync(settings.outputDir, { recursive: true });

    const columns = Object.keys(records[0] || toRecord({}));
    const csv = [columns, ...records.map(record => columns.map(column => record[column]))]
        .map(row => row.map(csvCell).join(","))
        .join("\n");
    fs.writeFileSync(`${base}.csv`, csv + "\n");
    fs.writeFileSync(`${base}.json`, JSON.stringify(records, null, 2) + "\n");

    console.log(`Saved ${base}.csv and ${base}.json`);
    return [`${base}.csv`, `${base}.json`];
}

module.exports = { toRecord, printReport, writeReport };
