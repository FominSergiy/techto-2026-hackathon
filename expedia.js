// Note: Playwright is browser automation, which the competition rules ban - reference only.
const { chromium } = require("playwright");
const { city, checkIn, checkOut, adults, targetCount } = require("./settings");
const { passesFilters } = require("./hotel-utils");

const BASE_URL = "https://www.expedia.com";
const MAX_PAGES = 10;

function buildSearchUrl() {
    const params = new URLSearchParams({
        destination: city,
        startDate: checkIn,
        endDate: checkOut,
        adults: String(adults),
        sort: "RECOMMENDED"
    });
    return `${BASE_URL}/Hotel-Search?${params}`;
}

// Runs in the browser: pulls raw fields out of every result card on the page
function parseCards(cards) {
    const toNumber = value => (value ? Number(value.replace(/,/g, "")) : null);

    return cards.map(card => {
        const text = card.innerText;
        const nightly = text.match(/\$([\d,]+)\s*(?:nightly|per night)/i)
            || text.match(/\$([\d,]+)/);
        const total = text.match(/\$([\d,]+)\s*total/i);
        const rating = text.match(/(\d+(?:\.\d)?)\s*out of 10/i)
            || text.match(/^(\d\.\d)\b/m);
        const reviews = text.match(/([\d,]+)\s*reviews/i);
        const link = card.querySelector("a[href*='Hotel-Information'], a[href*='.h']");

        return {
            name: card.querySelector("h3")?.innerText.trim() || null,
            nightlyPrice: toNumber(nightly?.[1]),
            totalPrice: toNumber(total?.[1]),
            rating: rating ? Number(rating[1]) / 2 : null,  // out of 10 -> out of 5
            reviews: toNumber(reviews?.[1]),
            url: link?.href.split("?")[0] || null
        };
    });
}

async function searchHotels() {
    const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false" });
    const page = await browser.newPage({ locale: "en-US" });
    const cardSelector = "[data-stid='lodging-card-responsive']";
    const hotels = new Map();

    try {
        const url = buildSearchUrl();
        console.log(`Opening ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        // Expedia serves a "Bot or Not?" challenge to automated browsers
        if (/bot or not/i.test(await page.title())) {
            if (process.env.HEADLESS !== "false") {
                throw new Error("Blocked by Expedia's bot check. Re-run with HEADLESS=false and solve it in the browser window.");
            }
            console.log("Bot check shown - solve it in the browser window (waiting up to 2 minutes)...");
        }
        await page.waitForSelector(cardSelector, { timeout: 120000 });

        // Expedia paginates with a "Show more results" button that appends cards
        for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            const parsed = await page.$$eval(cardSelector, parseCards);

            for (const hotel of parsed) {
                if (passesFilters(hotel) && !hotels.has(hotel.name)) {
                    hotels.set(hotel.name, hotel);
                }
            }
            console.log(`Page ${pageNumber}: ${parsed.length} cards loaded, ${hotels.size} match filters`);

            if (hotels.size >= targetCount) {
                break;
            }

            const showMore = page.getByRole("button", { name: /show more/i });
            if (!(await showMore.isVisible())) {
                console.log("No more results.");
                break;
            }

            await showMore.click();
            await page.waitForFunction(
                ({ selector, count }) => document.querySelectorAll(selector).length > count,
                { selector: cardSelector, count: parsed.length },
                { timeout: 30000 }
            );
        }
    } finally {
        await browser.close();
    }

    const top = [...hotels.values()].slice(0, targetCount);
    console.table(top);
    console.log(`Found ${top.length} hotels`);
    return top;
}

searchHotels().catch(error => {
    console.error("Error:", error.message);
    process.exit(1);
});
