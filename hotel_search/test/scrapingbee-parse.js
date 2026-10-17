// Offline test for scrapingbee.js: turns the synthetic Expedia fixture's cards into raw cards the way ScrapingBee's
// "html" extract rule would hand them over, and checks the parsed hotels. No network. Run: node hotel_search/test/scrapingbee-parse.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cardFromHtml } = require("../scrapingbee");
const { parseCardText } = require("../expedia");

const page = fs.readFileSync(path.join(__dirname, "expedia-fixture.html"), "utf8");
// Each card's inner HTML (the fixture's cards are flat <div>s, so the first </div> at line start closes one)
const cards = [...page.matchAll(/<div data-stid="lodging-card-responsive"[^>]*>([\s\S]*?)\n<\/div>/g)]
    .map(match => parseCardText(cardFromHtml(match[1]), { nights: 2, currency: "CAD" }));

const [alpha, beta, gamma, delta, epsilon] = cards;
assert.equal(cards.length, 5);
assert.deepEqual(alpha.hotel, { name: "Alpha Inn & Suites", nightlyPrice: 149, totalPrice: 298, currency: "CAD", rating: 4.3, reviews: 1234, address: null, url: "https://example.test/Hotel-Information/h1" });
assert.equal(beta.hotel.nightlyPrice, 620);
assert.equal(beta.hotel.rating, 4.6);
assert.equal(gamma.hotel.nightlyPrice, 89);
assert.equal(gamma.hotel.rating, null);
assert.equal(delta.soldOut, true);
assert.equal(epsilon.hotel.totalPrice, 1234.5);
assert.equal(epsilon.hotel.currency, "EUR");
console.log("scrapingbee card parsing: all checks passed");
