// Web UI backend: serves public/ and runs the hotel search suite for a text prompt.
//   node server.js        -> http://localhost:3000   (PORT overrides)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { parsePrompt, pinRegion, hasCity } = require("./prompt");
const { refine } = require("./prompt_refine");
const { SOURCES, describe } = require("./hotel_search/sources");
const backboard = require("./backboard_search/backboard");
const { classify } = require("./backboard_search/classify");
const settings = require("./hotel_search/settings");
const placesSearch = require("./hotel_search/places-search");
const { combine } = require("./hotel_search/combine");
const { withRawCapture } = require("./hotel_search/hotel-utils");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const RESULT_MARKER = "@@RESULT@@";
const REPORT_MARKER = "@@REPORT@@";

// Runs `search.js --json` with the given settings args, resolves { hotels, log }
function runSearch(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "search.js"), "--json", ...args], { cwd: __dirname });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => (stdout += chunk));
        child.stderr.on("data", chunk => (stderr += chunk));
        child.on("close", code => {
            const lines = stdout.split("\n");
            const resultLine = lines.find(line => line.startsWith(RESULT_MARKER));
            const reportLine = lines.find(line => line.startsWith(REPORT_MARKER));
            const log = [...lines.filter(line => line && !line.startsWith(RESULT_MARKER) && !line.startsWith(REPORT_MARKER)), ...stderr.split("\n")]
                .filter(Boolean)
                .join("\n");

            if (code !== 0 || !resultLine) {
                return reject(new Error(stderr.trim().split("\n").pop() || `search exited with code ${code}`));
            }
            resolve({
                hotels: JSON.parse(resultLine.slice(RESULT_MARKER.length)),
                report: reportLine ? JSON.parse(reportLine.slice(REPORT_MARKER.length)) : null,
                log
            });
        });
    });
}

function readBody(request) {
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", chunk => (body += chunk));
        request.on("end", () => resolve(body));
        request.on("error", reject);
    });
}

function sendJson(response, status, data) {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
}

// DEMO=1: answer every search with the newest saved run in output/ instead of calling any API,
// so the page can be tested without using up API quota
function demoResult(picked) {
    const dir = path.join(__dirname, "output");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /^hotels-.*\.json$/.test(name)) : [];
    if (!files.length) {
        throw new Error("DEMO mode needs a saved run in output/ - run node search.js once first");
    }

    const newestFirst = files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
    // Skip runs that found nothing so the demo isn't blank
    const runs = newestFirst.map(name => ({ name, hotels: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) }));
    const { name: newest, hotels } = runs.find(run => run.hotels.length) || {};
    if (!newest) {
        throw new Error("DEMO mode needs a saved run with hotels in output/ - run node search.js once first");
    }
    return {
        hotels,
        log: `DEMO mode: showing saved results from output/${newest}. No APIs were called; the ticked sources (${picked.join(" ")}) are not applied.`,
        args: [...picked, "demo mode"],
        parser: "demo (prompt ignored)",
        usage: null,
        seconds: 0
    };
}

async function handleSearch(request, response) {
    try {
        const { prompt, sources, places, reviewed } = JSON.parse(await readBody(request));
        if (!prompt?.trim()) {
            return sendJson(response, 400, { error: "Enter a prompt first" });
        }

        // The checkboxes decide which APIs run, over anything the prompt says about them
        const known = (sources || []).filter(name => name in SOURCES);
        if (!known.length) {
            return sendJson(response, 400, { error: "Tick at least one source" });
        }
        const picked = [`--sources=${known.join(",")}`, `--enrich-phones=${Boolean(places)}`];
        if (process.env.DEMO) {
            return sendJson(response, 200, demoResult(picked));
        }

        const started = Date.now();
        const parsed = await parsePrompt(prompt, { literal: Boolean(reviewed) });
        // A reviewed prompt already has the region fixed; a typed one gets Ontario, CA unless it says otherwise with flags
        const parsedArgs = reviewed ? parsed.args : pinRegion(parsed.args, prompt);
        if (!hasCity(parsedArgs)) {
            return sendJson(response, 400, { error: 'No city found in your prompt, so nothing was searched. Name one, e.g. "cheapest hotel in Hamilton, 1 person, 2026-11-04 to 2026-11-05" (or add --city=Hamilton).' });
        }
        const args = [...parsedArgs.filter(arg => !/^--(sources|enrich-phones)=/.test(arg)), ...picked];
        const { hotels, report, log } = await runSearch(args);
        sendJson(response, 200, { hotels, report, log, args, parser: parsed.parser, usage: parsed.usage, seconds: (Date.now() - started) / 1000 });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

// Step 1 of both boxes: turn the rough prompt into the full prompt that will run, without running it
async function handleRefine(request, response) {
    try {
        const { prompt, target } = JSON.parse(await readBody(request));
        if (!prompt?.trim()) {
            return sendJson(response, 400, { error: "Enter a prompt first" });
        }
        sendJson(response, 200, await refine(prompt, target, { offline: Boolean(process.env.DEMO) }));
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

// Backboard-only search: the textarea text goes straight to a web-search model, no price APIs involved
async function handleBackboard(request, response) {
    try {
        const { prompt } = JSON.parse(await readBody(request));
        if (!prompt?.trim()) {
            return sendJson(response, 400, { error: "Enter a prompt first" });
        }

        const started = Date.now();
        // "from" rates are the lowest nightly rate a page showed, not the rate for the searched dates; "no price"
        // hotels are kept so they can still be called and asked
        const label = { from: "backboard (from rate)", none: "backboard (no price)" };
        const hotels = (await backboard.search({ prompt: prompt.trim() })).map(hotel => ({ ...hotel, source: label[hotel.priceType] || "backboard" }));
        sendJson(response, 200, { hotels, run: backboard.search.lastRun, seconds: (Date.now() - started) / 1000 });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

// The city a Google Maps search is for, read from the prompt. This covers all of Canada, so the region is not pinned to
// Ontario: a province the request names ("Hamilton, Ontario") goes into the Maps queries to tell same-named cities apart,
// and without one the queries name only the city. Returns { parsed, city, region } or { parsed, error }.
async function readPlace(prompt) {
    const parsed = await parsePrompt(prompt);
    const args = parsed.args;
    if (!hasCity(args)) {
        return { parsed, error: 'No city found in your prompt, so nothing was searched. Name one, e.g. "hotels in Hamilton" (or add --city=Hamilton).' };
    }
    const flag = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const region = [flag("region")].find(value => value && !/^(null|undefined)$/i.test(value)) || null;
    return { parsed, city: flag("city"), region };
}

// The fixed Maps searches for a city, then (unless rank is false) a Backboard model's expected price for each hotel, with the
// table ordered by it. If ranking fails the Maps results are still returned, unranked, with the reason.
async function searchMaps(city, region, rank) {
    const result = await withRawCapture("places-search", () => placesSearch.run(city, region));
    let hotels = result.hotels;
    let ranking = null;
    if (rank !== false && hotels.length) {
        try {
            const ranked = await classify(hotels, { city, region, countryCode: settings.countryCode, currency: settings.currency });
            hotels = ranked.hotels;
            ranking = ranked.run;
        } catch (error) {
            ranking = { error: error.message };
        }
    }
    return { ...result, hotels, ranking };
}

// Google Maps only: the prompt is reduced to a city, then a few fixed Places searches run for it ("hotels in X", "inns in X", ...)
async function handlePlaces(request, response) {
    try {
        const { prompt, rank } = JSON.parse(await readBody(request));
        if (!prompt?.trim()) {
            return sendJson(response, 400, { error: "Enter a prompt first" });
        }

        if (process.env.DEMO) {
            return sendJson(response, 400, { error: "DEMO mode makes no API calls, so the Google Maps search is off" });
        }

        const started = Date.now();
        const { parsed, city, region, error } = await readPlace(prompt);
        if (error) {
            return sendJson(response, 400, { error });
        }
        const result = await searchMaps(city, region, rank);
        sendJson(response, 200, { ...result, city, parser: parsed.parser, usage: parsed.usage, seconds: (Date.now() - started) / 1000 });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

// The reservation page: the Google Maps search (ranked by expected price) and the Backboard web search run side by side
// for the same prompt, and their hotels are merged into one list, cheapest first. Either one failing leaves the other's hotels.
async function handleReservation(request, response) {
    try {
        const { prompt } = JSON.parse(await readBody(request));
        if (!prompt?.trim()) {
            return sendJson(response, 400, { error: "Enter a prompt first" });
        }
        if (process.env.DEMO) {
            return sendJson(response, 400, { error: "DEMO mode makes no API calls, so this search is off" });
        }

        const place = await readPlace(prompt);
        if (place.error) {
            return sendJson(response, 400, { error: place.error });
        }

        const [maps, found] = await Promise.allSettled([
            searchMaps(place.city, place.region),
            backboard.search({ prompt: prompt.trim() })
        ]);
        if (maps.status === "rejected" && found.status === "rejected") {
            return sendJson(response, 500, { error: `Google Maps: ${maps.reason.message}. Backboard: ${found.reason.message}` });
        }

        const warnings = [
            maps.status === "rejected" && `Google Maps failed: ${maps.reason.message}`,
            found.status === "rejected" && `Backboard failed: ${found.reason.message}`,
            maps.status === "fulfilled" && maps.value.ranking?.error && `Price estimates failed: ${maps.value.ranking.error}`
        ].filter(Boolean);
        const hotels = combine(maps.value?.hotels, found.value);

        // The search is the first half of the job: the hotels with a phone (cheapest first, unpriced last) become the call queue
        const callList = hotels.filter(hotel => hotel.phone).slice(0, MAX_QUEUE);
        let job = null;
        if (callList.length) {
            job = startCalls(prompt.trim(), callList);
            if (callList.length < WANT_PRICES) {
                warnings.push(`Only ${callList.length} hotels have a phone number, so fewer than ${WANT_PRICES} prices may come back.`);
            }
        } else {
            warnings.push("No hotel has a phone number, so nobody was called.");
        }
        sendJson(response, 200, { hotels, warnings, job: job && { id: job.id, phones: job.phones } });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

const CALLS = 5; // calls running at the same time
const WANT_PRICES = 3; // stop once this many conversations gave a price
const MAX_QUEUE = 15; // hotels handed to the call script at most
const CALL_DIR = path.join(__dirname, "output", "calls");
const jobs = new Map();

// The call race: Davide_test/main.py phones the queue through ElevenLabs, CALLS at a time, dialing the next hotel whenever a
// call ends, until WANT_PRICES conversations gave a price (said on the call) or the queue runs out. Then it emails the cheapest
// booking (RESULT_EMAIL). It runs in the background, one process per request, inside its own folder under output/calls/<id>/
// (hotels.json in; results.json, rewritten after every call, and run logs out). The page follows it through /api/reservation/status.
// With TEST_NUMBER set in .env the calls go to those numbers instead of the hotels' own phones.
function startCalls(prompt, hotels) {
    const id = Date.now().toString(36);
    const dir = path.join(CALL_DIR, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "hotels.json");
    fs.writeFileSync(file, JSON.stringify(hotels.map(hotel => ({ name: hotel.name, address: hotel.address, phone: hotel.phone, nightlyPrice: hotel.price }))));

    const job = { id, dir, state: "calling", phones: hotels.map(hotel => hotel.phone), error: null };
    jobs.set(id, job);

    let log = "";
    const child = spawn(process.env.PYTHON || "python3", ["-u", path.join(__dirname, "Davide_test", "main.py"), "--hotels", file, "--calls", String(CALLS), "--want", String(WANT_PRICES), "--strategy", "cheapest", prompt], { cwd: dir });
    child.stdout.on("data", chunk => (log += chunk));
    child.stderr.on("data", chunk => (log += chunk));
    child.on("error", error => {
        job.state = "failed";
        job.error = `Could not start the call script: ${error.message}`;
    });
    child.on("close", code => {
        fs.writeFileSync(path.join(dir, "log.txt"), log);
        job.state = code === 0 ? "done" : "failed";
        job.error = code === 0 ? null : (log.trim().split("\n").pop() || `the call script exited with code ${code}`);
        job.emailed = /\] email sent/.test(log);
        job.emailError = log.split("\n").find(line => line.includes("EMAIL FAILED")) || null;
        try {
            job.results = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
        } catch {
            job.results = null;
        }
    });
    return job;
}

function handleCallStatus(request, response) {
    const job = jobs.get(new URL(request.url, "http://localhost").searchParams.get("id"));
    if (!job) {
        return sendJson(response, 404, { error: "Unknown call run (the server was restarted?)" });
    }
    const { state, error, emailed, emailError } = job;
    let results = job.results;
    if (state === "calling") {
        // the script rewrites results.json after every finished call; it may be missing or half-written, which just means "no news yet"
        try {
            results = JSON.parse(fs.readFileSync(path.join(job.dir, "results.json"), "utf8"));
        } catch {
            results = null;
        }
    }
    const calls = (results?.calls || []).map(({ phone, status, number, call_price, hotel, error: why }) => ({ phone, status, number, price: call_price, hotel, error: why }));
    const chosen = results?.chosen && { hotel: results.chosen.hotel, number: results.chosen.number, price: results.chosen.price };
    const priced = calls.filter(call => call.price).length;
    sendJson(response, 200, { state, error, emailed: Boolean(emailed), emailError, calls, chosen, priced, want: WANT_PRICES });
}

function serveStatic(request, response) {
    const route = request.url.split("?")[0];
    // The reservation page is the root; the original search page (checkboxes per API, Backboard card, Google Maps card) is at /search
    const PAGES = { "/": "reservation.html", "/reservation": "reservation.html", "/search": "index.html" };
    const name = PAGES[route] || path.basename(route);
    const file = path.join(PUBLIC_DIR, name);
    fs.readFile(file, (error, content) => {
        if (error) {
            response.writeHead(404);
            return response.end("Not found");
        }
        const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "text/plain";
        response.writeHead(200, { "Content-Type": type });
        response.end(content);
    });
}

http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/api/search") {
        return handleSearch(request, response);
    }
    if (request.method === "GET" && request.url === "/api/sources") {
        return sendJson(response, 200, describe());
    }
    if (request.method === "POST" && request.url === "/api/refine") {
        return handleRefine(request, response);
    }
    if (request.method === "POST" && request.url === "/api/backboard") {
        return handleBackboard(request, response);
    }
    if (request.method === "POST" && request.url === "/api/places") {
        return handlePlaces(request, response);
    }
    if (request.method === "POST" && request.url === "/api/reservation") {
        return handleReservation(request, response);
    }
    if (request.method === "GET" && request.url.startsWith("/api/reservation/status")) {
        return handleCallStatus(request, response);
    }
    serveStatic(request, response);
}).listen(PORT, () => console.log(`Reservation AI service on http://localhost:${PORT} (original search page: /search)${process.env.DEMO ? " (DEMO mode: saved results, no API calls)" : ""}`));
