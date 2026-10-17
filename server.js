// Web UI backend: serves public/ and runs the hotel search suite for a text prompt.
//   node server.js        -> http://localhost:3000   (PORT overrides)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { parsePrompt } = require("./prompt");
const { SOURCES, describe } = require("./sources");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const RESULT_MARKER = "@@RESULT@@";

// Runs search-json.js with the given settings args, resolves { hotels, log }
function runSearch(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "search-json.js"), ...args], { cwd: __dirname });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", chunk => (stdout += chunk));
        child.stderr.on("data", chunk => (stderr += chunk));
        child.on("close", code => {
            const lines = stdout.split("\n");
            const resultLine = lines.find(line => line.startsWith(RESULT_MARKER));
            const log = [...lines.filter(line => line && !line.startsWith(RESULT_MARKER)), ...stderr.split("\n")]
                .filter(Boolean)
                .join("\n");

            if (code !== 0 || !resultLine) {
                return reject(new Error(stderr.trim().split("\n").pop() || `search exited with code ${code}`));
            }
            resolve({ hotels: JSON.parse(resultLine.slice(RESULT_MARKER.length)), log });
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

    const newest = files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)[0];
    return {
        hotels: JSON.parse(fs.readFileSync(path.join(dir, newest), "utf8")),
        log: `DEMO mode: showing saved results from output/${newest}. No APIs were called; the ticked sources (${picked.join(" ")}) are not applied.`,
        args: [...picked, "demo mode"],
        parser: "demo (prompt ignored)",
        usage: null,
        seconds: 0
    };
}

async function handleSearch(request, response) {
    try {
        const { prompt, sources, places } = JSON.parse(await readBody(request));
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
        const parsed = await parsePrompt(prompt);
        const args = [...parsed.args.filter(arg => !/^--(sources|enrich-phones)=/.test(arg)), ...picked];
        const { hotels, log } = await runSearch(args);
        sendJson(response, 200, { hotels, log, args, parser: parsed.parser, usage: parsed.usage, seconds: (Date.now() - started) / 1000 });
    } catch (error) {
        sendJson(response, 500, { error: error.message });
    }
}

function serveStatic(request, response) {
    const name = request.url === "/" ? "index.html" : path.basename(request.url.split("?")[0]);
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
    serveStatic(request, response);
}).listen(PORT, () => console.log(`Hotel search UI on http://localhost:${PORT}${process.env.DEMO ? " (DEMO mode: saved results, no API calls)" : ""}`));
