// Offline tests for the Google Hotel Center (Travel Partner) source: price matching and the service account token request.
// Run: node hotel_search/test/google-travelpartner.js
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const settings = require("../settings");
Object.assign(settings, { city: "Aurora", checkIn: "2026-10-24", checkOut: "2026-10-26", nights: 2, currency: "CAD" });
const { normalize, accessToken } = require("../google-travelpartner");

const hotelView = { partnerHotelId: "p1", partnerHotelDisplayName: "Alpha Inn", propertyDetails: "https://www.google.com/travel/hotels/x" };
const priceView = {
    name: "accounts/1/priceViews/p1",
    perItineraryPrices: [
        { checkinDate: { year: 2026, month: 10, day: 24 }, lengthOfStayDays: 1, price: 100, taxes: 13, fees: 0, currencyCode: "CAD" },
        { checkinDate: { year: 2026, month: 10, day: 24 }, lengthOfStayDays: 2, price: 200, taxes: 26, fees: 4, currencyCode: "CAD" }
    ]
};

const hotel = normalize(hotelView, priceView);
assert.strictEqual(hotel.name, "Alpha Inn");
assert.strictEqual(hotel.totalPrice, 230, "price + taxes + fees of the 2-night itinerary");
assert.strictEqual(hotel.nightlyPrice, 115);
assert.strictEqual(hotel.url, hotelView.propertyDetails);
assert.strictEqual(hotel.city, null, "hotelViews has no city");
assert.strictEqual(normalize(hotelView, { perItineraryPrices: [priceView.perItineraryPrices[0]] }), null, "no itinerary for the searched stay");
assert.strictEqual(normalize(hotelView, {}), null, "no prices at all");

(async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "travelpartner-"));
    const keyFile = path.join(dir, "key.json");
    fs.writeFileSync(keyFile, JSON.stringify({ client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth.test/token" }));

    let request;
    const realFetch = global.fetch;
    global.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200, json: async () => ({ access_token: "tok123" }) };
    };
    try {
        assert.strictEqual(await accessToken(keyFile), "tok123");
    } finally {
        global.fetch = realFetch;
        fs.rmSync(dir, { recursive: true });
    }

    assert.strictEqual(request.url, "https://oauth.test/token");
    const form = new URLSearchParams(request.options.body.toString());
    assert.strictEqual(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = form.get("assertion").split(".");
    const decode = part => JSON.parse(Buffer.from(part, "base64url").toString());
    assert.deepStrictEqual(decode(header), { alg: "RS256", typ: "JWT" });
    assert.deepStrictEqual([decode(claims).iss, decode(claims).scope, decode(claims).aud], ["bot@proj.iam.gserviceaccount.com", "https://www.googleapis.com/auth/travelpartner", "https://oauth.test/token"]);
    assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")), "JWT signature verifies with the public key");

    console.log("google-travelpartner: all tests passed");
})();
