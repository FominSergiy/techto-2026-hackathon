# backboard_search

Hotel price source that asks a [Backboard](https://docs.backboard.io) model (web search on) for the cheapest hotels in a city. Self-contained, no dependencies, Node 20.12+.

```bash
BACKBOARD_API_KEY=... node backboard_search/backboard.js --city=Aurora --region=Ontario --country-code=CA
node backboard_search/backboard.js --city=Paris --dry-run   # print the request, no API call
node backboard_search/test.js                               # offline tests
```

Flags: `--city --region --country-code --check-in --check-out --nights --adults --currency --max-nightly-price --count --provider --model`.
Env: `BACKBOARD_API_KEY` (required), `BACKBOARD_PROVIDER` (default `openai`), `BACKBOARD_MODEL` (default `gpt-4o`).

Each run records `search.lastRun` (seconds, model, input/output tokens) for the time and token logs.

## Wiring into search.js

Prices come from pages the model reads, so they are hints: keep the API sources as ground truth. Not wired in yet. To enable it:

1. Add a root adapter `backboard.js`:

```js
const settings = require("./settings");
const backboard = require("./backboard_search/backboard");
const { runIfMain } = require("./hotel-utils");

const search = () => backboard.search({
    city: settings.city, region: settings.region, countryCode: settings.countryCode,
    checkIn: settings.checkIn, checkOut: settings.checkOut, adults: settings.adults,
    currency: settings.currency, maxNightlyPrice: settings.maxNightlyPrice, count: settings.targetCount
});

module.exports = { search };
runIfMain(module, "Backboard", search);
```

2. Add `backboard: "./backboard"` to the `SOURCES` map in `search.js`, then run `node search.js --sources=xotelo,backboard`.
