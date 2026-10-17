// Expedia hotel prices, read from the real search page with Playwright (no API key).
//
//   HEADLESS=false node expedia.js                          a visible window - needed when Expedia shows its bot check
//   HEADLESS=false node expedia.js --dump-html=expedia-dump.html   also save the page HTML (for fixing selectors)
//
// Expedia shows a "Bot or Not?" challenge to automated browsers. This script does not try to get around
// it: headless it stops with a clear error, headed it waits for you to solve the challenge in the window.
// The browser profile is kept in .browser-profile/ (git-ignored), so a challenge you solved is remembered.
//
// NOTE: every selector and pattern below is UNVERIFIED against the live site. If a field comes back empty,
// run once with HEADLESS=false --dump-html=... and fix the constants in the two blocks below.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const settings = require("./settings");
const { passesFilters, cheapest, collectPages, runIfMain } = require("./hotel-utils");

// ---------------------------------------------------------------------------------------------
// Everything that depends on Expedia's markup lives in these two blocks
// ---------------------------------------------------------------------------------------------

// CSS selectors, used inside the browser. Each list is tried in order, first hit wins.
const SELECTORS = {
    card: "[data-stid='lodging-card-responsive']",
    name: ["[data-stid='content-hotel-title']", "h3", "h2"],
    link: ["a[data-stid='open-hotel-information']", "a[href*='Hotel-Information']", "a[href]"],
    // Everything that may carry screen-reader text such as "$123 per night" or "8.6 out of 10"
    hints: "[aria-label], .is-visually-hidden, .sr-only, [class*='visually-hidden']"
};

// Text patterns, applied to a card's visible text plus its hint texts.
// MONEY captures (1) the currency marker and (2) the number, e.g. "CA$" + "1,234".
const MONEY = String.raw`(CA\$|C\$|US\$|AU\$|A\$|NZ\$|\$|€|£|¥|CAD |USD |EUR |GBP )\s?(\d[\d.,  ]*\d|\d)`;
const PER_NIGHT = String.raw`(?:[Pp]er [Nn]ight|[Nn]ightly|/ ?night|[Aa] night)`;
const PATTERNS = {
    nightly: new RegExp(`${MONEY}\\s*${PER_NIGHT}`),
    totalAfter: new RegExp(`${MONEY}\\s*(?:[Tt]otal|[Pp]er stay|for \\d+ nights?)`),
    totalBefore: new RegExp(`[Tt]otal(?: price)?(?: with taxes(?: and|\\s*&) fees)?:?\\s*${MONEY}`),
    anyMoney: new RegExp(MONEY),
    // "8.6 out of 10", "8.6/10", or "8.6 Very Good" (Expedia scores are out of 10)
    ratingOutOf: /(\d{1,2}(?:\.\d)?)\s*(?:\/|out of)\s*10\b/i,
    ratingWord: /(?:^|\n)\s*(\d{1,2}(?:\.\d)?)\s+(?:Exceptional|Wonderful|Excellent|Superb|Fabulous|Very Good|Good|Fair|Okay|Poor)\b/,
    reviews: /(\d[\d,]*)\s+reviews?\b/i,
    soldOut: /sold out|no availability|not available for your dates|no rooms? available/i,
    showMore: /show more/i,
    botCheck: /bot or not|confirm you are human|verify you are (?:a )?human|unusual traffic/i
};

const CURRENCY_BY_MARKER = {
    "CA$": "CAD", "C$": "CAD", "CAD": "CAD", "US$": "USD", "USD": "USD", "AU$": "AUD", "A$": "AUD", "NZ$": "NZD",
    "€": "EUR", "EUR": "EUR", "£": "GBP", "GBP": "GBP", "¥": "JPY"
};
const DOLLAR_CURRENCIES = ["USD", "CAD", "AUD", "NZD", "MXN", "SGD", "HKD"];  // what a bare "$" can mean

// ---------------------------------------------------------------------------------------------

const BASE_URL = process.env.EXPEDIA_BASE_URL || "https://www.expedia.com";
const PROFILE_DIR = process.env.EXPEDIA_PROFILE_DIR || path.join(__dirname, ".browser-profile", "expedia");
const PAGE_TIMEOUT_MS = 60000;
const FIRST_CARDS_WAIT_MS = 60000;    // how long to wait for result cards when nothing blocks the page
const CHALLENGE_WAIT_MS = 180000;     // how long a human gets to solve the bot check (headed only)
const SHOW_MORE_WAIT_MS = 30000;

const countryName = code => new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code;

// "Aurora, Ontario, Canada". Only the parameters Expedia is known to read are set; the currency and
// sort values are best guesses and Expedia may ignore them (a currency mismatch is warned about).
function buildSearchUrl() {
    const destination = [settings.city, settings.region, countryName(settings.countryCode)].filter(Boolean).join(", ");
    const params = new URLSearchParams({
        destination,
        startDate: settings.checkIn,
        endDate: settings.checkOut,
        adults: String(settings.adults),
        rooms: "1",
        sort: "PRICE_LOW_TO_HIGH",
        currency: settings.currency,
        langid: "1033"
    });
    return `${BASE_URL}/Hotel-Search?${params}`;
}

// "1,234" -> 1234, "1.234,50" -> 1234.5, "1,5" -> 1.5, "1,234.56" -> 1234.56
function parseAmount(text) {
    const digits = text.replace(/[\u00a0\u202f\s]/g, "");
    const commaIsDecimal = digits.lastIndexOf(",") > digits.lastIndexOf(".") && /,\d{1,2}$/.test(digits);
    const normalized = commaIsDecimal ? digits.replace(/\./g, "").replace(",", ".") : digits.replace(/,/g, "");
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

// Runs inside the browser: pulls the raw text, name, link and hint texts out of each card.
// Self-contained on purpose (Playwright serializes it), selectors come in as the second argument.
function collectRawCards(cards, selectors) {
    return cards.map(card => {
        const firstWithText = list => list.map(selector => card.querySelector(selector)).find(el => el && el.innerText.trim());
        const link = selectors.link.map(selector => card.querySelector(selector)).find(Boolean);
        return {
            text: card.innerText || "",
            name: firstWithText(selectors.name)?.innerText.trim() || null,
            href: link ? link.href : null,
            hints: [...card.querySelectorAll(selectors.hints)]
                .map(el => el.getAttribute("aria-label") || el.textContent.trim())
                .filter(Boolean)
        };
    });
}

const extractRawCards = page => page.$$eval(SELECTORS.card, collectRawCards, SELECTORS);

// Turns one raw card into a hotel. Pure (no browser), so it can be tested on plain strings.
// Returns { hotel, soldOut, currencyMarker }.
function parseCardText(raw, { nights = settings.nights, currency = settings.currency } = {}) {
    const text = [raw.text, ...raw.hints].join("\n");
    const money = pattern => {
        const match = text.match(pattern);
        return match ? { marker: match[1].trim(), amount: parseAmount(match[2]) } : null;
    };

    const nightly = money(PATTERNS.nightly);
    const total = money(PATTERNS.totalAfter) || money(PATTERNS.totalBefore);
    const soldOut = PATTERNS.soldOut.test(text) && !nightly && !total;
    // A single unlabeled amount: Expedia's headline price is per night, so assume that
    const unlabeled = !nightly && !total && !soldOut ? money(PATTERNS.anyMoney) : null;

    let nightlyPrice = (nightly || unlabeled)?.amount ?? null;
    let totalPrice = total?.amount ?? null;
    if (nightlyPrice == null && totalPrice != null) nightlyPrice = Math.round(totalPrice / nights);
    if (totalPrice == null && nightlyPrice != null) totalPrice = Math.round(nightlyPrice * nights);

    const marker = (nightly || total || unlabeled)?.marker || null;
    const rated = (text.match(PATTERNS.ratingOutOf) || text.match(PATTERNS.ratingWord))?.[1];
    const score = rated != null && Number(rated) <= 10 ? Number(rated) : null;
    const reviews = text.match(PATTERNS.reviews)?.[1];

    return {
        soldOut,
        currencyMarker: marker,
        hotel: {
            name: raw.name,
            nightlyPrice,
            totalPrice,
            currency: currencyFromMarker(marker, currency),
            rating: score != null ? Math.round(score * 50) / 100 : null,  // out of 10 -> out of 5
            reviews: reviews != null ? parseAmount(reviews) : null,
            address: null,  // cards show a neighbourhood, not a street address - Google Places supplies it
            url: raw.href ? raw.href.split("?")[0] : null
        }
    };
}

function currencyFromMarker(marker, fallback) {
    if (!marker) return fallback;
    if (marker === "$") return DOLLAR_CURRENCIES.includes(fallback) ? fallback : "USD";
    return CURRENCY_BY_MARKER[marker] || fallback;
}

// ---- browser handling ----

async function onBotCheck(page) {
    if (PATTERNS.botCheck.test(await page.title().catch(() => ""))) return true;
    const body = await page.evaluate(() => document.body?.innerText.slice(0, 2000) || "").catch(() => "");
    return PATTERNS.botCheck.test(body);
}

// Waits until result cards exist. A bot check stops a headless run; a headed run waits for the human.
async function waitForCards(page, url, firstStatus, headless) {
    const started = Date.now();
    let deadline = started + FIRST_CARDS_WAIT_MS;
    let blocked = firstStatus === 429 || await onBotCheck(page);
    let announcedAt = null;
    let clearedAt = null;
    let reloaded = false;

    for (;;) {
        if (await page.locator(SELECTORS.card).count()) return;

        if (blocked) {
            if (headless) {
                throw new Error("Expedia blocked the headless browser with its 'Bot or Not?' check. Run with HEADLESS=false "
                    + "(HEADLESS=false node expedia.js, or HEADLESS=false node server.js) and solve the check in the browser window; "
                    + `it is remembered in ${path.relative(__dirname, PROFILE_DIR)}/.`);
            }
            if (announcedAt == null) {
                announcedAt = Date.now();
                deadline = Math.max(deadline, announcedAt + CHALLENGE_WAIT_MS);
                console.log(`Expedia is showing its bot check - solve it in the browser window (waiting up to ${CHALLENGE_WAIT_MS / 60000} minutes)...`);
            }
            clearedAt = null;
        } else if (announcedAt != null) {
            // Solved, but no results yet: give the page a few seconds, then load the search again once
            clearedAt ??= Date.now();
            if (!reloaded && Date.now() - clearedAt > 10000) {
                reloaded = true;
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
            }
        }

        if (Date.now() > deadline) {
            throw new Error(blocked
                ? "Timed out waiting for the Expedia bot check to be solved"
                : `No hotel cards appeared (looked for ${SELECTORS.card}). Run with HEADLESS=false --dump-html=expedia-dump.html and check SELECTORS in expedia.js`);
        }
        await page.waitForTimeout(1000);
        blocked = await onBotCheck(page);
    }
}

// Cards are lazy-loaded as they scroll into view
async function scrollThrough(page) {
    for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(400);
    }
}

function dumpTarget() {
    const flag = process.argv.find(arg => arg.startsWith("--dump-html="));
    return flag ? flag.slice("--dump-html=".length) : process.env.EXPEDIA_DUMP_HTML || null;
}

async function dumpHtml(page, file) {
    try {
        fs.writeFileSync(file, await page.content());
        console.log(`Expedia page HTML saved to ${file}`);
    } catch (error) {
        console.warn(`Could not save the page HTML: ${error.message}`);
    }
}

function launchProfile(headless) {
    return chromium.launchPersistentContext(PROFILE_DIR, { headless, locale: "en-US" }).catch(error => {
        throw new Error(`Could not open the Expedia browser (${error.message.split("\n")[0]}). `
            + "If another run is using the profile, wait for it to finish.");
    });
}

// Tallies what could not be parsed so a broken selector is loud instead of silently returning nulls
function newTally() {
    return { cards: 0, soldOut: 0, markers: new Map(), missing: { name: 0, price: 0, rating: 0, reviews: 0, url: 0 } };
}

function tally(counts, parsed) {
    counts.cards++;
    if (parsed.soldOut) {
        counts.soldOut++;
        return;
    }
    const { hotel } = parsed;
    if (parsed.currencyMarker) counts.markers.set(hotel.currency, (counts.markers.get(hotel.currency) || 0) + 1);
    if (!hotel.name) counts.missing.name++;
    if (hotel.nightlyPrice == null) counts.missing.price++;
    if (hotel.rating == null) counts.missing.rating++;
    if (hotel.reviews == null) counts.missing.reviews++;
    if (!hotel.url) counts.missing.url++;
}

function warnAboutParsing(counts) {
    const available = counts.cards - counts.soldOut;
    console.log(`Expedia: ${counts.cards} cards read, ${counts.soldOut} sold out`);

    const failed = Object.entries(counts.missing).filter(([, n]) => n > 0).map(([field, n]) => `${field} on ${n}`);
    if (failed.length) {
        console.warn(`WARNING: Expedia fields not found (of ${available} available cards): ${failed.join(", ")}. `
            + "Rating/reviews can be genuinely missing for new hotels, but name, price or url usually means a selector is stale: "
            + "run with HEADLESS=false --dump-html=expedia-dump.html and send the file.");
    }

    const other = [...counts.markers.keys()].filter(code => code !== settings.currency);
    if (other.length) {
        console.warn(`WARNING: Expedia showed prices in ${other.join(", ")} but the search asks for ${settings.currency}. `
            + "Prices are NOT converted, so the price filter compares different currencies.");
    }
}

async function search() {
    const headless = process.env.HEADLESS !== "false";
    const url = buildSearchUrl();
    const dumpFile = dumpTarget();
    const counts = newTally();
    let seen = 0;
    let context;
    let page;
    let hotels;

    try {
        context = await launchProfile(headless);
        page = context.pages()[0] || await context.newPage();

        // Page 1 is the search itself; later pages click "Show more", which appends cards
        hotels = await collectPages("Expedia", async cursor => {
            if (cursor == null) {
                console.log(`Opening ${url} (${headless ? "headless" : "visible window"})`);
                const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
                await waitForCards(page, url, response?.status(), headless);
            } else {
                const before = await page.locator(SELECTORS.card).count();
                const button = page.getByRole("button", { name: PATTERNS.showMore }).first();
                await button.scrollIntoViewIfNeeded();
                await button.click();
                await page.waitForFunction(
                    ({ selector, count }) => document.querySelectorAll(selector).length > count,
                    { selector: SELECTORS.card, count: before },
                    { timeout: SHOW_MORE_WAIT_MS }
                );
            }

            await scrollThrough(page);
            const parsed = (await extractRawCards(page)).map(raw => parseCardText(raw));
            const fresh = parsed.slice(seen);
            seen = parsed.length;
            fresh.forEach(card => tally(counts, card));

            const more = await page.getByRole("button", { name: PATTERNS.showMore }).count();
            return { hotels: fresh.map(card => card.hotel), next: more ? true : null };
        });
    } finally {
        // Always save the HTML and close the browser, including when the run failed
        if (page && dumpFile) await dumpHtml(page, dumpFile);
        if (context) await context.close().catch(() => {});
    }

    warnAboutParsing(counts);
    return hotels;
}

module.exports = { search, parseCardText, extractRawCards, buildSearchUrl, parseAmount, SELECTORS, PATTERNS };

runIfMain(module, "Expedia", search);
