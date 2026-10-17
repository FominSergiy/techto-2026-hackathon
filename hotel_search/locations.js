// Resolves the Hotelbeds destination code (Xotelo's lookup lives in xotelo.js) from settings.city, cached in .cache/locations.json.
// A value set in settings (or on the command line) always wins over the lookup.
const fs = require("node:fs");
const path = require("node:path");
const settings = require("./settings");
const { requireEnv, getJson, hotelbedsHeaders, normalizeName: normalize } = require("./hotel-utils");

const CACHE_FILE = path.join(__dirname, "..", ".cache", "locations.json");

function readCache() {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    } catch {
        return {};
    }
}

// Looks up `field` for the current city once, then serves it from the cache
async function cached(field, lookup) {
    const cityKey = [settings.city, settings.region, settings.countryCode].filter(Boolean).join("|").toLowerCase();
    const cache = readCache();
    if (cache[cityKey]?.[field]) {
        return cache[cityKey][field];
    }

    const value = await lookup();
    console.log(`Resolved ${field} for ${settings.city}: ${value}`);

    const fresh = readCache();
    fresh[cityKey] = { ...fresh[cityKey], [field]: value };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(fresh, null, 2));
    return value;
}

// Hotelbeds destination code (e.g. YTO) from the Content API's destination list for the country.
// Matches the destination name first, then the names of zones inside it (suburbs like Aurora are zones).
async function hotelbedsDestinationCode() {
    if (settings.hotelbedsDestinationCode) {
        return settings.hotelbedsDestinationCode;
    }

    return cached("hotelbedsDestinationCode", async () => {
        const [apiKey, secret] = requireEnv("HOTELBEDS_API_KEY", "HOTELBEDS_SECRET");
        const destinations = [];
        const pageSize = 1000;

        for (let from = 1; ; from += pageSize) {
            const params = new URLSearchParams({
                fields: "code,name,zones",
                countryCodes: settings.countryCode,
                language: "ENG",
                from: String(from),
                to: String(from + pageSize - 1)
            });
            const data = await getJson(
                `https://api.test.hotelbeds.com/hotel-content-api/1.0/locations/destinations?${params}`,
                { headers: hotelbedsHeaders(apiKey, secret) }
            );
            destinations.push(...(data.destinations || []));
            if (!data.destinations?.length || destinations.length >= data.total) break;
        }

        const city = normalize(settings.city);
        const zoneName = zone => normalize(zone.name?.content ?? zone.name);
        const match = destinations.find(d => normalize(d.name?.content) === city)
            || destinations.find(d => (d.zones || []).some(zone => zoneName(zone) === city))
            || destinations.find(d => normalize(d.name?.content).includes(city));

        if (!match) {
            throw new Error(`No Hotelbeds destination found for ${settings.city} - pass --hotelbeds-destination-code`);
        }
        return match.code;
    });
}

module.exports = { cached, hotelbedsDestinationCode };
