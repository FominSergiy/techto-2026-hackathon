// Expedia hotel prices through ScrapingBee (https://www.scrapingbee.com): their servers render the real search
// page behind rotating proxies and return each result card's HTML. The cards are then parsed by expedia.js.
//
//   node hotel_search/scrapingbee.js
//
// Needs SCRAPING_BEE_API_KEY in .env. Every request spends ScrapingBee credits (JS rendering + premium proxy
// is the expensive combination), and this makes one request per search. It reads only the first page of results.
//
// NOTE: like expedia.js, the card selector and the search URL parameters are UNVERIFIED against the live site.
const settings = require("./settings");
const { SELECTORS, buildSearchUrl, parseCardText } = require("./expedia");
const { requireEnv, getJson, collectPages, runIfMain } = require("./hotel-utils");

const API_URL = "https://app.scrapingbee.com/api/v1/";

// Asks ScrapingBee to cut every card out of the page and hand back its inner HTML
const EXTRACT_RULES = { cards: { selector: SELECTORS.card, type: "list", output: "html" } };

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
    return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (whole, hex, dec, name) => {
        if (hex || dec) return String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec));
        return ENTITIES[name.toLowerCase()] ?? whole;
    });
}

// Visible text: every tag boundary becomes a line break, so "$149" and "nightly" in separate elements stay apart
function htmlToText(html) {
    return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "\n"))
        .split("\n").map(line => line.trim()).filter(Boolean).join("\n");
}

const attributes = (html, name) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "gi"))].map(match => decodeEntities(match[1]));

// Same shape as expedia.js's browser-side extraction: { text, name, href, hints }
function cardFromHtml(html) {
    const title = html.match(/data-stid="content-hotel-title"[^>]*>([\s\S]*?)<\/(?:h\d|div|span)>/i) || html.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i);
    const link = html.match(/<a\b[^>]*data-stid="open-hotel-information"[^>]*>/i)
        || html.match(/<a\b[^>]*href="[^"]*Hotel-Information[^"]*"[^>]*>/i)
        || html.match(/<a\b[^>]*href="[^"]*"[^>]*>/i);
    const href = link ? attributes(link[0], "href")[0] : null;
    return {
        text: htmlToText(html),
        name: title ? htmlToText(title[1]) || null : null,
        href: href ? new URL(href, "https://www.expedia.com").href : null,
        hints: attributes(html, "aria-label")
    };
}

async function search() {
    const [apiKey] = requireEnv("SCRAPING_BEE_API_KEY");
    const url = buildSearchUrl();

    const params = new URLSearchParams({
        api_key: apiKey,
        url,
        render_js: "true",
        premium_proxy: "true",                  // Expedia blocks datacenter IPs
        country_code: settings.countryCode.toLowerCase(),
        wait_for: SELECTORS.card,
        extract_rules: JSON.stringify(EXTRACT_RULES)
    });

    return collectPages("ScrapingBee", async () => {
        console.log(`Asking ScrapingBee to render ${url} (can take up to a minute, spends credits)...`);
        const data = await getJson(`${API_URL}?${params}`, {}, 1);

        const cards = (data.cards || []).map(html => parseCardText(cardFromHtml(html)));
        if (!cards.length) {
            throw new Error(`ScrapingBee returned no cards (looked for ${SELECTORS.card}) - the page may have shown a bot check or the selector is stale`);
        }
        const soldOut = cards.filter(card => card.soldOut).length;
        console.log(`ScrapingBee: ${cards.length} cards read, ${soldOut} sold out`);

        const other = new Set(cards.filter(card => card.currencyMarker).map(card => card.hotel.currency));
        other.delete(settings.currency);
        if (other.size) {
            console.warn(`WARNING: ScrapingBee prices came back in ${[...other].join(", ")} but the search asks for ${settings.currency}. Prices are NOT converted.`);
        }

        return { hotels: cards.filter(card => !card.soldOut).map(card => card.hotel), next: null };
    });
}

module.exports = { search, cardFromHtml, htmlToText };
runIfMain(module, "ScrapingBee", search);
