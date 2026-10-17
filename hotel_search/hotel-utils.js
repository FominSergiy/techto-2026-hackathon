// Helpers shared by the hotel source scripts.
// Every source returns hotels shaped as:
// { name, nightlyPrice, totalPrice, currency, rating (out of 5), reviews, address, url,
//   city (optional), location (optional { latitude, longitude }) }
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const settings = require("./settings");

// Collects the JSON bodies getJson receives inside withRawCapture. Sources run in parallel, so each gets its own scope.
const rawCapture = new AsyncLocalStorage();

// Runs fn and saves every raw JSON response it received (retries and error bodies included, unchanged) as
// <outputDir>/raw/<folder>/<timestamp>-<city>.json: an array with one entry per response.
// Nothing is written when there were no responses or outputDir is null, and a failed save never fails the search.
async function withRawCapture(folder, fn) {
    const responses = [];
    try {
        return await rawCapture.run(responses, fn);
    } finally {
        if (responses.length && settings.outputDir) {
            try {
                const dir = path.join(settings.outputDir, "raw", folder);
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");   // 2026-10-17T13-05-22-123Z
                const city = settings.city ? `-${settings.city.toLowerCase().replace(/\W+/g, "-")}` : "";
                const file = path.join(dir, `${stamp}${city}.json`);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(file, JSON.stringify(responses, null, 2));
                console.log(`Saved ${responses.length} raw ${folder} response${responses.length === 1 ? "" : "s"} to ${file}`);
            } catch (error) {
                console.warn(`Could not save raw ${folder} responses: ${error.message}`);
            }
        }
    }
}

// Reads API keys from .env (real environment variables take precedence)
function requireEnv(...names) {
    try {
        process.loadEnvFile();
    } catch {
        // No .env file - rely on the environment
    }

    const missing = names.filter(name => !process.env[name]);
    if (missing.length) {
        throw new Error(`Missing ${missing.join(", ")} - add it to .env (see .env.example)`);
    }
    return names.map(name => process.env[name]);
}

// Fetches JSON, throwing on HTTP or API errors after `retries` extra attempts
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// `retries` = extra attempts after a failure. A server error (5xx) or rate limit (429) waits 0.5s, 1s, 2s, ...
// first, since it is usually a short blip that instant retries land inside; other errors retry straight away.
async function getJson(url, options = {}, retries = 0, attempt = 0) {
    const response = await fetch(url, options);
    let isJson = true;
    const data = await response.json().catch(() => {
        isJson = false;
        return {};
    });
    if (isJson) rawCapture.getStore()?.push(data);

    if (!response.ok || data.error) {
        if (retries > 0) {
            // Some APIs (Xotelo) answer HTTP 200 and put the real status in the body: { error: { status_code: 500 } }
            const status = response.ok ? data.error?.status_code ?? 0 : response.status;
            if (status >= 500 || status === 429) {
                await sleep(500 * 2 ** attempt);
            }
            return getJson(url, options, retries - 1, attempt + 1);
        }
        const message = data.error?.message || data.error || data.message || response.status;
        throw new Error(`${new URL(url).hostname}: ${message}`);
    }
    return data;
}

// "CA" -> "Canada". Spelled out because a bare "CA" in a free-text query can read as California.
function countryName(code) {
    try {
        return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase());
    } catch {
        return code;
    }
}

// Runs an Apify actor and returns its dataset items. The call waits for the run to finish (Apify cuts it off after 5 minutes).
async function runApifyActor(actor, input) {
    const [token] = requireEnv("APIFY_KEY");
    console.log(`Running Apify actor ${actor} (this can take a few minutes)...`);
    return getJson(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
    });
}

// Hotelbeds auth: X-Signature = SHA256(apiKey + secret + unix timestamp in seconds)
function hotelbedsHeaders(apiKey, secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    return {
        "Api-key": apiKey,
        "X-Signature": crypto.createHash("sha256").update(`${apiKey}${secret}${timestamp}`).digest("hex"),
        "Accept": "application/json",
        "Content-Type": "application/json"
    };
}

// Converts a whole-stay price to a nightly one
function perNight(total) {
    return total != null ? Math.round(total / settings.nights) : null;
}

function passesFilters(hotel) {
    if (!hotel.name || hotel.nightlyPrice == null) {
        return false;
    }
    if (settings.maxNightlyPrice != null && hotel.nightlyPrice > settings.maxNightlyPrice) {
        return false;
    }
    if (settings.minRating != null && (hotel.rating ?? 0) < settings.minRating) {
        return false;
    }
    if (settings.minReviews != null && (hotel.reviews ?? 0) < settings.minReviews) {
        return false;
    }
    return true;
}

// Lowercase, accent-free, punctuation-free name, so "Hôtel X" and "Hotel X" count as one hotel
function normalizeName(name) {
    return (name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

// Dedupes by name and keeps the cheapest targetCount hotels
function cheapest(hotels) {
    const byName = new Map();
    for (const hotel of hotels) {
        const key = normalizeName(hotel.name);
        if (!byName.has(key) || hotel.nightlyPrice < byName.get(key).nightlyPrice) {
            byName.set(key, hotel);
        }
    }
    return [...byName.values()]
        .sort((a, b) => a.nightlyPrice - b.nightlyPrice)
        .slice(0, settings.targetCount);
}

// Calls fetchPage(cursor) until enough hotels pass the filters or the pages run out.
// fetchPage returns { hotels, next }, where next is the following page's cursor or null.
async function collectPages(label, fetchPage) {
    const matches = [];
    let cursor = null;

    for (let page = 1; page <= settings.maxPages; page++) {
        let result;
        try {
            result = await fetchPage(cursor);
        } catch (error) {
            // Running off the end of the results is often reported as an error - keep what we already have
            if (page === 1) throw error;
            console.warn(`${label} page ${page} failed (${error.message}) - using the ${matches.length} matches so far`);
            break;
        }

        const { hotels, next } = result;
        matches.push(...hotels.filter(passesFilters));
        console.log(`${label} page ${page}: ${hotels.length} hotels, ${matches.length} match filters`);

        if (matches.length >= settings.targetCount || next == null) {
            break;
        }
        cursor = next;
    }
    return cheapest(matches);
}

function printHotels(label, hotels) {
    console.table(hotels);
    console.log(`${label}: found ${hotels.length} hotels`);
}

// Lets a source script run on its own, e.g. node xotelo.js --city=Paris
function runIfMain(mod, label, search) {
    if (require.main !== mod) return;

    withRawCapture(path.basename(mod.filename, ".js"), search)
        .then(hotels => printHotels(label, hotels))
        .catch(error => {
            console.error("Error:", error.message);
            process.exit(1);
        });
}

module.exports = { sleep, requireEnv, getJson, withRawCapture, countryName, runApifyActor, hotelbedsHeaders, normalizeName, perNight, passesFilters, cheapest, collectPages, printHotels, runIfMain };
