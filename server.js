// Web UI backend: serves public/ and runs the hotel search suite for a text prompt.
//   node server.js        -> http://localhost:3000   (PORT overrides)
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { parsePrompt } = require("./prompt");

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

async function handleSearch(request, response) {
    try {
        const { prompt } = JSON.parse(await readBody(request));
        if (!prompt?.trim()) {
            return sendJson(response, 400, { error: "Enter a prompt first" });
        }

        const started = Date.now();
        const parsed = await parsePrompt(prompt);
        const { hotels, log } = await runSearch(parsed.args);
        sendJson(response, 200, { hotels, log, args: parsed.args, parser: parsed.parser, usage: parsed.usage, seconds: (Date.now() - started) / 1000 });
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
    serveStatic(request, response);
}).listen(PORT, () => console.log(`Hotel search UI on http://localhost:${PORT}`));
