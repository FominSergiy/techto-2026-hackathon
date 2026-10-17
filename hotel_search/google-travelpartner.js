// Prices from Google Hotel Center via the Travel Partner API (v3) - https://developers.google.com/hotels/hotel-prices/api-reference/rest
// This is NOT a market search: it only lists the hotels of the Hotel Center account the service account was invited to
// (hotelViews) and reads the prices that account has submitted for them (priceViews). No city filter, no phones.
// Needs GOOGLE_APPLICATION_CREDENTIALS (path to the service account JSON key) and TRAVELPARTNER_ACCOUNT_ID
// (the partner id, not the display name). Hotel Center must have invited the service account's email (can take ~24h).
const crypto = require("node:crypto");
const fs = require("node:fs");
const settings = require("./settings");
const { requireEnv, getJson, normalizeHotel, collectPages, runIfMain } = require("./hotel-utils");

const API = "https://travelpartner.googleapis.com/v3";
const SCOPE = "https://www.googleapis.com/auth/travelpartner";
const HOTELS_PER_PAGE = 100;
const PARALLEL_PRICE_CALLS = 10;

const base64url = value => Buffer.from(value).toString("base64url");

// Service account JSON key -> OAuth access token (signed JWT exchanged at the key's token_uri). Tokens last an hour.
// Plain fetch on purpose: getJson would save the token response in output/raw/.
async function accessToken(keyFile) {
    const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
    const tokenUri = key.token_uri || "https://oauth2.googleapis.com/token";
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }))}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key.private_key).toString("base64url");

    const response = await fetch(tokenUri, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(`Google token request failed: ${data.error_description || data.error || response.status}`);
    }
    return data.access_token;
}

// { year, month, day } -> "2026-10-24"
const isoDate = ({ year, month, day } = {}) => year ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;

// One hotelView plus its priceView -> the common hotel shape. null when Google has no price for the searched stay.
// The itinerary must match the check-in date and number of nights exactly; its total is price + taxes + fees.
function normalize(hotelView, priceView) {
    const itinerary = (priceView?.perItineraryPrices || []).find(item => isoDate(item.checkinDate) === settings.checkIn && item.lengthOfStayDays === settings.nights);
    if (!itinerary) return null;

    const total = [itinerary.price, itinerary.taxes, itinerary.fees].reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    return normalizeHotel({
        name: hotelView.partnerHotelDisplayName || hotelView.googleHotelDisplayName,
        nightlyPrice: Math.round(total / itinerary.lengthOfStayDays),
        totalPrice: total,
        currency: itinerary.currencyCode,
        url: hotelView.propertyDetails
    });
}

async function search() {
    const [keyFile, accountId] = requireEnv("GOOGLE_APPLICATION_CREDENTIALS", "TRAVELPARTNER_ACCOUNT_ID");
    const headers = { Authorization: `Bearer ${await accessToken(keyFile)}` };
    const get = path => getJson(`${API}/${path}`, { headers });

    return collectPages("Travel Partner", async pageToken => {
        const params = new URLSearchParams({ pageSize: String(HOTELS_PER_PAGE) });
        if (pageToken) {
            params.set("pageToken", pageToken);
        }
        const data = await get(`accounts/${accountId}/hotelViews?${params}`);
        const views = (data.hotelViews || []).filter(view => view.partnerHotelId);

        // One priceView call per hotel. A hotel with no prices answers with an error: skip it, not the whole page.
        const hotels = [];
        for (let start = 0; start < views.length; start += PARALLEL_PRICE_CALLS) {
            const chunk = views.slice(start, start + PARALLEL_PRICE_CALLS);
            const found = await Promise.all(chunk.map(view =>
                get(`accounts/${accountId}/priceViews/${encodeURIComponent(view.partnerHotelId)}`)
                    .then(priceView => normalize(view, priceView))
                    .catch(error => {
                        console.warn(`Travel Partner: no price for ${view.partnerHotelDisplayName || view.partnerHotelId} (${error.message})`);
                        return null;
                    })));
            hotels.push(...found.filter(Boolean));
        }
        return { hotels, next: data.nextPageToken || null };
    });
}

module.exports = { search, normalize, accessToken };
runIfMain(module, "Travel Partner", search);
