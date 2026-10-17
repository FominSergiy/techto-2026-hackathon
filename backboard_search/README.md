# backboard_search

Hotel price source that asks a [Backboard](https://docs.backboard.io) model (web search on) for the cheapest hotels in a city. Self-contained, no dependencies, Node 20.12+.

```bash
BACKBOARD_API_KEY=... node backboard_search/backboard.js --city=Aurora --region=Ontario --country-code=CA
node backboard_search/backboard.js --city=Paris --dry-run   # print the request, no API call
node backboard_search/test.js                               # offline tests
```

Flags: `--city --region --country-code --check-in --check-out --nights --adults --currency --max-nightly-price --count --provider --model`.
Env: `BACKBOARD_API_KEY` (required), `BACKBOARD_PROVIDER` (default `openai`), `BACKBOARD_MODEL` (default `gpt-4o`).

`--prompt="..."` (and the UI box below) skips the structured flags and sends your own words to the model, so dates, guests and currency come from the text.

In the web UI (`node server.js`) the "Backboard (web search)" card has its own textarea and button. It posts to `/api/backboard`, which calls this module directly and is independent of the main search above. It needs `BACKBOARD_API_KEY` in `.env` (restart the server after adding it).

Each run records `search.lastRun` (seconds, model, input/output tokens) for the time and token logs.

## Wiring into hotel_search

Prices come from pages the model reads, so they are hints: keep the API sources as ground truth. The UI's Backboard card already uses this module directly. To make it a checkbox in the main search, add an adapter `hotel_search/backboard.js`:

```js
const settings = require("./settings");
const backboard = require("../backboard_search/backboard");
const { runIfMain } = require("./hotel-utils");

const search = () => backboard.search({
    city: settings.city, region: settings.region, countryCode: settings.countryCode,
    checkIn: settings.checkIn, checkOut: settings.checkOut, adults: settings.adults,
    currency: settings.currency, maxNightlyPrice: settings.maxNightlyPrice, count: settings.targetCount
});

module.exports = { search };
runIfMain(module, "Backboard", search);
```

and a `sources.js` entry: `backboard: { label: "Backboard", detail: "web search", module: "./backboard", env: ["BACKBOARD_API_KEY"], cost: { kind: "tier", label: "Token-based", note: "Billed by Backboard per model call." } }`.
