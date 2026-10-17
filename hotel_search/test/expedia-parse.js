// Offline test for expedia.js parsing: loads a SYNTHETIC hand-written page into Playwright via
// page.setContent (no network) and checks the extracted hotels. Run: node test/expedia-parse.js
// This does not prove the selectors work on Expedia's real page.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { parseCardText, extractRawCards, parseAmount } = require("../expedia");

async function main() {
    assert.equal(parseAmount("1,234"), 1234);
    assert.equal(parseAmount("1.234,50"), 1234.5);
    assert.equal(parseAmount("1,234.56"), 1234.56);
    assert.equal(parseAmount("89"), 89);

    const browser = await chromium.launch();
    try {
        const page = await browser.newPage();
        await page.setContent(fs.readFileSync(path.join(__dirname, "expedia-fixture.html"), "utf8"));
        const cards = (await extractRawCards(page)).map(raw => parseCardText(raw, { nights: 2, currency: "CAD" }));
        console.table(cards.map(({ hotel, soldOut }) => ({ ...hotel, soldOut })));

        const [alpha, beta, gamma, delta, epsilon] = cards;
        assert.equal(cards.length, 5);

        assert.deepEqual(alpha.hotel, { name: "Alpha Inn & Suites", nightlyPrice: 149, totalPrice: 298, currency: "CAD", rating: 4.3, reviews: 1234, address: null, url: "https://example.test/Hotel-Information/h1" });
        assert.equal(beta.hotel.nightlyPrice, 620);   // only a total: 1240 / 2 nights
        assert.equal(beta.hotel.totalPrice, 1240);
        assert.equal(beta.hotel.rating, 4.6);         // from visually-hidden text
        assert.equal(beta.hotel.reviews, 87);
        assert.equal(gamma.hotel.nightlyPrice, 89);
        assert.equal(gamma.hotel.rating, null);       // missing rating stays null, not 0
        assert.equal(gamma.hotel.reviews, null);
        assert.equal(delta.soldOut, true);
        assert.equal(delta.hotel.nightlyPrice, null);
        assert.equal(epsilon.hotel.totalPrice, 1234.5);
        assert.equal(epsilon.hotel.currency, "EUR");
        console.log("expedia parser: all checks passed");
    } finally {
        await browser.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
