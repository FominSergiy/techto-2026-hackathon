// Finds hotel pricing without browser automation:
//   1. Google Places photos -> tesseract OCR prefilter -> on-device vision model reads prices
//   2. Plain HTTP fetch of the hotel website -> on-device model extracts rates from text
// Requires: `brew install tesseract`, and Ollama running locally (`brew services start ollama`) with OLLAMA_MODEL pulled.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Minimal .env loader (KEY=value per line) so secrets stay out of git
if (fs.existsSync(".env")) {
    for (const [, key, value] of fs.readFileSync(".env", "utf8").matchAll(/^(\w+)=(.*)$/gm)) {
        process.env[key] ??= value.trim();
    }
}

const API_KEY = process.env.GOOGLE_API_KEY;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5vl:3b";

const CITY = process.argv[2] || "Toronto";
const QUERY = `budget hotels in ${CITY}`;
const MAX_HOTELS = Number(process.env.MAX_HOTELS || 5);
const MAX_PHOTOS = Number(process.env.MAX_PHOTOS || 10);   // Places returns at most 10
const MAX_PAGES = 4;                                        // homepage + likely rate pages
const MAX_TEXT_CHARS = 6000;                                // keeps local prompts fast

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    + "(KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const PRICE_PATTERN = /(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:CAD|USD|EUR|GBP|\$))/i;
const RATE_LINK_PATTERN = /room|rate|suite|book|reserv|offer|deal|price|accommodation|stay/i;

const PRICING_SCHEMA = {
    type: "object",
    properties: {
        hasPricing: { type: "boolean" },
        prices: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    label: { type: "string" },
                    amount: { type: "number" },
                    currency: { type: "string" },
                    unit: { type: "string" }
                },
                required: ["label", "amount"]
            }
        }
    },
    required: ["hasPricing", "prices"]
};

async function askModel(prompt, images) {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            format: PRICING_SCHEMA,
            options: { temperature: 0 },
            messages: [{ role: "user", content: prompt, images }]
        })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Ollama: ${data.error}`);
    }

    return {
        ...JSON.parse(data.message.content),
        tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        ms: Math.round((data.total_duration || 0) / 1e6)
    };
}

async function searchHotels(query) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
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
                "places.photos"
            ].join(",")
        },
        body: JSON.stringify({ textQuery: query, pageSize: MAX_HOTELS })
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Places: ${JSON.stringify(data.error)}`);
    }

    return data.places || [];
}

// photo.name looks like "places/<id>/photos/<ref>"; the media endpoint 302s to the image
async function downloadPhoto(photo) {
    const url = `https://places.googleapis.com/v1/${photo.name}/media`
        + `?maxWidthPx=1024&key=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Photo ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
}

// On-device OCR (~0.2s) as a prefilter so the slow VLM (~12s) only sees likely hits
function ocr(image) {
    const file = path.join(os.tmpdir(), `places-photo-${process.pid}.jpg`);
    fs.writeFileSync(file, image);
    try {
        return execFileSync("tesseract", [file, "stdout"], { stdio: ["ignore", "pipe", "ignore"] })
            .toString();
    } catch {
        return "";
    } finally {
        fs.rmSync(file, { force: true });
    }
}

async function findPricingInPhotos(place) {
    const prompt = "Does this image show any prices (rate card, price list, menu with prices, "
        + "sign with nightly rates, booking screenshot)? If yes, set hasPricing=true and list "
        + "every price you can read with its label, amount, currency and unit (e.g. per night). "
        + "If no prices are visible, set hasPricing=false and prices=[]. Do not guess.";
    const hits = [];
    let tokens = 0;

    for (const photo of (place.photos || []).slice(0, MAX_PHOTOS)) {
        try {
            const image = await downloadPhoto(photo);
            if (!PRICE_PATTERN.test(ocr(image))) {
                continue;
            }
            const result = await askModel(prompt, [image.toString("base64")]);
            tokens += result.tokens;
            if (result.hasPricing && result.prices.length) {
                hits.push({ photo: photo.name, prices: result.prices });
            }
        } catch (error) {
            console.error(`  photo failed: ${error.message}`);
        }
    }

    return { hits, tokens };
}

async function fetchPage(url) {
    const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
        throw new Error(`${response.status} ${url}`);
    }

    return { url: response.url, html: await response.text() };
}

function htmlToText(html) {
    return html
        .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|section)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#36;|&dollar;/g, "$")
        .replace(/[ \t]+/g, " ")
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);
}

// Same-site links whose URL or anchor text hints at rooms / rates
function findRateLinks(html, baseUrl) {
    const base = new URL(baseUrl);
    const links = new Set();

    for (const [, href, text] of html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        try {
            const url = new URL(href.replace(/&amp;/g, "&"), base);
            if (url.hostname === base.hostname && RATE_LINK_PATTERN.test(href + text)) {
                links.add(url.href.split("#")[0]);
            }
        } catch {
            // ignore malformed hrefs
        }
    }

    return [...links];
}

// Keep only lines near a price so the local model sees a small prompt
function priceSnippets(lines) {
    const keep = new Set();
    lines.forEach((line, i) => {
        if (PRICE_PATTERN.test(line)) {
            [i - 1, i, i + 1].forEach(j => keep.add(j));
        }
    });

    return [...keep]
        .filter(i => i >= 0 && i < lines.length)
        .sort((a, b) => a - b)
        .map(i => lines[i])
        .join("\n");
}

async function findPricingOnWebsite(place) {
    if (!place.websiteUri) {
        return { prices: [], tokens: 0, pages: [] };
    }

    const home = await fetchPage(place.websiteUri);
    const pages = [home];
    for (const url of findRateLinks(home.html, home.url).slice(0, MAX_PAGES - 1)) {
        try {
            pages.push(await fetchPage(url));
        } catch (error) {
            console.error(`  page failed: ${error.message}`);
        }
    }

    const snippets = pages
        .map(page => priceSnippets(htmlToText(page.html)))
        .filter(Boolean)
        .join("\n---\n")
        .slice(0, MAX_TEXT_CHARS);
    if (!snippets) {
        return { prices: [], tokens: 0, pages: pages.map(page => page.url) };
    }

    const prompt = `Text scraped from the website of the hotel "${place.displayName?.text}". `
        + "Extract room rates / nightly prices only (ignore parking, fees, restaurant items unless "
        + "nothing else is present). For each give label, amount, currency and unit. "
        + "If there are no room prices, set hasPricing=false.\n\n" + snippets;
    const result = await askModel(prompt);

    return { prices: result.prices, tokens: result.tokens, pages: pages.map(page => page.url) };
}

async function main() {
    if (!API_KEY) {
        throw new Error("Set GOOGLE_API_KEY");
    }

    console.log(`Searching: ${QUERY} (model: ${OLLAMA_MODEL})`);
    const places = await searchHotels(QUERY);
    const results = [];

    for (const place of places) {
        const name = place.displayName?.text;
        console.log(`\n${name} — ${place.photos?.length || 0} photos, site: ${place.websiteUri || "none"}`);
        const started = Date.now();

        const photos = await findPricingInPhotos(place);
        console.log(`  photos with prices: ${photos.hits.length}`);

        let website = { prices: [], tokens: 0, pages: [] };
        try {
            website = await findPricingOnWebsite(place);
        } catch (error) {
            console.error(`  website failed: ${error.message}`);
        }
        console.log(`  website prices: ${website.prices.length} from ${website.pages.length} pages`);

        results.push({
            name,
            address: place.formattedAddress,
            phone: place.nationalPhoneNumber || null,
            website: place.websiteUri || null,
            photoPrices: photos.hits,
            websitePrices: website.prices,
            pagesScanned: website.pages,
            localTokens: photos.tokens + website.tokens,
            seconds: Math.round((Date.now() - started) / 1000)
        });
    }

    console.table(results.map(hotel => ({
        name: hotel.name,
        photoHits: hotel.photoPrices.length,
        websitePrices: hotel.websitePrices
            .map(price => `${price.amount} ${price.currency || ""} ${price.label}`.trim())
            .join("; ")
            .slice(0, 80),
        tokens: hotel.localTokens,
        seconds: hotel.seconds
    })));

    fs.writeFileSync("pricing-results.json", JSON.stringify(results, null, 2));
    console.log("Saved pricing-results.json");
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
